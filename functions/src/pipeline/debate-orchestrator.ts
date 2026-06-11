import * as repo from '../db/repository.js';
import type { DebateTurn } from '../db/repository.js';
import { FacilitatorAgentService } from '../agents/facilitator-agent.js';
import { PersonaAgentService } from '../agents/persona-agent.js';
import type {
  PersonaAttributes,
  Result,
  PipelineError,
  DebateChapter,
  PendingIntent,
} from '../types/index.js';

function pipelineErrorMessage(e: PipelineError): string {
  if ('message' in e) return e.message;
  if ('resource' in e) return `${e.code}: ${e.resource}`;
  return `${e.code}: expected=${e.expected} current=${e.current}`;
}

export interface OrchestratorOptions {
  turnsPerChapter: number;
  maxTurns: number;
  interventionInterval: number;
  silenceThreshold: number;
  minTurnsPerPersona: number;
  minSpeaksPerPersonaInChapter: number;
}

export const DEFAULT_OPTIONS: OrchestratorOptions = {
  turnsPerChapter: 15,
  maxTurns: 200,
  interventionInterval: 8,
  silenceThreshold: 5,
  minTurnsPerPersona: 6,
  minSpeaksPerPersonaInChapter: 1,
};

export const DEFAULT_CHAPTERS: ReadonlyArray<Pick<DebateChapter, 'title' | 'focusQuestion'>> = [
  { title: '導入', focusQuestion: 'この問題についてそれぞれどのような認識を持っているか？' },
  { title: '核心的対立', focusQuestion: '最も意見が分かれる点はどこか？' },
  { title: '影響と懸念', focusQuestion: 'それぞれの立場にどのような影響があるか？' },
  { title: 'まとめ', focusQuestion: '各自の立場から何が言えるか？' },
];

export interface DebateState {
  history: DebateTurn[];
  currentBeliefs: Map<string, { content: string; version: number }>;
  silenceMap: Map<string, number>;
  speakCount: Map<string, number>;
  lastAddressedPersonaId: string | undefined;
  lastAddressedByFacilitator: boolean;
  lastSpeakerId: string | undefined;
  pendingItems: Map<string, PendingIntent[]>;
  consecutiveDirectExchanges: number;
  lastFacilitatorTurnIndex: number;
  currentTurnIndex: number;
}

export function shouldEvaluateIntervention(
  silenceMap: Map<string, number>,
  personasCount: number,
  turnsSinceFacilitator: number,
  interventionInterval: number
): boolean {
  const maxSilence = Math.max(0, ...silenceMap.values());
  if (turnsSinceFacilitator >= interventionInterval) return true;
  // silence trigger only fires when someone has been ignored for a full interval
  // (using personasCount threshold causes cascade: facilitator → A → facilitator → B → ...)
  if (maxSilence >= interventionInterval && turnsSinceFacilitator >= Math.ceil(interventionInterval / 2)) return true;
  return false;
}

export function evaluateParticipationBalance(
  speakCount: Map<string, number>,
  personas: PersonaAttributes[]
): PersonaAttributes[] {
  if (personas.length === 0) return [];
  const total = personas.reduce((sum, p) => sum + (speakCount.get(p.id) ?? 0), 0);
  const average = total / personas.length;
  const threshold = average * 0.5;
  return personas.filter(p => (speakCount.get(p.id) ?? 0) <= threshold);
}

function toPersonaAttributes(p: repo.PersonaProfile): PersonaAttributes {
  return {
    id: p.id,
    stakeholderRole: p.stakeholderRole,
    name: p.name,
    age: p.age,
    occupation: p.occupation,
    background: p.background,
    interests: p.interests,
    stanceDirection: p.stanceDirection,
    llmType: p.llmType ?? 'claude',
  };
}

export class DebateOrchestratorService {
  constructor(
    private facilitator: FacilitatorAgentService = new FacilitatorAgentService(),
    private personaAgent: PersonaAgentService = new PersonaAgentService(),
    private options: OrchestratorOptions = DEFAULT_OPTIONS
  ) {}

  async run(sessionId: string, topicId: string): Promise<Result<void, PipelineError>> {
    try {
      const { personas, interviewRecords, currentBeliefs, topicTitle } =
        await this.loadSessionContext(topicId);

      const state: DebateState = {
        history: [],
        currentBeliefs,
        silenceMap: new Map(personas.map(p => [p.id, 0])),
        speakCount: new Map(personas.map(p => [p.id, 0])),
        lastAddressedPersonaId: undefined,
        lastAddressedByFacilitator: false,
        lastSpeakerId: undefined,
        pendingItems: new Map(),
        consecutiveDirectExchanges: 0,
        lastFacilitatorTurnIndex: 0,
        currentTurnIndex: 0,
      };

      await this.executeDebate(sessionId, topicId, topicTitle, personas, interviewRecords, state, 0);
      return { ok: true, value: undefined };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }

  async resume(sessionId: string, fromTurnIndex: number): Promise<Result<void, PipelineError>> {
    try {
      const session = await repo.getDebateSessionById(sessionId);
      if (!session) return { ok: false, error: { code: 'NOT_FOUND', resource: 'session' } };

      const topicId = session.topicId;

      const { personas, interviewRecords, currentBeliefs, topicTitle } =
        await this.loadSessionContext(topicId);

      const existingTurns = await repo.getDebateTurnsBySessionId(sessionId);
      const priorTurns = existingTurns
        .filter(t => t.turnIndex < fromTurnIndex)
        .sort((a, b) => a.turnIndex - b.turnIndex);

      const speakCount = new Map<string, number>(personas.map(p => [p.id, 0]));
      for (const t of priorTurns) {
        if (t.personaId && t.speakerType === 'persona') {
          speakCount.set(t.personaId, (speakCount.get(t.personaId) ?? 0) + 1);
        }
      }

      const silenceMap = new Map<string, number>();
      for (const p of personas) {
        const lastSpokeAt = priorTurns
          .filter(t => t.personaId === p.id)
          .reduce((max, t) => Math.max(max, t.turnIndex), -1);
        silenceMap.set(p.id, Math.max(0, fromTurnIndex - lastSpokeAt - 1));
      }

      const lastFacilitatorTurnIndex = priorTurns
        .filter(t => t.speakerType === 'facilitator')
        .reduce((max, t) => Math.max(max, t.turnIndex), 0);

      const restoredPendingIntents = await repo.loadPendingIntents(sessionId);
      const state: DebateState = {
        history: priorTurns,
        currentBeliefs,
        silenceMap,
        speakCount,
        lastAddressedPersonaId: undefined,
        lastAddressedByFacilitator: false,
        lastSpeakerId: undefined,
        pendingItems: restoredPendingIntents,
        consecutiveDirectExchanges: 0,
        lastFacilitatorTurnIndex,
        currentTurnIndex: fromTurnIndex,
      };

      // Chapter-aware resume
      let resumeInfo: { chapters: DebateChapter[]; startChapterIndex: number; startChapterTurnCount: number } | undefined;
      if (session.chapters && session.chapters.length > 0 && session.currentChapterIndex !== undefined) {
        const startChapterIndex = session.currentChapterIndex;
        const chapters: DebateChapter[] = session.chapters.map(c => {
          const chapterTurns = priorTurns.filter(t => t.chapterIndex === c.index);
          const startTurnIdx = chapterTurns.length > 0
            ? Math.min(...chapterTurns.map(t => t.turnIndex))
            : fromTurnIndex;
          return { index: c.index, title: c.title, focusQuestion: c.focusQuestion, startTurnIndex: startTurnIdx };
        });
        const startChapterTurnCount = priorTurns.filter(
          t => t.chapterIndex === startChapterIndex && t.speakerType === 'persona'
        ).length;
        resumeInfo = { chapters, startChapterIndex, startChapterTurnCount };
      }

      await this.executeDebate(sessionId, topicId, topicTitle, personas, interviewRecords, state, fromTurnIndex, resumeInfo);
      return { ok: true, value: undefined };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }

  private async loadSessionContext(topicId: string) {
    const topic = await repo.getTopicById(topicId);
    if (!topic) throw new Error(`Topic not found: ${topicId}`);

    const profiles = (await repo.getPersonasByTopicId(topicId)).filter((p) => p.approved);
    const personas = profiles.map(toPersonaAttributes);

    const currentBeliefs = new Map<string, { content: string; version: number }>();
    const interviewRecords = new Map<string, string>();

    for (const p of personas) {
      const beliefs = await repo.getPersonaBeliefsByPersonaId(topicId, p.id);
      const latest = beliefs.reduce(
        (best, b) => b.version > best.version ? b : best,
        beliefs[0]
      );
      currentBeliefs.set(p.id, { content: latest?.content ?? '', version: latest?.version ?? 0 });

      const interview = await repo.getPersonaInterviewByPersonaId(topicId, p.id);
      interviewRecords.set(p.id, interview?.interviewRecord ?? '');
    }

    return { topicTitle: topic.title, personas, currentBeliefs, interviewRecords };
  }

  private async executeDebate(
    sessionId: string,
    topicId: string,
    topicTitle: string,
    personas: PersonaAttributes[],
    interviewRecords: Map<string, string>,
    state: DebateState,
    startTurnIndex: number,
    resumeInfo?: { chapters: DebateChapter[]; startChapterIndex: number; startChapterTurnCount: number }
  ): Promise<void> {
    const { maxTurns } = this.options;

    // 1. Determine chapters
    let chapters: DebateChapter[];
    let startChapterIndex = 0;
    let startChapterTurnCount = 0;

    if (resumeInfo) {
      chapters = resumeInfo.chapters;
      startChapterIndex = resumeInfo.startChapterIndex;
      startChapterTurnCount = resumeInfo.startChapterTurnCount;
    } else if (startTurnIndex === 0) {
      // Fresh start: generate or fallback
      const chaptersResult = await this.facilitator.generateChapters(topicTitle, personas);
      if (chaptersResult.ok) {
        chapters = chaptersResult.value;
      } else {
        chapters = DEFAULT_CHAPTERS.map((c, i) => ({
          index: i,
          title: c.title,
          focusQuestion: c.focusQuestion,
          startTurnIndex: 0,
        }));
      }
      await repo.saveChapters(topicId, chapters.map(c => ({
        index: c.index,
        title: c.title,
        focusQuestion: c.focusQuestion,
      })));
    } else {
      // Resume without chapter info: use DEFAULT_CHAPTERS from chapter 0
      chapters = DEFAULT_CHAPTERS.map((c, i) => ({
        index: i,
        title: c.title,
        focusQuestion: c.focusQuestion,
        startTurnIndex: startTurnIndex,
      }));
    }

    // 2. Opening (only for fresh start)
    if (startTurnIndex === 0) {
      const firstChapter = chapters[0];
      const openingResult = await this.facilitator.generateOpening(topicTitle, personas, firstChapter);
      if (!openingResult.ok) throw new Error(pipelineErrorMessage(openingResult.error));

      const openingTurn = await repo.createDebateTurn({
        sessionId, turnIndex: 0, speakerType: 'facilitator',
        speakerName: 'ファシリテーター', speakerRole: '',
        content: openingResult.value.content ?? '',
      });
      state.history.push({
        id: openingTurn.id, sessionId, turnIndex: 0, speakerType: 'facilitator',
        speakerName: 'ファシリテーター', speakerRole: '', content: openingResult.value.content,
        createdAt: new Date().toISOString(),
      });
      state.lastAddressedPersonaId = openingResult.value.firstPersonaId;
      state.lastAddressedByFacilitator = true;
      state.currentTurnIndex = 1;
    }

    // 3. Chapter loop (outer)
    for (let ci = startChapterIndex; ci < chapters.length && state.currentTurnIndex < maxTurns; ci++) {
      chapters[ci] = { ...chapters[ci], startTurnIndex: state.currentTurnIndex };
      await repo.updateCurrentChapterIndex(topicId, ci);
      const initialTurnCount = ci === startChapterIndex ? startChapterTurnCount : 0;
      await this.executeChapter(sessionId, topicId, personas, interviewRecords, chapters, ci, state, initialTurnCount, maxTurns);
    }

    await this.finalizeDebate(sessionId, topicId, personas, state);
  }

  private async finalizeDebate(
    sessionId: string,
    topicId: string,
    personas: PersonaAttributes[],
    state: DebateState
  ): Promise<void> {
    const finalBeliefs = new Map(
      Array.from(state.currentBeliefs.entries()).map(([id, b]) => [id, b.content])
    );
    const closingResult = await this.facilitator.generateClosing(state.history, finalBeliefs);
    if (!closingResult.ok) throw new Error(pipelineErrorMessage(closingResult.error));

    const closingTurn = await repo.createDebateTurn({
      sessionId, turnIndex: state.currentTurnIndex, speakerType: 'facilitator',
      speakerName: 'ファシリテーター', speakerRole: '',
      content: closingResult.value ?? '',
    });
    state.history.push({
      id: closingTurn.id, sessionId, turnIndex: state.currentTurnIndex,
      speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '',
      content: closingResult.value ?? '', createdAt: new Date().toISOString(),
    });
    state.currentTurnIndex++;

    for (let i = 0; i < personas.length; i++) {
      const persona = personas[i];
      const finalBelief = state.currentBeliefs.get(persona.id)?.content ?? '';
      const commentResult = await this.personaAgent.generatePostDebateComment(
        persona, finalBelief, state.history
      );
      if (commentResult.ok) {
        await repo.createPostDebateComment({
          sessionId, personaId: persona.id, content: commentResult.value.content, sortOrder: i,
        });
      }
    }

    await repo.completeDebateSession(sessionId, state.currentTurnIndex);
    await repo.updateTopicStatus(topicId, 'completed');
  }

  async executeChapterTask(topicId: string, chapterIndex: number): Promise<boolean> {
    const sessionId = topicId;

    const session = await repo.getDebateSessionByTopicId(topicId);
    if (!session) throw new Error('Session not found');
    if (session.status === 'cancelled') return false;
    // chapters are generated during chapter 0's run, so only require them for chapterIndex > 0
    if (chapterIndex > 0 && !session.chapters?.length) throw new Error('Chapters not found');

    // Idempotency: if this chapter was already processed, skip it
    if (session.currentChapterIndex !== undefined && session.currentChapterIndex > chapterIndex) {
      return chapterIndex < (session.chapters?.length ?? 0) - 1;
    }

    const { personas, interviewRecords, currentBeliefs, topicTitle } =
      await this.loadSessionContext(topicId);

    const existingTurns = (await repo.getDebateTurnsBySessionId(topicId))
      .sort((a, b) => a.turnIndex - b.turnIndex);
    const fromTurnIndex = existingTurns.length > 0
      ? existingTurns[existingTurns.length - 1].turnIndex + 1
      : 0;

    const speakCount = new Map<string, number>(personas.map(p => [p.id, 0]));
    for (const t of existingTurns) {
      if (t.personaId && t.speakerType === 'persona') {
        speakCount.set(t.personaId, (speakCount.get(t.personaId) ?? 0) + 1);
      }
    }

    const silenceMap = new Map<string, number>();
    for (const p of personas) {
      const lastSpokeIdx = existingTurns
        .filter(t => t.personaId === p.id)
        .reduce((max, t) => Math.max(max, t.turnIndex), -1);
      silenceMap.set(p.id, Math.max(0, fromTurnIndex - lastSpokeIdx - 1));
    }

    const lastFacilitatorTurnIndex = existingTurns
      .filter(t => t.speakerType === 'facilitator')
      .reduce((max, t) => Math.max(max, t.turnIndex), 0);

    const state: DebateState = {
      history: existingTurns,
      currentBeliefs,
      silenceMap,
      speakCount,
      lastAddressedPersonaId: undefined,
      lastAddressedByFacilitator: false,
      lastSpeakerId: undefined,
      pendingItems: new Map(),
      consecutiveDirectExchanges: 0,
      lastFacilitatorTurnIndex,
      currentTurnIndex: fromTurnIndex,
    };

    const chapters: DebateChapter[] = (session.chapters ?? []).map(c => {
      const chapterTurns = existingTurns.filter(t => t.chapterIndex === c.index);
      const startTurnIdx = chapterTurns.length > 0
        ? Math.min(...chapterTurns.map(t => t.turnIndex))
        : fromTurnIndex;
      return { index: c.index, title: c.title, focusQuestion: c.focusQuestion, startTurnIndex: startTurnIdx };
    });

    // Chapter 0: generate chapters (if not saved yet) and opening turn
    if (chapterIndex === 0 && fromTurnIndex === 0) {
      const chaptersResult = await this.facilitator.generateChapters(topicTitle, personas);
      let savedChapters: DebateChapter[];
      if (chaptersResult.ok) {
        savedChapters = chaptersResult.value;
      } else {
        savedChapters = DEFAULT_CHAPTERS.map((c, i) => ({
          index: i, title: c.title, focusQuestion: c.focusQuestion, startTurnIndex: 0,
        }));
      }
      await repo.saveChapters(topicId, savedChapters.map(c => ({
        index: c.index, title: c.title, focusQuestion: c.focusQuestion,
      })));
      chapters.splice(0, chapters.length, ...savedChapters);

      const openingResult = await this.facilitator.generateOpening(topicTitle, personas, chapters[0]);
      if (!openingResult.ok) throw new Error(pipelineErrorMessage(openingResult.error));
      const openingTurn2 = await repo.createDebateTurn({
        sessionId, turnIndex: 0, speakerType: 'facilitator',
        speakerName: 'ファシリテーター', speakerRole: '',
        content: openingResult.value.content ?? '', chapterIndex: 0,
      });
      state.history.push({
        id: openingTurn2.id, sessionId, turnIndex: 0, speakerType: 'facilitator',
        speakerName: 'ファシリテーター', speakerRole: '', content: openingResult.value.content,
        createdAt: new Date().toISOString(),
      });
      state.lastAddressedPersonaId = openingResult.value.firstPersonaId;
      state.lastAddressedByFacilitator = true;
      state.currentTurnIndex = 1;
    }

    chapters[chapterIndex] = { ...chapters[chapterIndex], startTurnIndex: state.currentTurnIndex };
    await repo.updateCurrentChapterIndex(topicId, chapterIndex);

    await this.executeChapter(
      sessionId, topicId, personas, interviewRecords, chapters, chapterIndex, state,
      0, Number.MAX_SAFE_INTEGER
    );

    const sessionAfter = await repo.getDebateSessionByTopicId(topicId);
    if (!sessionAfter || sessionAfter.status === 'cancelled') return false;

    const isLastChapter = chapterIndex >= chapters.length - 1;
    if (isLastChapter) {
      await this.finalizeDebate(sessionId, topicId, personas, state);
      return false;
    }
    return true;
  }

  private async executeChapter(
    sessionId: string,
    topicId: string,
    personas: PersonaAttributes[],
    interviewRecords: Map<string, string>,
    chapters: DebateChapter[],
    chapterIndex: number,
    state: DebateState,
    initialChapterTurnCount: number = 0,
    globalTurnCap: number = this.options.maxTurns
  ): Promise<void> {
    const { turnsPerChapter, minSpeaksPerPersonaInChapter, interventionInterval } = this.options;
    // history の最後のペルソナ発言から lastSpeakerId を復元（resume 対応）
    for (let i = state.history.length - 1; i >= 0; i--) {
      if (state.history[i].speakerType === 'persona' && state.history[i].personaId) {
        state.lastSpeakerId = state.history[i].personaId ?? undefined;
        break;
      }
    }
    const chapter = chapters[chapterIndex];
    const targetTurnsPerChapter = turnsPerChapter;
    const maxChapterTurns = Math.ceil(targetTurnsPerChapter * 1.5);
    let chapterTurnCount = initialChapterTurnCount;
    const chapterSpeaks = new Map<string, number>(personas.map(p => [p.id, 0]));
    const recentScores: number[] = [];

    while (chapterTurnCount < maxChapterTurns && state.currentTurnIndex < globalTurnCap) {
      const sessionCheck = await repo.getDebateSessionByTopicId(topicId);
      if (!sessionCheck || sessionCheck.status === 'cancelled') return;

      // 1. Determine next speaker
      let nextPersonaId: string;
      let selectedMode: 'full' | 'reaction' | undefined;
      let fromQueue = false;
      let selectedIntentSummary: string | undefined;
      const pendingAddress = state.lastAddressedPersonaId;
      const pendingAddressByFacilitator = state.lastAddressedByFacilitator;
      state.lastAddressedPersonaId = undefined;
      state.lastAddressedByFacilitator = false;
      const MAX_CONSECUTIVE_DIRECT = 3;
      const fromDirectAddress = !!pendingAddress
        && personas.some(p => p.id === pendingAddress)
        && state.consecutiveDirectExchanges < MAX_CONSECUTIVE_DIRECT;
      if (fromDirectAddress) {
        nextPersonaId = pendingAddress!;
        state.consecutiveDirectExchanges++;
        if (pendingAddressByFacilitator) {
          selectedMode = 'full';
        }
      } else {
        // 各ペルソナの発言意欲を並列アセスメント（直前発言者は除外）
        const assessTargets = personas.filter(p => p.id !== state.lastSpeakerId);
        const rawAssessments = assessTargets.length > 0
          ? await Promise.all(
              assessTargets.map(async p => {
                const result = await this.personaAgent.assessEngagement(
                  p,
                  state.currentBeliefs.get(p.id)?.content ?? '',
                  interviewRecords.get(p.id) ?? '',
                  state.history
                );
                return {
                  personaId: p.id,
                  score: result.ok ? result.value.score : 1,
                  mode: result.ok ? result.value.mode : 'none' as const,
                  intentSummary: result.ok ? result.value.intentSummary : undefined,
                };
              })
            )
          : personas.map(p => ({ personaId: p.id, score: 1, mode: 'none' as const, intentSummary: undefined as string | undefined }));

        const lastTurnIndex = state.history.length > 0
          ? state.history[state.history.length - 1].turnIndex
          : 0;

        // 古いエントリを破棄（8ターン以上前）
        for (const [personaId, items] of state.pendingItems.entries()) {
          const filtered = items.filter(item => state.currentTurnIndex - item.triggerTurnIndex <= 8);
          if (filtered.length === 0) {
            state.pendingItems.delete(personaId);
          } else {
            state.pendingItems.set(personaId, filtered);
          }
        }

        // 章終了シグナルの記録（full意欲が高い or 緊急リアクションあり → 1、それ以外 → 0）
        // reaction score <= 3 は新論点を出さない状態なので章継続の理由にしない
        const hasActiveEngagement = rawAssessments.some(
          a => (a.mode === 'full' && a.score >= 4) || a.score >= 5
        );
        recentScores.push(hasActiveEngagement ? 1 : 0);
        if (recentScores.length > 6) recentScores.shift();

        // 発言者の選択: スコア降順 → 同率は最長沈黙優先
        const byScoreThenSilence = (
          a: { personaId: string; score: number },
          b: { personaId: string; score: number }
        ) => b.score !== a.score
          ? b.score - a.score
          : (state.silenceMap.get(b.personaId) ?? 0) - (state.silenceMap.get(a.personaId) ?? 0);

        const topScore = Math.max(...rawAssessments.map(a => a.score));

        // 緊急リアクション（reaction && score >= 4）は即時選択
        const urgentReactions = rawAssessments
          .filter(a => a.mode === 'reaction' && a.score >= 4 && a.personaId !== state.lastSpeakerId)
          .sort(byScoreThenSilence);

        if (urgentReactions.length > 0) {
          nextPersonaId = urgentReactions[0].personaId;
          fromQueue = false;
        } else if (topScore <= 3 && state.pendingItems.size > 0) {
          // 全員 score <= 3 → キューの最古エントリを優先
          let oldestIdx = Infinity;
          let oldestPersonaId: string | undefined;
          for (const [pid, items] of state.pendingItems.entries()) {
            if (pid === state.lastSpeakerId) continue;
            const oldest = Math.min(...items.map(item => item.triggerTurnIndex));
            if (oldest < oldestIdx) {
              oldestIdx = oldest;
              oldestPersonaId = pid;
            }
          }
          if (oldestPersonaId) {
            nextPersonaId = oldestPersonaId;
            fromQueue = true;
          } else {
            nextPersonaId = [...rawAssessments].sort(byScoreThenSilence)[0].personaId;
          }
        } else {
          // スコアベース: 直前話者が唯一の最高スコアでない限り連続発言を回避
          const sorted = [...rawAssessments].sort(byScoreThenSilence);
          const maxScore = sorted[0]?.score ?? 0;
          const isLastSpeakerUniqueTop = sorted[0]?.personaId === state.lastSpeakerId
            && sorted.filter(a => a.score === maxScore).length === 1;
          nextPersonaId = isLastSpeakerUniqueTop
            ? sorted[0].personaId
            : (sorted.find(a => a.personaId !== state.lastSpeakerId) ?? sorted[0]).personaId;
        }

        // ペルソナ自身の申告モードをそのまま使う（キューから選ばれた場合は full 固定）
        const assessed = rawAssessments.find(a => a.personaId === nextPersonaId);
        selectedMode = fromQueue ? 'full' : (assessed?.mode === 'none' ? undefined : assessed?.mode);

        // キュー選択の場合は queue エントリの intentSummary、通常選択は今回の評価値
        if (fromQueue) {
          selectedIntentSummary = state.pendingItems.get(nextPersonaId)?.[0]?.intentSummary;
        } else {
          selectedIntentSummary = assessed?.intentSummary;
        }

        // score >= 5 かつ未選択 → pendingItems に PendingIntent 形式で追加
        for (const { personaId, score, intentSummary: summary } of rawAssessments) {
          if (score < 5 || personaId === nextPersonaId) continue;
          const existing = state.pendingItems.get(personaId) ?? [];
          state.pendingItems.set(personaId, [...existing, { triggerTurnIndex: lastTurnIndex, intentSummary: summary ?? '' }]);
        }

        // エンゲージメント評価を Firestore に保存（generateTurn の前）
        await repo.saveEngagements({
          sessionId,
          turnIndex: lastTurnIndex,
          assessments: rawAssessments.map(a => ({
            personaId: a.personaId,
            score: a.score,
            mode: a.mode,
            intentSummary: a.intentSummary,
            addToPending: a.score >= 5 && a.personaId !== nextPersonaId,
          })),
        });

        state.consecutiveDirectExchanges = 0;
      }

      // 2. Intervention check — close is ignored in chapter loop
      const turnsSinceFacilitator = state.currentTurnIndex - state.lastFacilitatorTurnIndex;
      if (!fromDirectAddress && shouldEvaluateIntervention(state.silenceMap, personas.length, turnsSinceFacilitator, interventionInterval)) {
        evaluateParticipationBalance(state.speakCount, personas);
        const interventionResult = await this.facilitator.evaluateIntervention(
          state.history.filter(t => t.turnIndex >= chapter.startTurnIndex), personas, state.speakCount, chapter
        );
        if (!interventionResult.ok) throw new Error(pipelineErrorMessage(interventionResult.error));

        const iv = interventionResult.value;
        if (iv.shouldIntervene && iv.type !== 'close') {
          const ivTurn = await repo.createDebateTurn({
            sessionId, turnIndex: state.currentTurnIndex, speakerType: 'facilitator',
            speakerName: 'ファシリテーター', speakerRole: '',
            content: iv.content ?? '',
          });
          state.history.push({
            id: ivTurn.id, sessionId, turnIndex: state.currentTurnIndex,
            speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '',
            content: iv.content ?? '', createdAt: new Date().toISOString(),
          });
          state.lastFacilitatorTurnIndex = state.currentTurnIndex;
          state.consecutiveDirectExchanges = 0;
          state.currentTurnIndex++;

          if (iv.targetPersonaId && personas.some(p => p.id === iv.targetPersonaId)) {
            nextPersonaId = iv.targetPersonaId;
            selectedMode = 'full';
          }
        }
        // close is ignored — no break, no action
      }

      // Guard against globalTurnCap after potential facilitator turn
      if (state.currentTurnIndex >= globalTurnCap) break;

      // 3. Resolve persona
      const resolvedById = personas.find(p => p.id === nextPersonaId);
      const persona = resolvedById ?? personas.find(p => p.id !== state.lastSpeakerId) ?? personas[0];
      const belief = state.currentBeliefs.get(persona.id)!;
      const interviewRecord = interviewRecords.get(persona.id) ?? '';

      // 4. Generate persona turn (pass only current chapter's history to keep focus)
      const chapterHistory = state.history.filter(t => t.turnIndex >= chapter.startTurnIndex);
      const pendingEntries = state.pendingItems.get(persona.id);
      let pendingTrigger: { speakerName: string; content: string } | undefined;
      if (pendingEntries && pendingEntries.length > 0) {
        const triggerTurn = state.history.find(t => t.turnIndex === pendingEntries[0].triggerTurnIndex);
        pendingTrigger = triggerTurn
          ? { speakerName: triggerTurn.speakerName ?? '', content: triggerTurn.content }
          : undefined;
        if (fromQueue) {
          selectedIntentSummary = pendingEntries[0].intentSummary;
        }
      }
      const turnResult = await this.personaAgent.generateTurn(
        persona, belief.content, interviewRecord, chapterHistory, chapter, pendingTrigger, selectedMode, selectedIntentSummary
      );
      if (!turnResult.ok) throw new Error(pipelineErrorMessage(turnResult.error));

      // 5. Save persona turn with chapterIndex
      const savedTurn = await repo.createDebateTurn({
        sessionId, turnIndex: state.currentTurnIndex, speakerType: 'persona',
        personaId: persona.id, speakerName: persona.name, speakerRole: persona.stakeholderRole,
        content: turnResult.value.content ?? '',
        chapterIndex, speechMode: turnResult.value.speechMode,
        fromQueue: fromQueue || undefined,
      });

      // 6. Update history
      state.history.push({
        id: savedTurn.id, sessionId, turnIndex: state.currentTurnIndex,
        speakerType: 'persona', personaId: persona.id,
        speakerName: persona.name, speakerRole: persona.stakeholderRole,
        content: turnResult.value.content, createdAt: new Date().toISOString(),
        fromQueue: fromQueue || undefined,
      });

      // 7. Update state
      for (const p of personas) {
        state.silenceMap.set(
          p.id,
          p.id === persona.id ? 0 : (state.silenceMap.get(p.id) ?? 0) + 1
        );
      }
      state.speakCount.set(persona.id, (state.speakCount.get(persona.id) ?? 0) + 1);
      chapterSpeaks.set(persona.id, (chapterSpeaks.get(persona.id) ?? 0) + 1);
      state.lastSpeakerId = persona.id;
      // キュー選択の場合は Firestore のキューも消費する
      if (fromQueue) {
        await repo.consumePendingIntent(sessionId, persona.id);
      }
      // 発言後: そのペルソナの最古キューエントリを1つ消費
      const pItems = state.pendingItems.get(persona.id);
      if (pItems && pItems.length > 0) {
        const remaining = pItems.slice(1);
        if (remaining.length === 0) {
          state.pendingItems.delete(persona.id);
        } else {
          state.pendingItems.set(persona.id, remaining);
        }
      }

      // 8. Handle belief change
      if (turnResult.value.beliefChange) {
        const bc = turnResult.value.beliefChange;
        const newVersion = belief.version + 1;
        await repo.createPersonaBelief({
          topicId,
          personaId: persona.id,
          version: newVersion,
          content: bc.updatedBelief,
          changeType: bc.type,
          changeSummary: bc.summary,
          triggeredByTurnId: savedTurn.id,
        });
        state.currentBeliefs.set(persona.id, { content: bc.updatedBelief, version: newVersion });
      }

      // 9. Track addressing
      const addressed = turnResult.value.addressedToPersonaId;
      state.lastAddressedPersonaId =
        addressed && addressed !== persona.id && personas.some(p => p.id === addressed)
          ? addressed
          : undefined;
      state.lastAddressedByFacilitator = false;

      state.currentTurnIndex++;
      chapterTurnCount++;

      // 10. Check chapter end
      const allPersonasSpoke = personas.every(
        p => (chapterSpeaks.get(p.id) ?? 0) >= minSpeaksPerPersonaInChapter
      );

      // エンゲージメントベースで章の終了を検出（LLM呼び出し不要）
      // 全員が最低1回発言済み、かつ75%以上消化、かつ直近5ターンで full 申告者がゼロ
      const earlyCheckAt = Math.ceil(targetTurnsPerChapter * 0.75);
      if (chapterTurnCount >= earlyCheckAt && allPersonasSpoke && recentScores.length >= 5) {
        const recentFullCount = recentScores.slice(-5).reduce((a, b) => a + b, 0);
        if (recentFullCount === 0) {
          if (chapterIndex < chapters.length - 1) {
            await this.generateAndSaveChapterTransition(sessionId, chapters, chapterIndex, state, personas);
          }
          return;
        }
      }
    }

    // Forced transition (150% reached but not last chapter)
    if (chapterIndex < chapters.length - 1) {
      await this.generateAndSaveChapterTransition(sessionId, chapters, chapterIndex, state, personas);
    }
  }

  private async generateAndSaveChapterTransition(
    sessionId: string,
    chapters: DebateChapter[],
    currentChapterIndex: number,
    state: DebateState,
    personas: PersonaAttributes[]
  ): Promise<void> {
    const chapter = chapters[currentChapterIndex];
    const nextChapter = chapters[currentChapterIndex + 1];
    const recentHistory = state.history.slice(-10);

    // Turn 1: summary of current chapter (chapterIndex = current)
    const summaryResult = await this.facilitator.generateChapterSummary(recentHistory, chapter);
    if (summaryResult.ok) {
      const summaryTurn = await repo.createDebateTurn({
        sessionId, turnIndex: state.currentTurnIndex, speakerType: 'facilitator',
        speakerName: 'ファシリテーター', speakerRole: '',
        content: summaryResult.value, chapterIndex: currentChapterIndex,
      });
      state.history.push({
        id: summaryTurn.id, sessionId, turnIndex: state.currentTurnIndex,
        speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '',
        content: summaryResult.value, createdAt: new Date().toISOString(),
      });
      state.lastFacilitatorTurnIndex = state.currentTurnIndex;
      state.currentTurnIndex++;
    }

    // Turn 2: introduction of next chapter (chapterIndex = next)
    // DebateViewer inserts the next chapter heading before this turn
    if (nextChapter) {
      const introResult = await this.facilitator.generateChapterIntroduction(nextChapter, personas);
      if (introResult.ok) {
        const introTurn = await repo.createDebateTurn({
          sessionId, turnIndex: state.currentTurnIndex, speakerType: 'facilitator',
          speakerName: 'ファシリテーター', speakerRole: '',
          content: introResult.value.content, chapterIndex: nextChapter.index,
        });
        state.history.push({
          id: introTurn.id, sessionId, turnIndex: state.currentTurnIndex,
          speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '',
          content: introResult.value.content, createdAt: new Date().toISOString(),
        });
        state.lastFacilitatorTurnIndex = state.currentTurnIndex;
        state.lastAddressedPersonaId = introResult.value.firstPersonaId;
        state.lastAddressedByFacilitator = true;
        state.currentTurnIndex++;
      }
    }
  }
}
