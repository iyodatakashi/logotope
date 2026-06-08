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
} from '../types/index.js';

function pipelineErrorMessage(e: PipelineError): string {
  if ('message' in e) return e.message;
  if ('resource' in e) return `${e.code}: ${e.resource}`;
  return `${e.code}: expected=${e.expected} current=${e.current}`;
}

export interface OrchestratorOptions {
  maxTurns: number;
  interventionInterval: number;
  silenceThreshold: number;
  minTurnsPerPersona: number;
}

const DEFAULT_OPTIONS: OrchestratorOptions = {
  maxTurns: 60,
  interventionInterval: 8,
  silenceThreshold: 5,
  minTurnsPerPersona: 6,
};

interface DebateState {
  history: ConversationTurn[];
  currentBeliefs: Map<string, { content: string; version: number }>;
  silenceMap: Map<string, number>;
  speakCount: Map<string, number>;
  lastAddressedPersonaId: string | undefined;
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
      await this.tracker.updateStatus(topicId, 'debating', '討論開始中...').catch(() => undefined);

      const { personas, interviewRecords, currentBeliefs, topicTitle } =
        await this.loadSessionContext(topicId);

      const state: DebateState = {
        history: [],
        currentBeliefs,
        silenceMap: new Map(personas.map(p => [p.id, 0])),
        speakCount: new Map(personas.map(p => [p.id, 0])),
        lastAddressedPersonaId: undefined,
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

      // Reconstruct history from existing turns
      const existingTurns = await repo.getDebateTurnsBySessionId(sessionId);
      const priorTurns = existingTurns
        .filter(t => t.turnIndex < fromTurnIndex)
        .sort((a, b) => a.turnIndex - b.turnIndex);

      const history: ConversationTurn[] = priorTurns.map(t => ({
        turnId: t.id,
        turnIndex: t.turnIndex,
        speakerType: t.speakerType as SpeakerType,
        speakerName: t.personaId
          ? (personas.find(p => p.id === t.personaId)?.name ?? '')
          : 'ファシリテーター',
        speakerRole: t.personaId
          ? (personas.find(p => p.id === t.personaId)?.stakeholderRole ?? '')
          : '',
        content: t.content,
      }));

      // Rebuild speakCount and silenceMap from prior turns
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

      const state: DebateState = {
        history,
        currentBeliefs,
        silenceMap,
        speakCount,
        lastAddressedPersonaId: undefined,
      };

      await this.tracker.updateStatus(topicId, 'debating', `ターン${fromTurnIndex}から再開中...`).catch(() => undefined);
      await this.executeDebate(sessionId, topicId, topicTitle, personas, interviewRecords, state, fromTurnIndex);
      return { ok: true, value: undefined };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: { code: 'AI_API_ERROR', message, retryable: true } };
    }
  }

  private async loadSessionContext(topicId: string) {
    const topic = await repo.getTopicById(topicId);
    if (!topic) throw new Error(`Topic not found: ${topicId}`);

    const profiles = await repo.getApprovedPersonasByTopicId(topicId);
    const personas = profiles.map(toPersonaAttributes);

    const currentBeliefs = new Map<string, { content: string; version: number }>();
    const interviewRecords = new Map<string, string>();

    for (const p of personas) {
      const beliefs = await repo.getPersonaBeliefsByPersonaId(p.id);
      const latest = beliefs.reduce(
        (best, b) => b.version > best.version ? b : best,
        beliefs[0]
      );
      currentBeliefs.set(p.id, { content: latest?.content ?? '', version: latest?.version ?? 0 });

      const interview = await repo.getPersonaInterviewByPersonaId(p.id);
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
    startTurnIndex: number
  ): Promise<void> {
    const { maxTurns, interventionInterval, silenceThreshold, minTurnsPerPersona } = this.options;

    // Opening (only when starting fresh)
    if (startTurnIndex === 0) {
      const openingResult = await this.facilitator.generateOpening(topicTitle, personas);
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
    }

    let currentTurnIndex = Math.max(1, startTurnIndex);
    let debateEnded = false;

    while (currentTurnIndex < maxTurns && !debateEnded) {
      // 1. Determine next speaker
      let nextPersonaId: string;
      if (state.lastAddressedPersonaId) {
        nextPersonaId = state.lastAddressedPersonaId;
        state.lastAddressedPersonaId = undefined;
      } else {
        const speakerResult = await this.facilitator.selectNextSpeaker(
          state.history, personas, state.silenceMap
        );
        if (!speakerResult.ok) throw new Error(pipelineErrorMessage(speakerResult.error));
        nextPersonaId = speakerResult.value;
      }

      // 2. Check intervention conditions
      const hasSilence = Array.from(state.silenceMap.values()).some(s => s > silenceThreshold);
      if (currentTurnIndex % interventionInterval === 0 || hasSilence) {
        const interventionResult = await this.facilitator.evaluateIntervention(
          state.history, personas
        );
        if (!interventionResult.ok) throw new Error(pipelineErrorMessage(interventionResult.error));

        const iv = interventionResult.value;
        if (iv.shouldIntervene) {
          if (iv.type === 'close') {
            const allMet = personas.every(
              p => (state.speakCount.get(p.id) ?? 0) >= minTurnsPerPersona
            );
            if (allMet) {
              debateEnded = true;
              break;
            }
            // Not accepted — continue without intervention
          } else {
            // Save visible facilitator intervention turn
            await repo.createDebateTurn({
              sessionId, turnIndex: currentTurnIndex, speakerType: 'facilitator',
              content: iv.content ?? '',
            });
            state.history.push({
              turnId: `facilitator-${currentTurnIndex}`, turnIndex: currentTurnIndex,
              speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '',
              content: iv.content ?? '',
            });
            currentTurnIndex++;

            if (iv.targetPersonaId) {
              nextPersonaId = iv.targetPersonaId;
            }
          }
        }
      }

      // Guard: ensure the persona exists
      const persona = personas.find(p => p.id === nextPersonaId) ?? personas[0];
      const belief = state.currentBeliefs.get(persona.id)!;
      const interviewRecord = interviewRecords.get(persona.id) ?? '';

      // 3. Generate persona turn
      const turnResult = await this.personaAgent.generateTurn(
        persona, belief.content, interviewRecord, state.history
      );
      if (!turnResult.ok) throw new Error(pipelineErrorMessage(turnResult.error));

      // 4. Save persona turn
      const savedTurn = await repo.createDebateTurn({
        sessionId, turnIndex: currentTurnIndex, speakerType: 'persona',
        personaId: persona.id, content: turnResult.value.content ?? '',
      });

      // 5. Update history
      state.history.push({
        turnId: savedTurn.id, turnIndex: currentTurnIndex,
        speakerType: 'persona', speakerName: persona.name, speakerRole: persona.stakeholderRole,
        content: turnResult.value.content,
      });

      // 6. Update silenceMap and speakCount
      for (const p of personas) {
        state.silenceMap.set(
          p.id,
          p.id === persona.id ? 0 : (state.silenceMap.get(p.id) ?? 0) + 1
        );
      }
      state.speakCount.set(persona.id, (state.speakCount.get(persona.id) ?? 0) + 1);

      // 7. Handle belief change
      if (turnResult.value.beliefChange) {
        const bc = turnResult.value.beliefChange;
        const newVersion = belief.version + 1;
        await repo.createPersonaBelief({
          personaId: persona.id,
          version: newVersion,
          content: bc.updatedBelief,
          changeType: bc.type,
          changeSummary: bc.summary,
          triggeredByTurnId: savedTurn.id,
        });
        state.currentBeliefs.set(persona.id, { content: bc.updatedBelief, version: newVersion });
      }

      // 8. Track next addressed persona
      state.lastAddressedPersonaId = turnResult.value.addressedToPersonaId;

      // 9. Update progress
      await this.tracker.updateProgress(topicId, currentTurnIndex, maxTurns).catch(() => undefined);

      currentTurnIndex++;
    }

    // Closing
    const finalBeliefs = new Map(
      Array.from(state.currentBeliefs.entries()).map(([id, b]) => [id, b.content])
    );
    const closingResult = await this.facilitator.generateClosing(state.history, finalBeliefs);
    if (!closingResult.ok) throw new Error(pipelineErrorMessage(closingResult.error));

    await repo.createDebateTurn({
      sessionId, turnIndex: currentTurnIndex, speakerType: 'facilitator',
      content: closingResult.value ?? '',
    });
    state.history.push({
      turnId: 'closing', turnIndex: currentTurnIndex,
      speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '',
      content: closingResult.value ?? '',
    });
    currentTurnIndex++;

    // Post-debate comments
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

    // Complete session
    await repo.completeDebateSession(sessionId, currentTurnIndex);
    await this.tracker.updateStatus(topicId, 'completed').catch(() => undefined);
  }
}
