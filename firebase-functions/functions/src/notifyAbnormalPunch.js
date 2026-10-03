/**
 * notifyAbnormalPunch — 本月「缺一張卡」累計 3 天以上的員工，每天通知管理員
 *
 * 排程：每天 Asia/Taipei 09:00
 *
 * 規則（2026-10-03 與使用者確認）：
 *   - 只算「缺上班卡」或「缺下班卡」的日子；整天沒打卡不算
 *     （後端分不出休假還是忘記打，算進去員工休假 3 天也會被通報）
 *   - 已送補卡（審核中）或補卡已核准的那天不算：summarizeByDay 會把那天的
 *     reason 設成 STATUS_REPAIR_*；補卡被退回則照樣算缺卡
 *   - 本月累計 ≥ 3 天列入名單；名單是空的就不發
 *   - 只看到「前天」：跨日班的虛擬卡（dailyVirtualPunch）隔天 04:00 才補，
 *     昨天可能還是假的「缺下班」
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { db, COLLECTIONS, notifyAdmins, LINE_CHANNEL_ACCESS_TOKEN } = require("./_helpers");
const { getMonthlyDailyStatus } = require("./_attendance");

const MISSING_REASONS = ["STATUS_PUNCH_IN_MISSING", "STATUS_PUNCH_OUT_MISSING"];
const THRESHOLD_DAYS = 3;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** dailyStatus 中「缺一張卡」且日期 ≤ lastDateKey 的日期（YYYY-MM-DD） */
function missingPunchDays(dailyStatus, lastDateKey) {
  return (dailyStatus || [])
    .filter((d) => d && d.date <= lastDateKey && MISSING_REASONS.includes(d.reason))
    .map((d) => d.date);
}

module.exports = onSchedule(
  {
    schedule: "every day 09:00",
    timeZone: "Asia/Taipei",
    region: "asia-southeast1",
    secrets: [LINE_CHANNEL_ACCESS_TOKEN],
  },
  async () => {
    // 前天（台北）：月份也以前天為準，月初 1、2 號會回報上個月的結算
    const t = new Date(Date.now() + TAIPEI_OFFSET_MS);
    t.setUTCDate(t.getUTCDate() - 2);
    const lastDateKey = t.toISOString().slice(0, 10);
    const month = lastDateKey.slice(0, 7);

    const employeesSnap = await db.collection(COLLECTIONS.EMPLOYEES).get();
    const active = employeesSnap.docs.filter((doc) => (doc.data().status || "啟用") === "啟用");

    // 每人 1 read（attendanceMonthly 聚合 doc）
    const rows = await Promise.all(
      active.map(async (doc) => {
        const days = missingPunchDays(await getMonthlyDailyStatus(doc.id, month), lastDateKey);
        return { name: doc.data().name || doc.id.slice(0, 8), days };
      })
    );
    const flagged = rows.filter((r) => r.days.length >= THRESHOLD_DAYS);

    console.log(
      `notifyAbnormalPunch ${month}（到 ${lastDateKey}）：檢查 ${active.length} 人，達標 ${flagged.length} 人`
    );
    if (flagged.length === 0) return;

    const lines = flagged.map(
      (r) => `• ${r.name}：${r.days.length} 天（${r.days.map((d) => d.slice(5).replace("-", "/")).join("、")}）`
    );
    const msg =
      `⚠️ 打卡異常提醒（${month}）\n` +
      `以下員工本月有 ${THRESHOLD_DAYS} 天以上缺上班或下班卡，還沒補卡：\n\n` +
      `${lines.join("\n")}\n\n` +
      `請提醒他們補打卡。`;
    await notifyAdmins(msg, LINE_CHANNEL_ACCESS_TOKEN.value());
  }
);
