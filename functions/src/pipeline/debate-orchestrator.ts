import * as repo from '../db/repository.js';
import { FacilitatorAgentService } from '../agents/facilitator-agent.js';
import { PersonaAgentService } from '../agents/persona-agent.js';
import { ProgressTrackerService } from './progress-tracker.js';
import type {
  ConversationTurn,
  PersonaAttributes,
  SpeakerType,
  Result,
  PipelineError,
  DebateChapter,
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
  history: ConversationTurn[];
  currentBeliefs: Map<string, { content: string; version: number }>;
  silenceMap: Map<string, number>;
  speakCount: Map<string, number>;
  lastAddressedPersonaId: string | undefined;
  lastSpeakerId: string | undefined;
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
  if (maxSilence > personasCount) return true;
  if (turnsSinceFacilitator >= interventionInterval) return true;
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
  };
}

export class DebateOrchestratorService {
  constructor(
    private facilitator: FacilitatorAgentService = new FacilitatorAgentService(),
    private personaAgent: PersonaAgentService = new PersonaAgentService(),
    private tracker: ProgressTrackerService = new ProgressTrackerService(),
    private options: OrchestratorOptions = DEFAULT_OPTIONS
  ) {}

  async run(sessionId: string, topicId: string): Promise<Result<void, PipelineError>> {
    try {
      await this.tracker.updateStatus(topicId, 'debating');

      const { personas, interviewRecords, currentBeliefs, topicTitle } =
        await this.loadSessionContext(topicId);

      const state: DebateState = {
        history: [],
        currentBeliefs,
        silenceMap: new Map(personas.map(p => [p.id, 0])),
        speakCount: new Map(personas.map(p => [p.id, 0])),
        lastAddressedPersonaId: undefined,
        lastSpeakerId: undefined,
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
      await this.tracker.updateStatus(topicId, 'debating');

      const { personas, interviewRecords, currentBeliefs, topicTitle } =
        await this.loadSessionContext(topicId);

      const existingTurns = await repo.getDebateTurnsBySessionId(sessionId);
      const priorTurns = existingTurns
        .filter(t => t.turnIndex < fromTurnIndex)
        .sort((a, b) => a.turnIndex - b.turnIndex);

      const history: ConversationTurn[] = priorTurns.map(t => ({
        turnId: t.id,
        turnIndex: t.turnIndex,
        speakerType: t.speakerType as SpeakerType,
        personaId: t.personaId ?? undefined,
        speakerName: t.personaId
          ? (personas.find(p => p.id === t.personaId)?.name ?? '')
          : 'ファシリテーター',
        speakerRole: t.personaId
          ? (personas.find(p => p.id === t.personaId)?.stakeholderRole ?? '')
          : '',
        content: t.content,
      }));

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

      const state: DebateState = {
        history,
        currentBeliefs,
        silenceMap,
        speakCount,
        lastAddressedPersonaId: undefined,
        lastSpeakerId: undefined,
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

      await repo.createDebateTurn({
        sessionId, turnIndex: 0, speakerType: 'facilitator',
        content: openingResult.value.content ?? '',
      });
      state.history.push({
        turnId: 'opening', turnIndex: 0, speakerType: 'facilitator',
        speakerName: 'ファシリテーター', speakerRole: '', content: openingResult.value.content,
      });
      state.lastAddressedPersonaId = openingResult.value.firstPersonaId;
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

    await repo.createDebateTurn({
      sessionId, turnIndex: state.currentTurnIndex, speakerType: 'facilitator',
      content: closingResult.value ?? '',
    });
    state.history.push({
      turnId: 'closing', turnIndex: state.currentTurnIndex,
      speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '',
      content: closingResult.value ?? '',
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

    const history: ConversationTurn[] = existingTurns.map(t => ({
      turnId: t.id,
      turnIndex: t.turnIndex,
      speakerType: t.speakerType as SpeakerType,
      personaId: t.personaId ?? undefined,
      speakerName: t.personaId
        ? (personas.find(p => p.id === t.personaId)?.name ?? '')
        : 'ファシリテーター',
      speakerRole: t.personaId
        ? (personas.find(p => p.id === t.personaId)?.stakeholderRole ?? '')
        : '',
      content: t.content,
    }));

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
      history,
      currentBeliefs,
      silenceMap,
      speakCount,
      lastAddressedPersonaId: undefined,
      lastSpeakerId: undefined,
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
      await repo.createDebateTurn({
        sessionId, turnIndex: 0, speakerType: 'facilitator',
        content: openingResult.value.content ?? '', chapterIndex: 0,
      });
      state.history.push({
        turnId: 'opening', turnIndex: 0, speakerType: 'facilitator',
        speakerName: 'ファシリテーター', speakerRole: '', content: openingResult.value.content,
      });
      state.lastAddressedPersonaId = openingResult.value.firstPersonaId;
      state.currentTurnIndex = 1;
    }

    chapters[chapterIndex] = { ...chapters[chapterIndex], startTurnIndex: state.currentTurnIndex };
    await repo.updateCurrentChapterIndex(topicId, chapterIndex);

    await this.executeChapter(
      sessionId, topicId, personas, interviewRecords, chapters, chapterIndex, state,
      0, Number.MAX_SAFE_INTEGER
    );

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
    const chapter = chapters[chapterIndex];
    const targetTurnsPerChapter = turnsPerChapter;
    const maxChapterTurns = Math.ceil(targetTurnsPerChapter * 1.5);
    let chapterTurnCount = initialChapterTurnCount;
    const chapterSpeaks = new Map<string, number>(personas.map(p => [p.id, 0]));

    while (chapterTurnCount < maxChapterTurns && state.currentTurnIndex < globalTurnCap) {
      // 1. Determine next speaker
      let nextPersonaId: string;
      const pendingAddress = state.lastAddressedPersonaId;
      state.lastAddressedPersonaId = undefined;
      const MAX_CONSECUTIVE_DIRECT = 3;
      const fromDirectAddress = !!pendingAddress
        && personas.some(p => p.id === pendingAddress)
        && state.consecutiveDirectExchanges < MAX_CONSECUTIVE_DIRECT;
      if (fromDirectAddress) {
        nextPersonaId = pendingAddress!;
        state.consecutiveDirectExchanges++;
      } else {
        const speakerResult = await this.facilitator.selectNextSpeaker(
          state.history, personas, state.silenceMap, state.lastSpeakerId
        );
        if (!speakerResult.ok) throw new Error(pipelineErrorMessage(speakerResult.error));
        nextPersonaId = speakerResult.value;
        if (nextPersonaId === state.lastSpeakerId && personas.length > 1) {
          nextPersonaId = personas.find(p => p.id !== state.lastSpeakerId)!.id;
        }
        state.consecutiveDirectExchanges = 0;
      }

      // 2. Intervention check — close is ignored in chapter loop
      const turnsSinceFacilitator = state.currentTurnIndex - state.lastFacilitatorTurnIndex;
      if (!fromDirectAddress && shouldEvaluateIntervention(state.silenceMap, personas.length, turnsSinceFacilitator, interventionInterval)) {
        evaluateParticipationBalance(state.speakCount, personas);
        const interventionResult = await this.facilitator.evaluateIntervention(
          state.history, personas, state.speakCount, chapter
        );
        if (!interventionResult.ok) throw new Error(pipelineErrorMessage(interventionResult.error));

        const iv = interventionResult.value;
        if (iv.shouldIntervene && iv.type !== 'close') {
          await repo.createDebateTurn({
            sessionId, turnIndex: state.currentTurnIndex, speakerType: 'facilitator',
            content: iv.content ?? '',
          });
          state.history.push({
            turnId: `facilitator-${state.currentTurnIndex}`, turnIndex: state.currentTurnIndex,
            speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '',
            content: iv.content ?? '',
          });
          state.lastFacilitatorTurnIndex = state.currentTurnIndex;
          state.consecutiveDirectExchanges = 0;
          state.currentTurnIndex++;

          if (iv.targetPersonaId && personas.some(p => p.id === iv.targetPersonaId)) {
            if (iv.targetPersonaId !== state.lastSpeakerId || personas.length === 1) {
              nextPersonaId = iv.targetPersonaId;
            }
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

      // 4. Generate persona turn
      const turnResult = await this.personaAgent.generateTurn(
        persona, belief.content, interviewRecord, state.history, chapter
      );
      if (!turnResult.ok) throw new Error(pipelineErrorMessage(turnResult.error));

      // 5. Save persona turn with chapterIndex
      const savedTurn = await repo.createDebateTurn({
        sessionId, turnIndex: state.currentTurnIndex, speakerType: 'persona',
        personaId: persona.id, content: turnResult.value.content ?? '',
        chapterIndex,
      });

      // 6. Update history
      state.history.push({
        turnId: savedTurn.id, turnIndex: state.currentTurnIndex,
        speakerType: 'persona', personaId: persona.id, speakerName: persona.name, speakerRole: persona.stakeholderRole,
        content: turnResult.value.content,
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

      state.currentTurnIndex++;
      chapterTurnCount++;

      // 10. Check chapter end after reaching target
      //     Gate: all personas must have spoken at least minSpeaksPerPersonaInChapter times
      const allPersonasSpoke = personas.every(
        p => (chapterSpeaks.get(p.id) ?? 0) >= minSpeaksPerPersonaInChapter
      );
      if (chapterTurnCount >= targetTurnsPerChapter && allPersonasSpoke) {
        const chapterHistory = state.history.filter(h => h.turnIndex >= chapter.startTurnIndex);
        const endResult = await this.facilitator.evaluateChapterEnd(chapterHistory, chapter);
        if (endResult.ok && endResult.value) {
          if (chapterIndex < chapters.length - 1) {
            await this.generateAndSaveChapterTransition(sessionId, chapters, chapterIndex, state);
          }
          return;
        }
      }
    }

    // Forced transition (150% reached but not last chapter)
    if (chapterIndex < chapters.length - 1) {
      await this.generateAndSaveChapterTransition(sessionId, chapters, chapterIndex, state);
    }
  }

  private async generateAndSaveChapterTransition(
    sessionId: string,
    chapters: DebateChapter[],
    currentChapterIndex: number,
    state: DebateState
  ): Promise<void> {
    const chapter = chapters[currentChapterIndex];
    const nextChapter = chapters[currentChapterIndex + 1];
    const recentHistory = state.history.slice(-10);

    const transitionResult = await this.facilitator.generateChapterTransition(
      recentHistory, chapter, nextChapter
    );
    if (transitionResult.ok) {
      await repo.createDebateTurn({
        sessionId, turnIndex: state.currentTurnIndex, speakerType: 'facilitator',
        content: transitionResult.value,
      });
      state.history.push({
        turnId: `chapter-transition-${currentChapterIndex}`, turnIndex: state.currentTurnIndex,
        speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '',
        content: transitionResult.value,
      });
      state.lastFacilitatorTurnIndex = state.currentTurnIndex;
      state.currentTurnIndex++;
    }
  }
}
