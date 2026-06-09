import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export class ProgressTrackerService {
  async updateStatus(topicId: string, status: string, currentStep?: string): Promise<void> {
    await getFirestore().collection('progress').doc(topicId).set({
      status,
      currentStep: currentStep ?? null,
      completed: 0,
      total: 0,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  async updateProgress(topicId: string, completed: number, total: number): Promise<void> {
    await getFirestore().collection('progress').doc(topicId).set(
      { completed, total },
      { merge: true }
    );
  }
}
