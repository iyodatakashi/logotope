import * as repo from '../db/repository.js';
import { FacilitatorAgentService } from '../agents/facilitator-agent.js';
import { PersonaAgentService } from '../agents/persona-agent.js';
import { resolveDirectAddress, decideNextSpeaker } from './flow/speaker-selection.js';
import type { SpeakerAssessment } from './flow/speaker-selection.js';
import { toEngagementSignal, shouldEndChapterEarly, chapterTurnCap } from './flow/chapter-progress.js';
import { shouldEvaluateIntervention } from './flow/intervention-policy.js';
import { restoreDebateState } from './flow/state-restore.js';
import type { DebateState } from './flow/state-restore.js';
import type {
  PersonaAttributes,
  PipelineError,
  DebateChapter,
  SpeakerDecision,
} from '../types/index.js';

function pipelineErrorMessage(e: PipelineError): string {
  if ('message' in e) return e.message;
  if ('resource' in e) return `${e.code}: ${e.resource}`;
  return `${e.code}: expected=${e.expected} current=${e.current}`;
}

export interface OrchestratorOptions {
  turnsPerChapter: number;
  maxTurns: number;
  interventionCooldown: number;
}

export const DEFAULT_OPTIONS: OrchestratorOptions = {
  turnsPerChapter: 15,
  maxTurns: 200,
  interventionCooldown: 2,
};

const INTENT_EXPIRY_TURNS = 8;

/** ID が参加ペルソナに存在する場合のみ返す（LLM 由来の不正 ID を無視する） */
function validPersonaId(
  personaId: string | undefined,
  personas: ReadonlyArray<PersonaAttributes>
): string | undefined {
  return personaId && personas.some(p => p.id === personaId) ? personaId : undefined;
}

function toPersonaAttributes(p: repo.PersonaProfile): PersonaAttributes {
  return {
    id: p.id,
    stakeholderRole: p.stakeholderRole,
    specificRole: p.specificRole ?? p.stakeholderRole,
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

  /** 章立てのみを生成して保存する（討論を開始しない） */
  async generateChaptersOnly(topicId: string): Promise<void> {
    const { personas, topicTitle } = await this.loadSessionContext(topicId);
    const chaptersResult = await this.facilitator.generateChapters(topicTitle, personas);
    if (!chaptersResult.ok) throw new Error(pipelineErrorMessage(chaptersResult.error));
    const { chapters, generalIssues, personaIssues } = chaptersResult.value;
    await Promise.all([
      repo.saveChapters(topicId, chapters.map(c => ({
        index: c.index, title: c.title, focusQuestion: c.focusQuestion,
      }))),
      repo.saveChapterIssues(topicId, generalIssues, personaIssues),
    ]);
  }

  /** @returns 次章が存在する場合 true（呼び出し元が次章タスクを投入する） */
  async executeChapterTask(topicId: string, chapterIndex: number): Promise<boolean> {
    const sessionId = topicId;

    // 停止ゲート: トピックが討論かつ実行中でなければ何も生成・上書きしない
    if (!(await repo.isDebateActive(topicId))) return false;

    const session = await repo.getDebateSessionByTopicId(topicId);
    if (!session) throw new Error('Session not found');
    if (!session.chapters?.length) throw new Error('Chapters not found');

    // 冪等性: 処理済みの章はスキップする
    if (session.currentChapterIndex !== undefined && session.currentChapterIndex > chapterIndex) {
      return chapterIndex < (session.chapters?.length ?? 0) - 1;
    }

    const { personas, interviewRecords, currentBeliefs, topicTitle } =
      await this.loadSessionContext(topicId);

    const existingTurns = await repo.getDebateTurnsBySessionId(topicId);
    const persistedPendingIntents = await repo.loadPendingIntents(sessionId);
    const state = restoreDebateState({
      turns: existingTurns,
      personas,
      persistedPendingIntents,
      currentBeliefs,
    });

    const chapters: DebateChapter[] = (session.chapters ?? []).map(c => {
      const chapterTurns = state.history.filter(t => t.chapterIndex === c.index);
      const startTurnIdx = chapterTurns.length > 0
        ? Math.min(...chapterTurns.map(t => t.turnIndex))
        : state.currentTurnIndex;
      return { index: c.index, title: c.title, focusQuestion: c.focusQuestion, startTurnIndex: startTurnIdx };
    });

    // 第1章の開始: オープニング生成（章立ては generateChaptersOnly で事前に保存済み）
    if (chapterIndex === 0 && state.currentTurnIndex === 0) {
      const openingResult = await this.facilitator.generateOpening(topicTitle, personas, chapters[0]);
      if (!openingResult.ok) throw new Error(pipelineErrorMessage(openingResult.error));
      const firstPersonaId = validPersonaId(openingResult.value.firstPersonaId, personas);
      await this.saveFacilitatorTurn(sessionId, state, openingResult.value.content ?? '', 0, firstPersonaId);
      state.pendingAddress = firstPersonaId ? { personaId: firstPersonaId, byFacilitator: true } : undefined;
    }

    if (!chapters[chapterIndex]) throw new Error(`Chapter not found: ${chapterIndex}`);
    chapters[chapterIndex] = { ...chapters[chapterIndex], startTurnIndex: Math.min(chapters[chapterIndex].startTurnIndex, state.currentTurnIndex) };
    await repo.updateCurrentChapterIndex(topicId, chapterIndex);

    const outcome = await this.runChapterLoop(
      sessionId, topicId, personas, interviewRecords, chapters[chapterIndex], chapterIndex, state
    );
    if (outcome === 'cancelled') return false;

    // 章終了時に未応答の指名・直接質問が残っていれば応答ターンを1件生成する（+1ターン許容）
    await this.generateUnansweredReply(
      sessionId, topicId, personas, interviewRecords, chapters[chapterIndex], chapterIndex, state
    );

    const isLastChapter = chapterIndex >= chapters.length - 1;
    if (isLastChapter) {
      await this.finalizeDebate(sessionId, topicId, personas, state, chapterIndex);
      return false;
    }
    await this.generateChapterTransition(sessionId, chapters, chapterIndex, state, personas);
    return true;
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

  /**
   * ターンループ: 確定判定 →（並列: 意欲評価＋介入評価）→ 評価保存 → 介入ターン保存 →
   * 話者決定 → 発言生成 → ターン保存 → 状態更新 の固定順で進行する
   */
  private async runChapterLoop(
    sessionId: string,
    topicId: string,
    personas: PersonaAttributes[],
    interviewRecords: Map<string, string>,
    chapter: DebateChapter,
    chapterIndex: number,
    state: DebateState
  ): Promise<'cancelled' | 'ended'> {
    const { turnsPerChapter, maxTurns } = this.options;
    const personaIds = personas.map(p => p.id);
    const cap = chapterTurnCap(turnsPerChapter);
    let chapterTurnCount = state.history.filter(
      t => t.speakerType === 'persona' && t.chapterIndex === chapterIndex
    ).length;

    while (chapterTurnCount < cap && state.currentTurnIndex < maxTurns) {
      // 各ターン境界でトピックのゲートを確認する（上流再生成でフェーズが戻った場合も停止）
      if (!(await repo.isDebateActive(topicId))) return 'cancelled';

      // 1. ターン冒頭の確定判定（前ターン由来の指名・直接質問）
      const pendingAddress = state.pendingAddress;
      state.pendingAddress = undefined;
      let decision = resolveDirectAddress({
        pendingAddress,
        consecutiveDirectExchanges: state.consecutiveDirectExchanges,
        personaIds,
      });

      if (decision) {
        if (decision.source === 'nomination') {
          state.consecutiveDirectExchanges = 0;
        } else {
          state.consecutiveDirectExchanges++;
        }
        // 評価スキップターンは常に活性として記録する
        state.engagementSignals.push(1);
      } else {
        state.consecutiveDirectExchanges = 0;
        decision = await this.evaluateAndDecide(
          sessionId, personas, interviewRecords, chapter, chapterIndex, state, personaIds
        );
        // 介入ターンで討論全体の上限に達した場合は打ち切る
        if (state.currentTurnIndex >= maxTurns) break;
      }

      await this.generatePersonaTurn(
        sessionId, topicId, personas, interviewRecords, chapter, chapterIndex, state, decision
      );
      chapterTurnCount++;

      if (shouldEndChapterEarly({
        chapterTurnCount,
        targetTurns: turnsPerChapter,
        engagementSignals: state.engagementSignals,
      })) {
        return 'ended';
      }
    }
    return 'ended';
  }

  /** 並列評価（意欲＋介入）から次話者を決定する。介入発言・評価結果の保存とキュー追加の永続化を含む */
  private async evaluateAndDecide(
    sessionId: string,
    personas: PersonaAttributes[],
    interviewRecords: Map<string, string>,
    chapter: DebateChapter,
    chapterIndex: number,
    state: DebateState,
    personaIds: string[]
  ): Promise<SpeakerDecision> {
    const lastTurnIndex = state.history.length > 0
      ? state.history[state.history.length - 1].turnIndex
      : 0;

    // キュー失効（トリガーから8ターン超過）を適用し write-through
    for (const [personaId, items] of state.pendingIntents.entries()) {
      const alive = items.filter(item => state.currentTurnIndex - item.triggerTurnIndex <= INTENT_EXPIRY_TURNS);
      if (alive.length === items.length) continue;
      if (alive.length === 0) {
        state.pendingIntents.delete(personaId);
      } else {
        state.pendingIntents.set(personaId, alive);
      }
      await repo.setPendingIntents(sessionId, personaId, alive);
    }

    const assessTargets = personas.filter(p => p.id !== state.lastSpeakerId);
    const personaTurnsSinceFacilitator = state.history.filter(
      t => t.speakerType === 'persona' && t.turnIndex > state.lastFacilitatorTurnIndex
    ).length;
    const evaluateIntervention = shouldEvaluateIntervention({
      speakerPredetermined: false,
      personaTurnsSinceFacilitator,
      cooldownTurns: this.options.interventionCooldown,
    });

    const chapterHistory = state.history.filter(t => t.turnIndex >= chapter.startTurnIndex);

    // 意欲評価と介入評価は相互依存がないため並列実行する
    const [assessments, interventionResult] = await Promise.all([
      Promise.all(
        assessTargets.map(async (p): Promise<SpeakerAssessment> => {
          const result = await this.personaAgent.assessEngagement(
            p,
            state.currentBeliefs.get(p.id)?.content ?? '',
            interviewRecords.get(p.id) ?? '',
            state.history
          );
          // 評価失敗は最低意欲（score 1）として継続する
          return {
            personaId: p.id,
            score: result.ok ? result.value.score : 1,
            mode: result.ok ? result.value.mode : 'none',
            intentSummary: result.ok ? result.value.intentSummary : undefined,
          };
        })
      ),
      evaluateIntervention
        ? this.facilitator.evaluateIntervention(chapterHistory, personas, state.speakCount, chapter)
        : Promise.resolve(undefined),
    ]);

    // 活性シグナルをターンごとに必ず記録する
    state.engagementSignals.push(toEngagementSignal(assessments));

    // 評価結果を毎ターン保存する（管理画面での可視化用）
    await repo.saveEngagements({
      sessionId,
      turnIndex: lastTurnIndex,
      assessments: assessments.map(a => ({
        personaId: a.personaId,
        score: a.score,
        mode: a.mode,
        intentSummary: a.intentSummary,
      })),
    });

    // 介入発言の保存と invite 指名の解決（指名は targetPersonaId の ID 検証のみで行う）
    let interventionTargetId: string | undefined;
    if (interventionResult) {
      if (!interventionResult.ok) throw new Error(pipelineErrorMessage(interventionResult.error));
      const intervention = interventionResult.value;
      if (intervention.shouldIntervene) {
        interventionTargetId = validPersonaId(intervention.targetPersonaId, personas);
        await this.saveFacilitatorTurn(sessionId, state, intervention.content ?? '', chapterIndex, interventionTargetId);
      }
    }

    const decision = decideNextSpeaker({
      assessments,
      interventionTargetId,
      pendingIntents: state.pendingIntents,
      silenceMap: state.silenceMap,
      lastSpeakerId: state.lastSpeakerId,
      personaIds,
    });

    // キュー追加（score 5 で非選択）を発生の都度 write-through
    for (const assessment of assessments) {
      if (assessment.score < 5 || assessment.personaId === decision.personaId) continue;
      const existing = state.pendingIntents.get(assessment.personaId) ?? [];
      const updated = [...existing, { triggerTurnIndex: lastTurnIndex, intentSummary: assessment.intentSummary ?? '' }];
      state.pendingIntents.set(assessment.personaId, updated);
      await repo.setPendingIntents(sessionId, assessment.personaId, updated);
    }

    return decision;
  }

  /** 決定に基づきペルソナ発言を生成・保存し、状態（沈黙・キュー・信念・次ターン指名）を更新する */
  private async generatePersonaTurn(
    sessionId: string,
    topicId: string,
    personas: PersonaAttributes[],
    interviewRecords: Map<string, string>,
    chapter: DebateChapter,
    chapterIndex: number,
    state: DebateState,
    decision: SpeakerDecision
  ): Promise<void> {
    const persona = personas.find(p => p.id === decision.personaId)!;
    const belief = state.currentBeliefs.get(persona.id) ?? { content: '', version: 0 };
    const interviewRecord = interviewRecords.get(persona.id) ?? '';
    const fromQueue = decision.source === 'queue';

    const chapterHistory = state.history.filter(t => t.turnIndex >= chapter.startTurnIndex);
    const pendingEntries = state.pendingIntents.get(persona.id);
    let pendingTrigger: { speakerName: string; content: string } | undefined;
    if (pendingEntries && pendingEntries.length > 0) {
      const triggerTurn = state.history.find(t => t.turnIndex === pendingEntries[0].triggerTurnIndex);
      pendingTrigger = triggerTurn
        ? { speakerName: triggerTurn.speakerName ?? '', content: triggerTurn.content }
        : undefined;
    }

    const turnResult = await this.personaAgent.generateTurn(persona, belief.content, interviewRecord, {
      chapterHistory,
      chapter,
      mode: decision.mode,
      intentSummary: decision.intentSummary,
      pendingTrigger,
      nominatedByFacilitator: decision.source === 'nomination',
    });
    if (!turnResult.ok) throw new Error(pipelineErrorMessage(turnResult.error));

    // 直接質問先は ID 検証のうえターンに永続化する（自分自身への指定は無視）
    const rawAddressed = turnResult.value.addressedToPersonaId;
    const addressedPersonaId = rawAddressed !== persona.id
      ? validPersonaId(rawAddressed, personas)
      : undefined;

    const savedTurn = await repo.createDebateTurn({
      sessionId, turnIndex: state.currentTurnIndex, speakerType: 'persona',
      personaId: persona.id, speakerName: persona.name, speakerRole: persona.specificRole,
      content: turnResult.value.content ?? '',
      chapterIndex, speechMode: turnResult.value.speechMode,
      fromQueue: fromQueue || undefined,
      addressedPersonaId,
    });
    state.history.push({
      id: savedTurn.id, sessionId, turnIndex: state.currentTurnIndex,
      speakerType: 'persona', personaId: persona.id,
      speakerName: persona.name, speakerRole: persona.specificRole,
      content: turnResult.value.content, createdAt: new Date().toISOString(),
      chapterIndex, fromQueue: fromQueue || undefined,
      addressedPersonaId,
    });

    for (const p of personas) {
      state.silenceMap.set(
        p.id,
        p.id === persona.id ? 0 : (state.silenceMap.get(p.id) ?? 0) + 1
      );
    }
    state.speakCount.set(persona.id, (state.speakCount.get(persona.id) ?? 0) + 1);
    state.lastSpeakerId = persona.id;

    // 発言後: そのペルソナの最古キューエントリを1件消費し write-through
    if (pendingEntries && pendingEntries.length > 0) {
      const remaining = pendingEntries.slice(1);
      if (remaining.length === 0) {
        state.pendingIntents.delete(persona.id);
      } else {
        state.pendingIntents.set(persona.id, remaining);
      }
      await repo.setPendingIntents(sessionId, persona.id, remaining);
    }

    // 信念変化の保存と以後のターンへの反映
    if (turnResult.value.beliefChange) {
      const beliefChange = turnResult.value.beliefChange;
      const newVersion = belief.version + 1;
      await repo.createPersonaBelief({
        topicId,
        personaId: persona.id,
        version: newVersion,
        content: beliefChange.updatedBelief,
        changeType: beliefChange.type,
        changeSummary: beliefChange.summary,
        triggeredByTurnId: savedTurn.id,
      });
      state.currentBeliefs.set(persona.id, { content: beliefChange.updatedBelief, version: newVersion });
    }

    // 直接質問の引き継ぎ
    state.pendingAddress = addressedPersonaId
      ? { personaId: addressedPersonaId, byFacilitator: false }
      : undefined;

    state.currentTurnIndex++;
  }

  /** 章終了時に未応答の指名・直接質問が残っていれば応答ターンを1件生成する（要件 2.7） */
  private async generateUnansweredReply(
    sessionId: string,
    topicId: string,
    personas: PersonaAttributes[],
    interviewRecords: Map<string, string>,
    chapter: DebateChapter,
    chapterIndex: number,
    state: DebateState
  ): Promise<void> {
    const pendingAddress = state.pendingAddress;
    state.pendingAddress = undefined;
    if (!pendingAddress) return;

    const decision = resolveDirectAddress({
      pendingAddress,
      consecutiveDirectExchanges: 0,
      personaIds: personas.map(p => p.id),
    });
    if (!decision) return;

    await this.generatePersonaTurn(
      sessionId, topicId, personas, interviewRecords, chapter, chapterIndex, state, decision
    );
    // 章は終了するため、応答ターン由来の直接質問は引き継がない
    state.pendingAddress = undefined;
  }

  /** ファシリテーター発言を chapterIndex・指名先 ID 付きで保存し、クールダウン起点を更新する */
  private async saveFacilitatorTurn(
    sessionId: string,
    state: DebateState,
    content: string,
    chapterIndex: number,
    addressedPersonaId?: string
  ): Promise<void> {
    const turn = await repo.createDebateTurn({
      sessionId, turnIndex: state.currentTurnIndex, speakerType: 'facilitator',
      speakerName: 'ファシリテーター', speakerRole: '',
      content, chapterIndex, addressedPersonaId,
    });
    state.history.push({
      id: turn.id, sessionId, turnIndex: state.currentTurnIndex,
      speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '',
      content, createdAt: new Date().toISOString(), chapterIndex, addressedPersonaId,
    });
    state.lastFacilitatorTurnIndex = state.currentTurnIndex;
    state.consecutiveDirectExchanges = 0;
    state.currentTurnIndex++;
  }

  /** 章遷移: 現章まとめ＋次章導入の2ターンを生成し、導入で最初の発言者を指名する */
  private async generateChapterTransition(
    sessionId: string,
    chapters: DebateChapter[],
    currentChapterIndex: number,
    state: DebateState,
    personas: PersonaAttributes[]
  ): Promise<void> {
    const chapter = chapters[currentChapterIndex];
    const nextChapter = chapters[currentChapterIndex + 1];
    const recentHistory = state.history.slice(-10);

    const summaryResult = await this.facilitator.generateChapterSummary(recentHistory, chapter);
    if (summaryResult.ok) {
      await this.saveFacilitatorTurn(sessionId, state, summaryResult.value, currentChapterIndex);
    }

    // 公開ページ DebateViewer は導入ターンの chapterIndex を章見出し挿入に使用する
    const introResult = await this.facilitator.generateChapterIntroduction(nextChapter, personas);
    if (introResult.ok) {
      const firstPersonaId = validPersonaId(introResult.value.firstPersonaId, personas);
      await this.saveFacilitatorTurn(sessionId, state, introResult.value.content, nextChapter.index, firstPersonaId);
      state.pendingAddress = firstPersonaId ? { personaId: firstPersonaId, byFacilitator: true } : undefined;
    }
  }

  /** 討論終端: クロージング → 事後コメント → セッション完了 */
  private async finalizeDebate(
    sessionId: string,
    topicId: string,
    personas: PersonaAttributes[],
    state: DebateState,
    chapterIndex: number
  ): Promise<void> {
    const finalBeliefs = new Map(
      Array.from(state.currentBeliefs.entries()).map(([id, b]) => [id, b.content])
    );
    const closingResult = await this.facilitator.generateClosing(state.history, finalBeliefs);
    if (!closingResult.ok) throw new Error(pipelineErrorMessage(closingResult.error));
    await this.saveFacilitatorTurn(sessionId, state, closingResult.value ?? '', chapterIndex);

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

    // セッションには討論コンテンツ（totalTurns/completedAt）のみ書き、
    // 進行状態は「実行中のときのみ generated」で確定する（停止を上書きしない）
    await repo.completeDebateSession(sessionId, state.currentTurnIndex);
    await repo.finalizeTopicIfRunning(topicId);
  }
}
