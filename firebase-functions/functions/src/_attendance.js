/**
 * 打卡資料查詢共用 helper
 *
 * - getMonthlyAttendance(month, userId)：指定月份（YYYY-MM）的打卡記錄
 * - summarizeByDay(records)：按日分組並提供基礎判斷
 *
 * 基礎判斷邏輯為簡化版，複雜異常規則（STATUS_LATE / STATUS_EARLY_LEAVE 等）
 * 在原 GS Utils.gs 有完整實作；此處保留 TODO 待對齊。
 */

const { db, COLLECTIONS } = require("./_helpers");

/**
 * 解析 "YYYY-MM" 為該月起訖 Date
 */
function parseMonth(monthStr) {
  const m = String(monthStr || "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const start = new Date(year, month, 1, 0, 0, 0);
  const end = new Date(year, month + 1, 1, 0, 0, 0);
  return { start, end, year, month };
}

/**
 * 取得指定月份的打卡記錄（可選 userId 過濾）
 * @returns {Array<Object>}
 */
async function getMonthlyAttendance(month, userId) {
  const range = parseMonth(month);
  if (!range) return [];

  let query = db
    .collection(COLLECTIONS.ATTENDANCE)
    .where("timestamp", ">=", range.start)
    .where("timestamp", "<", range.end)
    .orderBy("timestamp", "asc");

  if (userId) {
    query = query.where("userId", "==", userId);
  }

  const snap = await query.get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    // Timestamp → Date（方便後續處理）
    date: doc.data().timestamp?.toDate?.() || doc.data().timestamp,
  }));
}

/**
 * 按日分組並給出「輕量級」摘要（前端月曆使用）
 *
 * 回傳陣列格式：
 *   [
 *     { date: 'YYYY-MM-DD', reason: 'STATUS_OK' | 'STATUS_BOTH_MISSING'
 *       | 'STATUS_PUNCH_IN_MISSING' | 'STATUS_PUNCH_OUT_MISSING'
 *       | 'STATUS_LEAVE_PENDING' | 'STATUS_VACATION_PENDING'
 *       | 'STATUS_LEAVE_APPROVED' | 'STATUS_VACATION_APPROVED',
 *       hours: number, punchInTime, punchOutTime, isHoliday, record: [...] }
 *   ]
 *
 * 完整異常清單與判斷規則見 docs/rules/異常清單顯示規則.md
 * TODO：對齊 GS Utils.gs 的 checkAttendance / checkAttendanceCalendar
 */
function summarizeByDay(records) {
  const byDay = new Map();

  records.forEach((r) => {
    if (!r.date) return;
    const d = r.date instanceof Date ? r.date : new Date(r.date);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    if (!byDay.has(key)) {
      byDay.set(key, { date: key, record: [] });
    }
    const day = byDay.get(key);

    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");

    day.record.push({
      time: `${hh}:${mm}`,
      type: r.type || "",
      location: r.locationName || "",
      note: r.note || "",
      audit: r.audit || "",
      adjustmentType: r.adjustmentType || "",
    });
  });

  // 對每一日做輕量判斷
  const days = [];
  for (const day of byDay.values()) {
    const hasIn = day.record.some((p) => /上班|IN|in/i.test(p.type));
    const hasOut = day.record.some((p) => /下班|OUT|out/i.test(p.type));

    const leaveRecord = day.record.find((p) => p.adjustmentType === "系統請假記錄" || /請假/.test(p.type));
    const vacationRecord = day.record.find((p) => /休假/.test(p.type));
    const approvedAudit = (r) => r && r.audit === "v";
    const pendingAudit = (r) => r && r.audit === "?";

    let reason = "STATUS_OK";
    if (approvedAudit(leaveRecord)) reason = "STATUS_LEAVE_APPROVED";
    else if (pendingAudit(leaveRecord)) reason = "STATUS_LEAVE_PENDING";
    else if (approvedAudit(vacationRecord)) reason = "STATUS_VACATION_APPROVED";
    else if (pendingAudit(vacationRecord)) reason = "STATUS_VACATION_PENDING";
    else if (!hasIn && !hasOut) reason = "STATUS_BOTH_MISSING";
    else if (!hasIn) reason = "STATUS_PUNCH_IN_MISSING";
    else if (!hasOut) reason = "STATUS_PUNCH_OUT_MISSING";

    // 簡易工時估算（下班時間 - 上班時間，不扣休息）
    let hours = 0;
    let punchInTime = "";
    let punchOutTime = "";
    if (hasIn) punchInTime = day.record.find((p) => /上班|IN|in/i.test(p.type)).time;
    if (hasOut) punchOutTime = day.record.find((p) => /下班|OUT|out/i.test(p.type)).time;
    if (punchInTime && punchOutTime) {
      const [inH, inM] = punchInTime.split(":").map(Number);
      const [outH, outM] = punchOutTime.split(":").map(Number);
      hours = Math.max(0, (outH * 60 + outM - inH * 60 - inM) / 60);
    }

    days.push({
      date: day.date,
      reason,
      hours: Number(hours.toFixed(2)),
      punchInTime,
      punchOutTime,
      isHoliday: false, // TODO：整合國定假日 map
      record: day.record,
    });
  }

  // 按日期排序
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

/**
 * 偵測該月異常（簡化版）
 *
 * 對於「完全沒打卡的日子」產生 STATUS_BOTH_MISSING；
 * 對於「只有上班/只有下班」產生對應狀態。
 *
 * TODO：對齊 GS Utils.gs checkAttendanceAbnormal
 */
function detectAbnormal(records, month) {
  const summary = summarizeByDay(records);
  const byDate = new Map(summary.map((d) => [d.date, d]));

  const range = parseMonth(month);
  if (!range) return [];

  const result = [];
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  let counter = 0;
  for (
    let d = new Date(range.start);
    d < range.end && d <= today;
    d.setDate(d.getDate() + 1)
  ) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (key > todayKey) break;

    const day = byDate.get(key);
    counter++;
    if (!day) {
      // 沒有記錄
      result.push({ date: key, reason: "STATUS_BOTH_MISSING", id: `abnormal-${counter}` });
    } else if (day.reason !== "STATUS_OK" && day.reason !== "STATUS_LEAVE_APPROVED" && day.reason !== "STATUS_VACATION_APPROVED") {
      result.push({ date: key, reason: day.reason, id: `abnormal-${counter}` });
    }
  }

  return result;
}

module.exports = {
  parseMonth,
  getMonthlyAttendance,
  summarizeByDay,
  detectAbnormal,
};
