import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeApp, getApps, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ProgressTrackerService } from './progress-tracker.js';

// Requires Firebase Emulator: FIRESTORE_EMULATOR_HOST=localhost:8080 (set in setupFiles)

let app: App;

beforeAll(() => {
  app = getApps().length === 0
    ? initializeApp({ projectId: 'demo-logotope' })
    : getApps()[0];
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const db = getFirestore();
  await db.collection('debate_progress').doc('test-topic').delete().catch(() => undefined);
});

describe('ProgressTrackerService (Firestore 整合性)', () => {
  it('updateStatus → Firestore にステータスと currentStep が書き込まれる', async () => {
    const tracker = new ProgressTrackerService();
    await tracker.updateStatus('test-topic', 'surveying', 'ステークホルダー分析中...');

    const snap = await getFirestore().collection('debate_progress').doc('test-topic').get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.status).toBe('surveying');
    expect(snap.data()?.currentStep).toBe('ステークホルダー分析中...');
    expect(snap.data()?.completed).toBe(0);
    expect(snap.data()?.total).toBe(0);
    expect(snap.data()?.updatedAt).toBeDefined();
    // error フィールドが存在しないこと
    expect(snap.data()).not.toHaveProperty('error');
  });

  it('updateProgress → completed/total が Firestore に書き込まれる', async () => {
    const tracker = new ProgressTrackerService();
    await tracker.updateProgress('test-topic', 3, 5);

    const snap = await getFirestore().collection('debate_progress').doc('test-topic').get();
    expect(snap.data()?.completed).toBe(3);
    expect(snap.data()?.total).toBe(5);
  });

  it('updateStatus 後に updateProgress すると両方のフィールドが揃う', async () => {
    const tracker = new ProgressTrackerService();
    await tracker.updateStatus('test-topic', 'debating', '討論ターン1/10');
    await tracker.updateProgress('test-topic', 1, 10);

    const snap = await getFirestore().collection('debate_progress').doc('test-topic').get();
    const data = snap.data();
    expect(data?.status).toBe('debating');
    expect(data?.currentStep).toBe('討論ターン1/10');
    expect(data?.completed).toBe(1);
    expect(data?.total).toBe(10);
  });

  it('管理画面の ProgressState 形式と一致する（error フィールドなし）', async () => {
    const tracker = new ProgressTrackerService();
    await tracker.updateStatus('test-topic', 'interviewing', '取材中...');
    await tracker.updateProgress('test-topic', 2, 5);

    const snap = await getFirestore().collection('debate_progress').doc('test-topic').get();
    const data = snap.data();

    // ProgressState interface: { status, currentStep, completed, total, updatedAt } のみ
    expect(data).toMatchObject({
      status: 'interviewing',
      currentStep: '取材中...',
      completed: 2,
      total: 5,
    });
    expect(data).not.toHaveProperty('error');
  });
});
