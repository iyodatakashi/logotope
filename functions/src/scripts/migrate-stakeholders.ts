/**
 * Migration: stakeholders フィールドを { items, approved, createdAt } オブジェクトから
 * StakeholderDoc[] 配列に変換する。
 *
 * 実行方法:
 *   cd functions
 *   npx ts-node --esm src/scripts/migrate-stakeholders.ts
 *
 * 前提: GOOGLE_APPLICATION_CREDENTIALS または Application Default Credentials が設定済みであること
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

async function migrate() {
  const snap = await db.collection('topics').get();
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as { stakeholders?: unknown };
    const s = data.stakeholders;

    // オブジェクト形式（旧スキーマ）のみ変換する
    if (s && !Array.isArray(s) && typeof s === 'object' && Array.isArray((s as { items?: unknown }).items)) {
      const items = (s as { items: unknown[] }).items;
      await doc.ref.update({ stakeholders: items });
      console.log(`Updated: ${doc.id}`);
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`Done: ${updated} updated, ${skipped} skipped`);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
