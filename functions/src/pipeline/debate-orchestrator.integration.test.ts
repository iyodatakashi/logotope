import { describe, it, expect, vi, beforeAll } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as repo from '../db/repository.js';
import { DebateOrchestratorService } from './debate-orchestrator.js';
import type { OrchestratorOptions } from './debate-orchestrator.js';
import type { FacilitatorAgentService } from '../agents/facilitator-agent.js';
import type { PersonaAgentService } from '../agents/persona-agent.js';
import type { DebateChapter } from '../types/index.js';

// 実 Firestore エミュレータ＋モックエージェントによる章タスクの統合テスト
// （FIRESTORE_EMULATOR_HOST は tests/setup/firebase-emulators.ts で設定）

beforeAll(() => {
  if (getApps().length === 0) {
    initializeApp({ projectId: 'demo-logotope' });
  }
});

const db = () => getFirestore();

interface SeedPersona {
  id: string;
  name: string;
  stakeholderRole: string;
}

const defaultPersonas: SeedPersona[] = [
  { id: 'p1', name: '田中太郎', stakeholderRole: '医師' },
  { id: 'p2', name: '鈴木花子', stakeholderRole: '患者' },
  { id: 'p3', name: '山田次郎', stakeholderRole: '研究者' },
];

let topicCounter = 0;
const uniqueTopicId = () => `it-topic-${Date.now()}-${topicCounter++}`;

async function seedTopic(topicId: string, personas: SeedPersona[] = defaultPersonas): Promise<void> {
  await db().doc(`topics/${topicId}`).set({
    title: 'AI医療診断の導入',
    phase: 5,
    phaseStatus: 'running',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  for (let i = 0; i < personas.length; i++) {
    const p = personas[i];
    await db().doc(`topics/${topicId}/personas/${p.id}`).set({
      id: p.id,
      topicId,
      stakeholderRole: p.stakeholderRole,
      name: p.name,
      age: 40,
      occupation: '会社員',
      background: '背景',
      interests: '関心事',
      approved: true,
      sortOrder: i,
      beliefs: [{ id: `belief-${p.id}`, version: 0, content: '# 初期信念', createdAt: Timestamp.now() }],
      interview: { interviewRecord: '取材記録', status: 'completed' },
      createdAt: Timestamp.now(),
    });
  }
  await db().doc(`topics/${topicId}/sessions/0`).set({
    createdAt: Timestamp.now(),
    turns: [],
    postDebateComments: [],
  });
}

const twoChapters: DebateChapter[] = [
  { index: 0, title: '導入', focusQuestion: 'この問題の核心は何か？', startTurnIndex: 0 },
  { index: 1, title: '核心的対立', focusQuestion: '最も意見が分かれる点はどこか？', startTurnIndex: 0 },
];

function makeMockFacilitator(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    generateOpening: vi.fn().mockResolvedValue({ ok: true, value: { content: '討論を始めます。', firstPersonaId: 'p1' } }),
    evaluateIntervention: vi.fn().mockResolvedValue({ ok: true, value: { shouldIntervene: false } }),
    generateClosing: vi.fn().mockResolvedValue({ ok: true, value: 'お疲れ様でした。' }),
    generateChapters: vi.fn().mockResolvedValue({ ok: true, value: twoChapters }),
    generateChapterSummary: vi.fn().mockResolvedValue({ ok: true, value: '章のまとめです。' }),
    generateChapterIntroduction: vi.fn().mockResolvedValue({ ok: true, value: { content: '次の章へ移ります。', firstPersonaId: 'p1' } }),
    ...overrides,
  } as unknown as FacilitatorAgentService;
}

type AssessImpl = (personaId: string) => { score: number; mode: 'opinion' | 'fact' | 'none'; intentSummary?: string };

function makeMockPersonaAgent(
  assessImplRef: { current: AssessImpl },
  overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}
) {
  return {
    generateTurn: vi.fn().mockResolvedValue({ ok: true, value: { content: '私の意見です。', speechMode: 'opinion', beliefChange: null, addressedToPersonaId: undefined } }),
    assessEngagement: vi.fn().mockImplementation(async (persona: { id: string }) => ({
      ok: true,
      value: assessImplRef.current(persona.id),
    })),
    generatePostDebateComment: vi.fn().mockImplementation(async (persona: { id: string }) => ({
      ok: true, value: { personaId: persona.id, content: '討論後のコメントです。' },
    })),
    ...overrides,
  } as unknown as PersonaAgentService;
}

const lowEngagement: AssessImpl = () => ({ score: 2, mode: 'opinion' });

const shortOptions: OrchestratorOptions = {
  turnsPerChapter: 1, // 章上限 = ceil(1.5) = 2 ターン
  maxTurns: 40,
  interventionCooldown: 99, // 介入評価は行わない
};

describe('executeChapterTask 統合テスト（Firestore エミュレータ）', () => {
  it('意図キューが章をまたいで復元され、キュー発言として消費される（消失バグの回帰テスト）', async () => {
    const topicId = uniqueTopicId();
    await seedTopic(topicId);

    // 第1章: p3 が緊急リアクションで選ばれ、p2（score 5・未選択）がキューに入る
    const assessImplRef = { current: ((personaId: string) => {
      if (personaId === 'p2') return { score: 5, mode: 'opinion' as const, intentSummary: '持ち越したい意見' };
      if (personaId === 'p3') return { score: 5, mode: 'opinion' as const };
      return { score: 2, mode: 'opinion' as const };
    }) as AssessImpl };
    const personaAgent = makeMockPersonaAgent(assessImplRef);
    const chapter0 = new DebateOrchestratorService(makeMockFacilitator(), personaAgent, shortOptions);

    const hasNext = await chapter0.executeChapterTask(topicId, 0);
    expect(hasNext).toBe(true);

    // キューが Firestore に write-through されている
    const persistedAfterChapter0 = await repo.loadPendingIntents(topicId);
    expect(persistedAfterChapter0.get('p2')).toEqual([
      expect.objectContaining({ intentSummary: '持ち越したい意見' }),
    ]);

    // 第2章: 全員低意欲 → 復元されたキューから p2 が発言する
    assessImplRef.current = lowEngagement;
    const chapter1 = new DebateOrchestratorService(makeMockFacilitator(), makeMockPersonaAgent(assessImplRef), shortOptions);

    await chapter1.executeChapterTask(topicId, 1);

    const turns = await repo.getDebateTurnsBySessionId(topicId);
    const queueTurn = turns.find(t => t.fromQueue);
    expect(queueTurn).toBeDefined();
    expect(queueTurn!.personaId).toBe('p2');
    expect(queueTurn!.chapterIndex).toBe(1);

    // 消費後のキューは空に write-through されている
    const persistedAfterChapter1 = await repo.loadPendingIntents(topicId);
    expect(persistedAfterChapter1.get('p2') ?? []).toHaveLength(0);

    // すべての保存ターン（オープニング・ペルソナ・遷移・クロージング）に chapterIndex が付与されている
    expect(turns.length).toBeGreaterThanOrEqual(6);
    for (const turn of turns) {
      expect(turn.chapterIndex, `turnIndex=${turn.turnIndex} (${turn.speakerType})`).toBeGreaterThanOrEqual(0);
    }
  });

  it('章上限到達時に未応答の直接質問への応答ターンを生成してから章を終える', async () => {
    const topicId = uniqueTopicId();
    const pair = defaultPersonas.slice(0, 2);
    await seedTopic(topicId, pair);

    const assessImplRef = { current: lowEngagement };
    const personaAgent = makeMockPersonaAgent(assessImplRef, {
      generateTurn: vi.fn().mockImplementation(async (persona: { id: string }) => ({
        ok: true,
        value: {
          content: '質問です。', speechMode: 'opinion', beliefChange: null,
          addressedToPersonaId: persona.id === 'p1' ? 'p2' : 'p1',
        },
      })),
    });
    const service = new DebateOrchestratorService(makeMockFacilitator(), personaAgent, shortOptions);

    await service.executeChapterTask(topicId, 0);

    const turns = await repo.getDebateTurnsBySessionId(topicId);
    const personaTurns = turns.filter(t => t.speakerType === 'persona');
    // 章上限2ターン + 未応答への応答1ターン
    expect(personaTurns).toHaveLength(3);
    // p1(指名) → p2(直接質問) → 応答は p1
    expect(personaTurns.map(t => t.personaId)).toEqual(['p1', 'p2', 'p1']);
  });

  it('実行中にトピックが停止されたら以降のターン生成を行わず終了する', async () => {
    const topicId = uniqueTopicId();
    await seedTopic(topicId);

    const assessImplRef = { current: lowEngagement };
    const personaAgent = makeMockPersonaAgent(assessImplRef, {
      generateTurn: vi.fn().mockImplementation(async () => {
        // 最初のペルソナ発言の生成中にトピックが停止される
        await db().doc(`topics/${topicId}`).update({ phaseStatus: 'stopped' });
        return { ok: true, value: { content: '発言。', speechMode: 'opinion', beliefChange: null, addressedToPersonaId: undefined } };
      }),
    });
    const mockFacilitator = makeMockFacilitator();
    const service = new DebateOrchestratorService(mockFacilitator, personaAgent, shortOptions);

    const hasNext = await service.executeChapterTask(topicId, 0);

    expect(hasNext).toBe(false);
    const turns = await repo.getDebateTurnsBySessionId(topicId);
    // オープニング + 1ペルソナ発言のみで停止（遷移・クロージングなし）
    expect(turns.filter(t => t.speakerType === 'persona')).toHaveLength(1);
    expect(mockFacilitator.generateChapterSummary).not.toHaveBeenCalled();
    expect(mockFacilitator.generateClosing).not.toHaveBeenCalled();
  });

  it('処理済みの章は冪等にスキップされる', async () => {
    const topicId = uniqueTopicId();
    await seedTopic(topicId);

    const assessImplRef = { current: lowEngagement };
    const service = new DebateOrchestratorService(makeMockFacilitator(), makeMockPersonaAgent(assessImplRef), shortOptions);
    await service.executeChapterTask(topicId, 0);
    await service.executeChapterTask(topicId, 1); // currentChapterIndex が 1 に進む

    const turnsBefore = await repo.getDebateTurnsBySessionId(topicId);

    // 第1章タスクの重複ディスパッチ → スキップされ、ターンが増えない
    const hasNext = await service.executeChapterTask(topicId, 0);

    expect(hasNext).toBe(true);
    const turnsAfter = await repo.getDebateTurnsBySessionId(topicId);
    expect(turnsAfter).toHaveLength(turnsBefore.length);
  });

  it('タスク失敗後のリトライで保存済みターン末尾から再開し、重複ターンを生成しない', async () => {
    const topicId = uniqueTopicId();
    await seedTopic(topicId);

    // 1回目: 2人目のペルソナ発言生成で失敗してタスクが中断する
    const assessImplRef = { current: lowEngagement };
    const failingAgent = makeMockPersonaAgent(assessImplRef, {
      generateTurn: vi.fn()
        .mockResolvedValueOnce({ ok: true, value: { content: '1人目の発言。', speechMode: 'opinion', beliefChange: null, addressedToPersonaId: undefined } })
        .mockResolvedValue({ ok: false, error: { code: 'AI_API_ERROR', message: 'generation failed', retryable: true } }),
    });
    const firstFacilitator = makeMockFacilitator();
    const firstAttempt = new DebateOrchestratorService(firstFacilitator, failingAgent, shortOptions);

    await expect(firstAttempt.executeChapterTask(topicId, 0)).rejects.toThrow('generation failed');
    const turnsAfterFailure = await repo.getDebateTurnsBySessionId(topicId);
    expect(turnsAfterFailure.filter(t => t.speakerType === 'persona')).toHaveLength(1);

    // 2回目（リトライ）: 正常なエージェントで再実行
    const retryFacilitator = makeMockFacilitator();
    const retryAttempt = new DebateOrchestratorService(retryFacilitator, makeMockPersonaAgent(assessImplRef), shortOptions);
    const hasNext = await retryAttempt.executeChapterTask(topicId, 0);

    expect(hasNext).toBe(true);
    // オープニングは再生成されない
    expect(retryFacilitator.generateOpening).not.toHaveBeenCalled();
    // turnIndex に重複がない
    const turns = await repo.getDebateTurnsBySessionId(topicId);
    const indexes = turns.map(t => t.turnIndex);
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(turns.filter(t => t.turnIndex === 0)).toHaveLength(1);
  });

  it('task 5.2: chapterIndex が欠落した既存保存データを読み込んで継続できる（後方互換）', async () => {
    const topicId = uniqueTopicId();
    await seedTopic(topicId);

    // 旧形式データ: chapterIndex なしのターン＋章情報あり
    await db().doc(`topics/${topicId}/sessions/0`).update({
      turns: [
        { id: 'old-0', turnIndex: 0, speakerType: 'facilitator', speakerName: 'ファシリテーター', speakerRole: '', content: '討論を始めます。', createdAt: Timestamp.now() },
        { id: 'old-1', turnIndex: 1, speakerType: 'persona', personaId: 'p1', speakerName: '田中太郎', speakerRole: '医師', content: '旧形式の発言。', createdAt: Timestamp.now() },
      ],
      chapters: twoChapters.map(c => ({ index: c.index, title: c.title, focusQuestion: c.focusQuestion })),
      currentChapterIndex: 0,
    });

    const assessImplRef = { current: lowEngagement };
    const service = new DebateOrchestratorService(makeMockFacilitator(), makeMockPersonaAgent(assessImplRef), shortOptions);

    const hasNext = await service.executeChapterTask(topicId, 0);

    expect(hasNext).toBe(true);
    const turns = await repo.getDebateTurnsBySessionId(topicId);
    // 旧ターンはそのまま（chapterIndex undefined）、新規ターンには chapterIndex が付与される
    expect(turns.find(t => t.id === 'old-0')?.chapterIndex).toBeUndefined();
    const newTurns = turns.filter(t => t.id !== 'old-0' && t.id !== 'old-1');
    expect(newTurns.length).toBeGreaterThanOrEqual(1);
    for (const turn of newTurns) {
      expect(turn.chapterIndex).toBeGreaterThanOrEqual(0);
    }
  });
});
