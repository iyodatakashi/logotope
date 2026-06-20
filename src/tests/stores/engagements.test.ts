import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EngagementHistoryEntry } from '$lib/models/engagement/engagement.types';

let snapshotCbs: Array<(snap: unknown) => void> = [];

vi.mock('$lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  onSnapshot: vi.fn((_ref: unknown, cb: (snap: unknown) => void) => {
    snapshotCbs.push(cb);
    return vi.fn();
  }),
  getDocs: vi.fn(),
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
}));

import { buildEngagementsMap, createEngagementStore, createEngagementsStore } from '$lib/stores/engagements.svelte';
import { onSnapshot, getDocs } from 'firebase/firestore';

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

describe('createEngagementStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotCbs = [];
  });

  it('chapterId を公開する', () => {
    const store = createEngagementStore('topic1', 'ch1');
    expect(store.chapterId).toBe('ch1');
  });

  it('start() が chapters/{chapterId}/engagements を onSnapshot で購読する', () => {
    const store = createEngagementStore('topic1', 'ch1');
    store.start();

    expect(vi.mocked(onSnapshot)).toHaveBeenCalledTimes(1);
  });

  it('スナップショット受信時に engagementsMap が turnId キーで更新される', () => {
    const store = createEngagementStore('topic1', 'ch1');
    store.start();

    snapshotCbs[0]?.({
      docs: [
        {
          id: 'persona1',
          data: () => ({ history: { 'turn-abc': { score: 4, mode: 'opinion' } } }),
        },
      ],
    });

    expect(store.engagementsMap.has('turn-abc')).toBe(true);
    expect(store.engagementsMap.get('turn-abc')?.[0].personaId).toBe('persona1');
  });

  it('stop() で購読が解除される', () => {
    const unsubscribeMock = vi.fn();
    vi.mocked(onSnapshot).mockReturnValueOnce(unsubscribeMock);

    const store = createEngagementStore('topic1', 'ch1');
    store.start();
    store.stop();

    expect(unsubscribeMock).toHaveBeenCalled();
  });

  it('ChapterStore を内部に保持しない（setChapterId がない）', () => {
    const store = createEngagementStore('topic1', 'ch1');
    expect((store as Record<string, unknown>).setChapterId).toBeUndefined();
  });
});

describe('createEngagementsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotCbs = [];
  });

  it('start() が one-shot で chapters コレクションを getDocs で読む', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({ docs: [{ id: 'ch1' }, { id: 'ch2' }] } as never);

    const store = createEngagementsStore('topic1');
    store.start();
    await Promise.resolve();

    expect(vi.mocked(getDocs)).toHaveBeenCalledTimes(1);
  });

  it('start() で各章の EngagementStore を onSnapshot 購読開始する', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({ docs: [{ id: 'ch1' }, { id: 'ch2' }] } as never);

    const store = createEngagementsStore('topic1');
    store.start();
    await Promise.resolve();

    expect(vi.mocked(onSnapshot)).toHaveBeenCalledTimes(2);
  });

  it('全章の engagementsMap を turnId キーで統合して公開する', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({ docs: [{ id: 'ch1' }, { id: 'ch2' }] } as never);

    const store = createEngagementsStore('topic1');
    store.start();
    await Promise.resolve();

    snapshotCbs[0]?.({
      docs: [{ id: 'p1', data: () => ({ history: { 'turn-a': { score: 4, mode: 'opinion' } } }) }],
    });
    snapshotCbs[1]?.({
      docs: [{ id: 'p2', data: () => ({ history: { 'turn-b': { score: 3, mode: 'none' } } }) }],
    });

    expect(store.engagementsMap.has('turn-a')).toBe(true);
    expect(store.engagementsMap.has('turn-b')).toBe(true);
  });

  it('stop() で全 EngagementStore の購読が解除される（リーク無し）', async () => {
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    vi.mocked(onSnapshot).mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2);
    vi.mocked(getDocs).mockResolvedValueOnce({ docs: [{ id: 'ch1' }, { id: 'ch2' }] } as never);

    const store = createEngagementsStore('topic1');
    store.start();
    await Promise.resolve();

    store.stop();

    expect(unsub1).toHaveBeenCalled();
    expect(unsub2).toHaveBeenCalled();
  });

  it('setChapterId メソッドが存在しない', () => {
    const store = createEngagementsStore('topic1');
    expect((store as Record<string, unknown>).setChapterId).toBeUndefined();
  });
});
