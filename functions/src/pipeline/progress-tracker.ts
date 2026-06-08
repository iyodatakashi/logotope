import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { DebateStatus } from '../types/index.js';

export class ProgressTrackerService {
  private doc(topicId: string) {
    return getFirestore().collection('debate_progress').doc(topicId);
  }

  async updateStatus(topicId: string, status: DebateStatus, currentStep?: string): Promise<void> {
    await this.doc(topicId).set({
      status,
      currentStep: currentStep ?? null,
      completed: 0,
      total: 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async updateProgress(topicId: string, completed: number, total: number): Promise<void> {
    await this.doc(topicId).set({
      completed,
      total,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async debugLog(topicId: string, message: string): Promise<void> {
    await this.doc(topicId).set({
      debugLog: message,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}
