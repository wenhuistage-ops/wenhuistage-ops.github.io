/**
 * cleanExpiredSessions — 每日清理過期 sessions（與殘留 oneTimeTokens）
 *
 * 排程：每天台北時間 03:00 執行
 *
 * 清理對象：
 *   - sessions          collection 中 expiredAt < now
 *   - oneTimeTokens     collection 中 expiredAt < now（GS 遷移殘留 / 未來重啟流程備用）
 *
 * 為什麼需要這個：
 *   verifySession 會擋過期 token，但文件不會自動刪除。長期累積會造成
 *   sessions collection 膨脹，每次驗證 token 仍需走 doc lookup（雖然 O(1)，
 *   但儲存與備份成本持續成長）。
 *
 * 後續可改用 Firestore TTL policy（GCP 原生，零維護）取代本 function：
 *   gcloud firestore fields ttls update expiredAt \
 *     --collection-group=sessions --enable-ttl --database=default
 *   gcloud firestore fields ttls update expiredAt \
 *     --collection-group=oneTimeTokens --enable-ttl --database=default
 *   設定後 GCP 會在約 24 小時內自動刪除過期文件。屆時可移除本 function。
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { db, COLLECTIONS } = require("./_helpers");

const BATCH_SIZE = 400; // Firestore batch 上限 500，留緩衝

async function cleanCollection(collectionName, now) {
  let totalDeleted = 0;
  while (true) {
    const snap = await db
      .collection(collectionName)
      .where("expiredAt", "<", now)
      .limit(BATCH_SIZE)
      .get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    totalDeleted += snap.size;

    if (snap.size < BATCH_SIZE) break;
  }
  return totalDeleted;
}

module.exports = onSchedule(
  {
    schedule: "every day 03:00",
    timeZone: "Asia/Taipei",
    region: "asia-southeast1",
    retryCount: 1,
  },
  async () => {
    const now = new Date();
    const sessionsDeleted = await cleanCollection(COLLECTIONS.SESSIONS, now);
    const oneTimeDeleted = await cleanCollection(COLLECTIONS.ONE_TIME_TOKENS, now);
    console.log(
      `cleanExpiredSessions: sessions=${sessionsDeleted}, oneTimeTokens=${oneTimeDeleted}`
    );
  }
);
