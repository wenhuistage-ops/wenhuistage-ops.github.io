/**
 * dailyVirtualPunch — 跨日班自動補虛擬卡
 *
 * 對應 GS：虛擬卡判斷.gs (dailyVirtualPunch)
 *
 * 排程：每天 Asia/Taipei 04:00 執行
 *
 * 觸發條件（兩個都成立）：
 *   1. 員工「前天最後一筆打卡」是「上班」（沒打下班就跨日了）
 *   2. 員工「昨天第一筆打卡」是「下班」（承接前一天班次）
 *
 * 補卡內容：
 *   - 前天 23:59:59  → 下班（虛擬）
 *   - 昨天 00:00:00  → 上班（虛擬）
 *
 * 兩筆卡標記：
 *   - locationName / coords = "系統虛擬卡"
 *   - note = 描述性說明（VIRTUAL_NOTE_OUT / IN）
 *   - audit = ""（沿用 GS 不進審核佇列的行為）
 *   - adjustmentType = ""
 *
 * 冪等性：再跑一次時，因為 day-before 最後一筆變成 23:59:59 下班（虛擬），
 * 觸發條件不成立 → 自動跳過。**不需要額外去重邏輯**。
 *
 * 寫入後同步呼叫 applyEventToMonthly 維護 attendanceMonthly 聚合。
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  admin,
  db,
  COLLECTIONS,
} = require("./_helpers");
const { applyEventToMonthly } = require("./_attendance");

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

// 2026-05-14：改為「預設核准」，admin 可刪除誤判
// 2026-05-15：加 [系統虛擬卡] prefix tag，與其他補卡來源（員工/Admin）一致
const VIRTUAL_NOTE_OUT =
  "[系統虛擬卡] 系統自動新增虛擬下班卡（跨日前下班，預設核准，admin 可刪除誤判）";
const VIRTUAL_NOTE_IN =
  "[系統虛擬卡] 系統自動新增虛擬上班卡（跨日後上班，預設核准，admin 可刪除誤判）";
const VIRTUAL_TAG = "系統虛擬卡";

/**
 * 計算 Asia/Taipei 時區下「前天 / 昨天 / 今天」三個 00:00 對應的 UTC Date
 */
function getTaipeiDayBoundaries() {
  const now = new Date();
  const taipei = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const y = taipei.getUTCFullYear();
  const m = taipei.getUTCMonth();
  const d = taipei.getUTCDate();
  // Taipei 該日 00:00 = UTC 該日 00:00 - 8h
  return {
    dayBeforeStart: new Date(Date.UTC(y, m, d - 2) - TAIPEI_OFFSET_MS),
    yesterdayStart: new Date(Date.UTC(y, m, d - 1) - TAIPEI_OFFSET_MS),
    todayStart: new Date(Date.UTC(y, m, d) - TAIPEI_OFFSET_MS),
    // 前天 23:59:59（Taipei）對應 UTC
    dayBefore235959: new Date(
      Date.UTC(y, m, d - 2, 23, 59, 59, 999) - TAIPEI_OFFSET_MS
    ),
    // 昨天 00:00:00（Taipei）對應 UTC ＝ yesterdayStart
    yesterday000000: new Date(Date.UTC(y, m, d - 1) - TAIPEI_OFFSET_MS),
  };
}

/**
 * 把 Date 推算成 Taipei 時區的 'YYYY-MM-DD' key（用來分組）
 */
function taipeiDateKey(date) {
  const t = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

module.exports = onSchedule(
  {
    schedule: "every day 04:00",
    timeZone: "Asia/Taipei",
    region: "asia-southeast1",
    retryCount: 1,
  },
  async () => {
    const bounds = getTaipeiDayBoundaries();
    const dayBeforeKey = taipeiDateKey(bounds.dayBeforeStart);
    const yesterdayKey = taipeiDateKey(bounds.yesterdayStart);

    console.log(
      `dailyVirtualPunch: 檢查 ${dayBeforeKey} 與 ${yesterdayKey} 跨日班`
    );

    // 1. 撈這兩天所有打卡（一次 query，attendance collection）
    const snap = await db
      .collection(COLLECTIONS.ATTENDANCE)
      .where("timestamp", ">=", bounds.dayBeforeStart)
      .where("timestamp", "<", bounds.todayStart)
      .get();

    // 2. 按 (userId, dateKey) 分組
    /** @type {Map<string, Map<string, Array>>} */
    const byUser = new Map();
    snap.docs.forEach((doc) => {
      const data = doc.data();
      const ts = data.timestamp?.toDate?.() || data.timestamp;
      if (!(ts instanceof Date)) return;
      const userId = data.userId;
      if (!userId) return;
      const dateKey = taipeiDateKey(ts);
      if (dateKey !== dayBeforeKey && dateKey !== yesterdayKey) return;

      if (!byUser.has(userId)) byUser.set(userId, new Map());
      const userMap = byUser.get(userId);
      if (!userMap.has(dateKey)) userMap.set(dateKey, []);
      userMap.get(dateKey).push({ ...data, _ts: ts });
    });

    // 3. 逐員工判斷跨日
    let processed = 0;
    let skippedNoDouble = 0;
    let skippedNotCrossing = 0;
    let skippedInactive = 0;
    let failed = 0;

    for (const [userId, userMap] of byUser.entries()) {
      const dayBeforeRecs = userMap.get(dayBeforeKey);
      const yesterdayRecs = userMap.get(yesterdayKey);

      // 兩天都要有打卡才考慮跨日
      if (!dayBeforeRecs?.length || !yesterdayRecs?.length) {
        skippedNoDouble++;
        continue;
      }

      // 各自按時間排序
      dayBeforeRecs.sort((a, b) => a._ts - b._ts);
      yesterdayRecs.sort((a, b) => a._ts - b._ts);

      const lastDayBefore = dayBeforeRecs[dayBeforeRecs.length - 1];
      const firstYesterday = yesterdayRecs[0];

      const cond1 = lastDayBefore?.type === "上班";
      const cond2 = firstYesterday?.type === "下班";

      if (!(cond1 && cond2)) {
        skippedNotCrossing++;
        continue;
      }

      // 4. 確認員工存在且啟用
      const empSnap = await db
        .collection(COLLECTIONS.EMPLOYEES)
        .doc(userId)
        .get();
      if (!empSnap.exists) {
        console.warn(`  ⚠️ 跳過 ${userId}：員工不存在`);
        skippedInactive++;
        continue;
      }
      const emp = empSnap.data();
      if ((emp.status || "啟用") !== "啟用") {
        console.warn(
          `  ⚠️ 跳過 ${userId} ${emp.name || ""}：狀態 ${emp.status}`
        );
        skippedInactive++;
        continue;
      }

      // 5. 寫入兩筆虛擬卡
      const userName = emp.name || "";
      const dept = emp.dept || "";

      // 2026-05-14：虛擬卡升級為「預設核准 + 可識別來源」
      //   audit='v' → 不進審核佇列（系統自動補的，無需 admin 動作）
      //   adjustmentType='系統虛擬卡' → Firestore Console / find-midnight-punches 能識別
      //   reviewedBy='system:dailyVirtualPunch' → 審計軌跡
      // 誤判時 admin 可透過 deleteAttendance endpoint 刪除單筆
      const virtualOut = {
        timestamp: admin.firestore.Timestamp.fromDate(bounds.dayBefore235959),
        userId,
        dept,
        name: userName,
        type: "下班",
        coords: VIRTUAL_TAG,
        locationName: VIRTUAL_TAG,
        note: VIRTUAL_NOTE_OUT,
        audit: "v",
        adjustmentType: "系統虛擬卡",
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedBy: "system:dailyVirtualPunch",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      const virtualIn = {
        timestamp: admin.firestore.Timestamp.fromDate(bounds.yesterday000000),
        userId,
        dept,
        name: userName,
        type: "上班",
        coords: VIRTUAL_TAG,
        locationName: VIRTUAL_TAG,
        note: VIRTUAL_NOTE_IN,
        audit: "v",
        adjustmentType: "系統虛擬卡",
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedBy: "system:dailyVirtualPunch",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      try {
        // 2026-06-10：兩筆虛擬卡改 batch 原子寫入 —— 舊版兩次 add 之間若
        // crash / 超時，會留「半套虛擬卡」（只有下班沒上班），且隔天排程
        // 重跑時跨日判斷條件仍成立，會重複補卡。batch 保證全有或全無。
        const batch = db.batch();
        batch.set(db.collection(COLLECTIONS.ATTENDANCE).doc(), virtualOut);
        batch.set(db.collection(COLLECTIONS.ATTENDANCE).doc(), virtualIn);
        await batch.commit();

        // 同步 attendanceMonthly 聚合（兩天可能跨月，分別呼叫）
        await applyEventToMonthly(userId, bounds.dayBefore235959);
        await applyEventToMonthly(userId, bounds.yesterday000000);

        processed++;
        console.log(
          `  ✅ ${userId} ${userName} 補入跨日虛擬卡（${dayBeforeKey} 23:59:59 下班 + ${yesterdayKey} 00:00:00 上班）`
        );
      } catch (err) {
        failed++;
        console.error(
          `  ❌ ${userId} ${userName} 寫入失敗:`,
          err?.message
        );
      }
    }

    console.log(
      `dailyVirtualPunch 完成：` +
        `處理 ${processed} 人 / 失敗 ${failed} / 略過 ${skippedNoDouble + skippedNotCrossing + skippedInactive}` +
        `（無雙日資料 ${skippedNoDouble}、非跨日型態 ${skippedNotCrossing}、員工停用或不存在 ${skippedInactive}）`
    );
  }
);
