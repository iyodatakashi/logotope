import * as repo from '../db/repository.js';
import { FacilitatorAgentService } from '../agents/facilitator-agent.js';
import { PersonaAgentService } from '../agents/persona-agent.js';
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

export const DEFAULT_OPTIONS: OrchestratorOptions = {
  maxTurns: 200,
  interventionInterval: 8,
  silenceThreshold: 5,
  minTurnsPerPersona: 6,
};

export interface DebateState {
  history: ConversationTurn[];
  currentBeliefs: Map<string, { content: string; version: number }>;
  silenceMap: Map<string, number>;
  speakCount: Map<string, number>;
  lastAddressedPersonaId: string | undefined;
  lastSpeakerId: string | undefined;
  consecutiveDirectExchanges: number;
  lastFacilitatorTurnIndex: number;
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
        lastSpeakerId: undefined,
        consecutiveDirectExchanges: 0,
        lastFacilitatorTurnIndex: 0,
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
        personaId: t.personaId ?? undefined,
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
      };

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
    startTurnIndex: number
  ): Promise<void> {
    const { maxTurns, interventionInterval, minTurnsPerPersona } = this.options;

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
        const llmPick = speakerResult.value;
        nextPersonaId = llmPick;
        // Enforce exclusion at code level in case LLM ignored the instruction
        if (nextPersonaId === state.lastSpeakerId && personas.length > 1) {
          nextPersonaId = personas.find(p => p.id !== state.lastSpeakerId)!.id;
        } else {
        }
        state.consecutiveDirectExchanges = 0;
      }

      // 2. Check intervention conditions
      // Skip when speaker was directly addressed — they must answer first
      const turnsSinceFacilitator = currentTurnIndex - state.lastFacilitatorTurnIndex;
      if (!fromDirectAddress && shouldEvaluateIntervention(state.silenceMap, personas.length, turnsSinceFacilitator, interventionInterval)) {
        evaluateParticipationBalance(state.speakCount, personas);
        const interventionResult = await this.facilitator.evaluateIntervention(
          state.history, personas, state.speakCount
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
            state.lastFacilitatorTurnIndex = currentTurnIndex;
            state.consecutiveDirectExchanges = 0;
            currentTurnIndex++;

            // Don't re-invite the last speaker; also validate the ID exists
            if (iv.targetPersonaId && personas.some(p => p.id === iv.targetPersonaId)) {
              if (iv.targetPersonaId !== state.lastSpeakerId || personas.length === 1) {
                nextPersonaId = iv.targetPersonaId;
              } else {
              }
            } else if (iv.targetPersonaId) {
            }
          }
        }
      }
      // Guard: resolve to a valid persona; prefer non-last-speaker on fallback
      const resolvedById = personas.find(p => p.id === nextPersonaId);
      if (!resolvedById) {
      }
      const persona =
        resolvedById ??
        personas.find(p => p.id !== state.lastSpeakerId) ??
        personas[0];
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
        speakerType: 'persona', personaId: persona.id, speakerName: persona.name, speakerRole: persona.stakeholderRole,
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
      state.lastSpeakerId = persona.id;

      // 7. Handle belief change
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

      // 8. Track next addressed persona (ignore self-address and unknown IDs)
      const addressed = turnResult.value.addressedToPersonaId;
      state.lastAddressedPersonaId =
        addressed && addressed !== persona.id && personas.some(p => p.id === addressed)
          ? addressed
          : undefined;

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
  }
}
