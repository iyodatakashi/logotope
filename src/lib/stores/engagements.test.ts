import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EngagementHistoryEntry } from '$lib/models/engagement/engagement.types';

let snapshotCb: ((snap: unknown) => void) | null = null;

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
    snapshotCb = cb;
    return vi.fn(); // unsubscribe function
  }),
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
}));

import { buildEngagementsMap, createEngagementsStore } from './engagements.svelte';
import { onSnapshot, collection } from 'firebase/firestore';

type EngagementDocInput = { personaId: string; history: Record<string, EngagementHistoryEntry> };

describe('buildEngagementsMap', () => {
  it('空の入力で空のMapを返す', () => {
    const result = buildEngagementsMap([]);
    expect(result.size).toBe(0);
  });

  it('複数ペルソナの履歴をturnId（文字列キー）でグループ化する', () => {
    const docs: EngagementDocInput[] = [
      {
        personaId: 'p1',
        history: {
          'turn-abc': { score: 4, mode: 'opinion' as const },
          'turn-def': { score: 2, mode: 'opinion' as const },
        },
      },
      {
        personaId: 'p2',
        history: {
          'turn-abc': { score: 3, mode: 'opinion' as const },
        },
      },
    ];
    const result = buildEngagementsMap(docs);
    expect(result.size).toBe(2);
    expect(result.get('turn-abc')).toHaveLength(2);
    expect(result.get('turn-def')).toHaveLength(1);
  });

  it('各エントリに personaId と turnId（文字列）が付与される', () => {
    const docs = [
      { personaId: 'p99', history: { 'turn-xyz': { score: 3, mode: 'opinion' as const } } },
    ];
    const result = buildEngagementsMap(docs);
    const entry = result.get('turn-xyz')?.[0];
    expect(entry?.personaId).toBe('p99');
    expect(entry?.turnId).toBe('turn-xyz');
    // turnIndex は存在しない
    expect((entry as Record<string, unknown>)?.turnIndex).toBeUndefined();
  });

  it('historyが空のペルソナはMapに追加しない', () => {
    const docs = [{ personaId: 'p1', history: {} }];
    const result = buildEngagementsMap(docs);
    expect(result.size).toBe(0);
  });

  it('同じturnIdのエントリを蓄積する（上書きしない）', () => {
    const docs = [
      { personaId: 'p1', history: { 'turn-a': { score: 5, mode: 'opinion' as const } } },
      { personaId: 'p2', history: { 'turn-a': { score: 2, mode: 'none' as const } } },
    ];
    const result = buildEngagementsMap(docs);
    const entries = result.get('turn-a');
    expect(entries).toHaveLength(2);
    expect(entries?.map(e => e.personaId)).toContain('p1');
    expect(entries?.map(e => e.personaId)).toContain('p2');
  });

  it('parseInt を使わず文字列キーをそのまま保持する（数値文字列でも）', () => {
    const docs = [
      { personaId: 'p1', history: { '123': { score: 5, mode: 'opinion' as const } } },
    ];
    const result = buildEngagementsMap(docs);
    expect(result.has('123')).toBe(true);
    expect(result.has(123 as unknown as string)).toBe(false);
  });
});

describe('createEngagementsStore - setChapterId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotCb = null;
  });

  it('setChapterId(chapterId) が chapters/{chapterId}/engagements を購読する', () => {
    const store = createEngagementsStore('topic1');
    store.start();
    store.setChapterId('ch1');

    const collectionCalls = vi.mocked(collection).mock.calls.map(
      (args: unknown[]) => (args as string[]).slice(1).join('/')
    );
    expect(collectionCalls.some(p => p === 'topics/topic1/chapters/ch1/engagements')).toBe(true);
    expect(vi.mocked(onSnapshot)).toHaveBeenCalled();
  });

  it('setChapterId(null) は onSnapshot を呼ばず空 Map を返す', () => {
    const store = createEngagementsStore('topic1');
    store.start();
    store.setChapterId(null);

    expect(vi.mocked(onSnapshot)).not.toHaveBeenCalled();
    expect(store.engagementsMap.size).toBe(0);
  });

  it('setChapterId 変更時に旧購読を解除する', () => {
    const unsubscribe1 = vi.fn();
    vi.mocked(onSnapshot).mockReturnValueOnce(unsubscribe1);

    const store = createEngagementsStore('topic1');
    store.setChapterId('ch1');
    store.setChapterId('ch2'); // ch1 の購読を解除して ch2 を購読する

    expect(unsubscribe1).toHaveBeenCalled();
  });

  it('スナップショット受信時に engagementsMap が文字列キーで更新される', () => {
    const store = createEngagementsStore('topic1');
    store.setChapterId('ch1');

    // スナップショットをシミュレート
    snapshotCb?.({
      docs: [
        {
          id: 'persona1',
          data: () => ({
            history: { 'turn-abc': { score: 4, mode: 'opinion' } },
          }),
        },
      ],
    });

    expect(store.engagementsMap.has('turn-abc')).toBe(true);
    expect(store.engagementsMap.get('turn-abc')?.[0].personaId).toBe('persona1');
  });

  it('stop() で購読が解除される', () => {
    const unsubscribeMock = vi.fn();
    vi.mocked(onSnapshot).mockReturnValueOnce(unsubscribeMock);

    const store = createEngagementsStore('topic1');
    store.setChapterId('ch1');
    store.stop();

    expect(unsubscribeMock).toHaveBeenCalled();
  });

  it('start() は topics/{topicId}/engagements を購読しない', () => {
    const store = createEngagementsStore('topic1');
    store.start();

    const collectionCalls = vi.mocked(collection).mock.calls.map(
      (args: unknown[]) => (args as string[]).slice(1).join('/')
    );
    expect(collectionCalls.some(p => p === 'topics/topic1/engagements')).toBe(false);
    expect(vi.mocked(onSnapshot)).not.toHaveBeenCalled();
  });
});
