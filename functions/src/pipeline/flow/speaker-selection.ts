import type { PendingIntent, SpeakerDecision } from '../../types/index.js';

const MAX_CONSECUTIVE_DIRECT = 3;

export interface DirectAddressInput {
  pendingAddress?: { personaId: string; byFacilitator: boolean };
  consecutiveDirectExchanges: number;
  personaIds: ReadonlyArray<string>;
}

/** ターン冒頭: 前ターン由来の指名・直接質問で次話者が確定するか判定する */
export const resolveDirectAddress = (input: DirectAddressInput): SpeakerDecision | null => {
  const { pendingAddress, consecutiveDirectExchanges, personaIds } = input;
  if (!pendingAddress) return null;
  if (!personaIds.includes(pendingAddress.personaId)) return null;

  if (pendingAddress.byFacilitator) {
    return { personaId: pendingAddress.personaId, source: 'nomination' };
  }
  if (consecutiveDirectExchanges >= MAX_CONSECUTIVE_DIRECT) return null;
  return { personaId: pendingAddress.personaId, source: 'direct_address' };
};

export interface SpeakerAssessment {
  personaId: string;
  score: number;
  mode: 'opinion' | 'fact' | 'none';
  intentSummary?: string;
}

export interface SpeakerSelectionInput {
  assessments: ReadonlyArray<SpeakerAssessment>;
  interventionTargetId?: string;
  pendingIntents: ReadonlyMap<string, ReadonlyArray<PendingIntent>>;
  silenceMap: ReadonlyMap<string, number>;
  lastSpeakerId?: string;
  personaIds: ReadonlyArray<string>;
}

/** 選ばれた話者の発言は本人の意欲評価に従う（mode と score→長さ）。選ばれた以上は必ず発言するため none・低スコアは最小発言（score 2 / opinion）に切り上げる */
export const speechFromAssessment = (
  assessment?: { mode: 'opinion' | 'fact' | 'none'; score: number }
): { mode?: 'opinion' | 'fact'; score?: number } => {
  if (!assessment) return {};
  if (assessment.mode === 'none') return { mode: 'opinion', score: 2 };
  return { mode: assessment.mode, score: Math.max(2, assessment.score) };
};

/** 評価後: invite 指名 > キュー > スコアの順で決定する */
export const decideNextSpeaker = (input: SpeakerSelectionInput): SpeakerDecision => {
  const { interventionTargetId, pendingIntents, silenceMap, lastSpeakerId, personaIds } = input;
  const assessments = input.assessments.filter(a => personaIds.includes(a.personaId));

  const byScoreThenSilence = (a: SpeakerAssessment, b: SpeakerAssessment) =>
    b.score !== a.score
      ? b.score - a.score
      : (silenceMap.get(b.personaId) ?? 0) - (silenceMap.get(a.personaId) ?? 0);

  // (1) invite 指名（不正 ID は無視してスコア選択へ）
  if (interventionTargetId && personaIds.includes(interventionTargetId)) {
    return { personaId: interventionTargetId, source: 'nomination' };
  }

  // (3) 全員 score <= 3 → キューの最古エントリ保持者（直前話者を除く）。本人の意欲評価を発言に反映する
  const topScore = Math.max(0, ...assessments.map(a => a.score));
  if (topScore <= 3) {
    let oldestIdx = Infinity;
    let oldestPersonaId: string | undefined;
    for (const [personaId, items] of pendingIntents.entries()) {
      if (personaId === lastSpeakerId || !personaIds.includes(personaId) || items.length === 0) continue;
      const oldest = Math.min(...items.map(item => item.triggerTurnIndex));
      if (oldest < oldestIdx) {
        oldestIdx = oldest;
        oldestPersonaId = personaId;
      }
    }
    if (oldestPersonaId) {
      const items = [...(pendingIntents.get(oldestPersonaId) ?? [])]
        .sort((a, b) => a.triggerTurnIndex - b.triggerTurnIndex);
      return {
        personaId: oldestPersonaId,
        source: 'queue',
        intentSummary: items[0]?.intentSummary,
      };
    }
  }

  // (5) スコア降順（同点は沈黙優先）。直前話者は唯一の最高スコアでない限り回避
  const sorted = [...assessments].sort(byScoreThenSilence);
  if (sorted.length === 0) {
    const fallbackId = personaIds.find(id => id !== lastSpeakerId) ?? personaIds[0];
    return { personaId: fallbackId, source: 'score' };
  }
  const maxScore = sorted[0].score;
  const isLastSpeakerUniqueTop = sorted[0].personaId === lastSpeakerId
    && sorted.filter(a => a.score === maxScore).length === 1;
  const selected = isLastSpeakerUniqueTop
    ? sorted[0]
    : (sorted.find(a => a.personaId !== lastSpeakerId) ?? sorted[0]);
  return { personaId: selected.personaId, source: 'score' };
};
