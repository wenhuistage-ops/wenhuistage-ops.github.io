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

// 系統使用台灣時區（Asia/Taipei = UTC+8），但 Cloud Functions runtime 預設 UTC，
// 故所有日期/時間呈現需明確轉換為 Asia/Taipei，避免少 8 小時。
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 將 Date 物件轉為 Asia/Taipei 時區的「假 UTC Date」，
 * 之後對它呼叫 getUTC* 系列等同於拿到台灣時區的時間欄位
 */
function toTaipei(date) {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS);
}

/**
 * 解析 "YYYY-MM"（台灣時區月份）為該月在 UTC 上的起訖 Date
 *
 * 例如 "2026-04" 在 Asia/Taipei = 2026-03-31 16:00 UTC ~ 2026-04-30 16:00 UTC
 */
function parseMonth(monthStr) {
  const m = String(monthStr || "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  // Taipei 月初 = UTC 同月初 - 8h
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0) - TAIPEI_OFFSET_MS);
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0) - TAIPEI_OFFSET_MS);
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
 *     { date: 'YYYY-MM-DD',
 *       reason: 'STATUS_PUNCH_NORMAL'      // 上下班都有
 *             | 'STATUS_BOTH_MISSING'      // 完全沒打
 *             | 'STATUS_PUNCH_IN_MISSING'  // 沒上班
 *             | 'STATUS_PUNCH_OUT_MISSING' // 沒下班
 *             | 'STATUS_LEAVE_PENDING'     // 請假審核中
 *             | 'STATUS_LEAVE_APPROVED'    // 請假已批准
 *             | 'STATUS_VACATION_PENDING'  // 休假審核中
 *             | 'STATUS_VACATION_APPROVED' // 休假已批准
 *             | 'STATUS_REPAIR_PENDING'    // 補打卡審核中
 *             | 'STATUS_REPAIR_APPROVED',  // 補打卡通過
 *       hours, punchInTime, punchOutTime, isHoliday, record: [...] }
 *   ]
 *
 * 對應 i18n 鍵見 i18n/zh-TW.json 的 STATUS_* 區段，
 * 對應顏色 class 見 js/ui.js switch reason。
 *
 * 完整異常清單與判斷規則見 docs/rules/異常清單顯示規則.md
 * TODO：對齊 GS Utils.gs 的 checkAttendance / checkAttendanceCalendar
 */
/**
 * 'HH:MM' → 分鐘
 */
function _hhmmToMin(s) {
  const m = String(s || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 去除相鄰同 type 的重複打卡（5 分鐘內視為重複，保留第一筆）
 *
 * 處理場景：員工短時間內連點兩次（手抖、確認彈窗誤點），讓
 * punchInTime / punchOutTime 計算與 _pairShifts 不被誤導。
 *
 * 5 分鐘窗口屬保守值：員工不太可能 5 分鐘內合法地產生兩次同型打卡；
 * 大於 5 分鐘的「重複」（如下班後 30 分鐘又補打卡）保留原處理邏輯。
 */
function _dedupeAdjacentSameType(records) {
  const sorted = [...records].sort((a, b) =>
    String(a.time).localeCompare(String(b.time))
  );
  const out = [];
  const DEDUP_WINDOW_MIN = 5;
  for (const r of sorted) {
    if (out.length === 0) {
      out.push(r);
      continue;
    }
    const last = out[out.length - 1];
    if (last.type === r.type) {
      const lastMin = _hhmmToMin(last.time);
      const curMin = _hhmmToMin(r.time);
      if (lastMin != null && curMin != null && curMin - lastMin <= DEDUP_WINDOW_MIN) {
        continue; // 視為重複，跳過
      }
    }
    out.push(r);
  }
  return out;
}

function summarizeByDay(records) {
  const byDay = new Map();

  records.forEach((r) => {
    if (!r.date) return;
    const d = r.date instanceof Date ? r.date : new Date(r.date);
    if (isNaN(d.getTime())) return;
    // 用 Asia/Taipei 時區計算日期 key 與時間
    const t = toTaipei(d);
    const key = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;

    if (!byDay.has(key)) {
      byDay.set(key, { date: key, record: [] });
    }
    const day = byDay.get(key);

    const hh = String(t.getUTCHours()).padStart(2, "0");
    const mm = String(t.getUTCMinutes()).padStart(2, "0");

    const newRecord = {
      time: `${hh}:${mm}`,
      type: r.type || "",
      location: r.locationName || "",
      note: r.note || "",
      audit: r.audit || "",
      adjustmentType: r.adjustmentType || "",
    };

    // 去重：同一天若已有 type + time + location 相同的記錄就跳過
    // 避免來源 Sheet 重複申請（例如同一天兩筆 08:00 病假）造成顯示重複
    const isDup = day.record.some(
      (p) =>
        p.time === newRecord.time &&
        p.type === newRecord.type &&
        p.location === newRecord.location
    );
    if (!isDup) {
      day.record.push(newRecord);
    }
  });

  // 對每一日做輕量判斷
  const days = [];
  for (const day of byDay.values()) {
    // 去除相鄰同 type 的重複打卡（5 分鐘內），避免誤判
    day.record = _dedupeAdjacentSameType(day.record);

    const hasIn = day.record.some((p) => /上班|IN|in/i.test(p.type));
    const hasOut = day.record.some((p) => /下班|OUT|out/i.test(p.type));

    const leaveRecord = day.record.find((p) => p.adjustmentType === "系統請假記錄" || /請假/.test(p.type));
    const vacationRecord = day.record.find((p) => /休假/.test(p.type));
    const adjustRecord = day.record.find((p) => p.adjustmentType === "補打卡");
    const approvedAudit = (r) => r && r.audit === "v";
    const pendingAudit = (r) => r && r.audit === "?";

    // 判斷順序對應 i18n STATUS_* 與 ui.js 顏色 switch
    let reason = "STATUS_PUNCH_NORMAL"; // 預設：上下班都正常
    if (approvedAudit(leaveRecord)) reason = "STATUS_LEAVE_APPROVED";
    else if (pendingAudit(leaveRecord)) reason = "STATUS_LEAVE_PENDING";
    else if (approvedAudit(vacationRecord)) reason = "STATUS_VACATION_APPROVED";
    else if (pendingAudit(vacationRecord)) reason = "STATUS_VACATION_PENDING";
    else if (approvedAudit(adjustRecord)) reason = "STATUS_REPAIR_APPROVED";
    else if (pendingAudit(adjustRecord)) reason = "STATUS_REPAIR_PENDING";
    else if (!hasIn && !hasOut) reason = "STATUS_BOTH_MISSING";
    else if (!hasIn) reason = "STATUS_PUNCH_IN_MISSING";
    else if (!hasOut) reason = "STATUS_PUNCH_OUT_MISSING";

    // 簡易工時估算（下班時間 - 上班時間，不扣休息）
    // punchInTime 取「最早」上班、punchOutTime 取「最晚」下班
    // 配合上方 dedupe 已處理 5 分鐘內重複打卡，這裡 last-out 處理 30 分鐘以內
    // 的合理重複下班（員工先按下班再回工作），讓淨工時不會被誤打的早期 OUT 截斷。
    let hours = 0;
    let punchInTime = "";
    let punchOutTime = "";
    if (hasIn) {
      punchInTime = day.record.find((p) => /上班|IN|in/i.test(p.type)).time;
    }
    if (hasOut) {
      const outRecs = day.record.filter((p) => /下班|OUT|out/i.test(p.type));
      punchOutTime = outRecs[outRecs.length - 1].time;
    }
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
  const todayTaipei = toTaipei(today);
  const todayKey = `${todayTaipei.getUTCFullYear()}-${String(todayTaipei.getUTCMonth() + 1).padStart(2, "0")}-${String(todayTaipei.getUTCDate()).padStart(2, "0")}`;

  let counter = 0;
  // 用台灣時區一天一天迭代（從 range.start 對應的 Taipei 日期）
  const startTaipei = toTaipei(range.start);
  const endTaipei = toTaipei(range.end);
  for (
    let d = new Date(startTaipei);
    d < endTaipei;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    if (key > todayKey) break;

    const day = byDate.get(key);
    counter++;
    if (!day) {
      // 沒有記錄
      result.push({ date: key, reason: "STATUS_BOTH_MISSING", id: `abnormal-${counter}` });
    } else if (
      day.reason !== "STATUS_PUNCH_NORMAL" &&
      day.reason !== "STATUS_LEAVE_APPROVED" &&
      day.reason !== "STATUS_VACATION_APPROVED" &&
      day.reason !== "STATUS_REPAIR_APPROVED"
    ) {
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
