import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') },
}));

import { getFirestore } from 'firebase-admin/firestore';
import { ProgressTrackerService } from './progress-tracker.js';

const mockSet = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({ set: mockSet }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFirestore).mockReturnValue({ collection: vi.fn(() => ({ doc: mockDoc })) } as ReturnType<typeof getFirestore>);
});

describe('ProgressTrackerService', () => {
  const tracker = new ProgressTrackerService();

  describe('updateStatus', () => {
    it('status・currentStep・completed・total・updatedAt の5フィールドのみを書き込む', async () => {
      await tracker.updateStatus('topic-1', 'surveying', 'ステークホルダー分析中...');

      expect(mockDoc).toHaveBeenCalledWith('topic-1');
      expect(mockSet).toHaveBeenCalledWith(
        {
          status: 'surveying',
          currentStep: 'ステークホルダー分析中...',
          completed: 0,
          total: 0,
          updatedAt: 'SERVER_TIMESTAMP',
        },
        // merge なし（full overwrite）
      );
    });

    it('currentStep 省略時は null を書き込む', async () => {
      await tracker.updateStatus('topic-1', 'generating_personas');

      expect(mockSet).toHaveBeenCalledWith({
        status: 'generating_personas',
        currentStep: null,
        completed: 0,
        total: 0,
        updatedAt: 'SERVER_TIMESTAMP',
      });
    });

    it('merge オプションを渡さない（full overwrite）', async () => {
      await tracker.updateStatus('topic-1', 'interviewing');

      const [, secondArg] = mockSet.mock.calls[0];
      // merge: true を渡していないこと
      expect(secondArg).toBeUndefined();
    });

    it('completed と total が常に 0 にリセットされる', async () => {
      await tracker.updateStatus('topic-1', 'debating');

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ completed: 0, total: 0 }),
      );
    });
  });

  describe('updateProgress', () => {
    it('completed と total を merge で更新する', async () => {
      await tracker.updateProgress('topic-1', 3, 5);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ completed: 3, total: 5 }),
        { merge: true },
      );
    });
  });

  it('setError メソッドは存在しない', () => {
    expect((tracker as unknown as Record<string, unknown>).setError).toBeUndefined();
  });
});
