/**
 * 打卡資料查詢共用 helper
 *
 * - getMonthlyAttendance(month, userId)：指定月份（YYYY-MM）的打卡記錄
 * - summarizeByDay(records)：按日分組並提供基礎判斷
 *
 * 基礎判斷邏輯為簡化版，複雜異常規則（STATUS_LATE / STATUS_EARLY_LEAVE 等）
 * 在原 GS Utils.gs 有完整實作；此處保留 TODO 待對齊。
 */

const admin = require("firebase-admin");
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
 * In-process 月度打卡 cache（同容器活躍期共享，TTL 5 分鐘）
 *
 * 為什麼：每次 getCalendarSummary / getCompleteAttendanceRecords /
 * getAttendanceDetails / getAbnormalRecords 都打 getMonthlyAttendance，
 * 一個員工一個月 ~50-60 docs = ~60 reads。多人同時看 / 反覆切月份會快速累積。
 *
 * 取捨：
 *   - 員工新打卡後最多 5 分鐘才在月曆 / 異常檢查端看到 → mutation 端
 *     主動 invalidate（同容器立即生效，跨容器仰賴 TTL 過期）
 *   - 容器冷啟動時 cache 空，第一次仍要讀 ~60 次
 *   - LRU-style：超過 200 筆刪最舊
 */
const MONTHLY_CACHE = new Map();
const MONTHLY_CACHE_TTL_MS = 5 * 60 * 1000;
const MONTHLY_CACHE_MAX = 200;

function _monthlyCacheKey(month, userId) {
  return `${userId || "all"}|${month}`;
}

function _setMonthlyCache(key, value) {
  MONTHLY_CACHE.set(key, { value, expiry: Date.now() + MONTHLY_CACHE_TTL_MS });
  if (MONTHLY_CACHE.size > MONTHLY_CACHE_MAX) {
    const oldest = MONTHLY_CACHE.keys().next().value;
    MONTHLY_CACHE.delete(oldest);
  }
}

/**
 * 主動清除月度快取（mutation 端使用）
 *
 * @param {string|Date} dateOrMonth  YYYY-MM 或 Date 或 timestamp（會推算所屬月份）
 * @param {string} userId  該員工 ID（必填）
 */
function invalidateMonthlyCacheForDate(dateOrMonth, userId) {
  if (!userId) return;
  let month;
  if (typeof dateOrMonth === "string" && /^\d{4}-\d{2}$/.test(dateOrMonth)) {
    month = dateOrMonth;
  } else {
    const d = dateOrMonth instanceof Date ? dateOrMonth : new Date(dateOrMonth);
    if (isNaN(d.getTime())) return;
    // 用台灣時區計算月份 key
    const t = new Date(d.getTime() + TAIPEI_OFFSET_MS);
    month = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  // 員工自己的 key + admin 查全公司的 key（'all'）兩個都要清
  MONTHLY_CACHE.delete(_monthlyCacheKey(month, userId));
  MONTHLY_CACHE.delete(_monthlyCacheKey(month, null));
}

/**
 * 取得指定月份的打卡記錄（可選 userId 過濾）
 * 命中 cache 直接回，省下 ~60 reads / 月。
 *
 * @returns {Array<Object>}
 */
async function getMonthlyAttendance(month, userId) {
  const range = parseMonth(month);
  if (!range) return [];

  const cacheKey = _monthlyCacheKey(month, userId);
  const cached = MONTHLY_CACHE.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.value;
  }

  let query = db
    .collection(COLLECTIONS.ATTENDANCE)
    .where("timestamp", ">=", range.start)
    .where("timestamp", "<", range.end)
    .orderBy("timestamp", "asc");

  if (userId) {
    query = query.where("userId", "==", userId);
  }

  const snap = await query.get();
  const result = snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    // Timestamp → Date（方便後續處理）
    date: doc.data().timestamp?.toDate?.() || doc.data().timestamp,
  }));

  _setMonthlyCache(cacheKey, result);
  return result;
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
      // 2026-05-14：record 帶 attendance doc id，讓前端能對單筆操作
      //   - admin 刪除虛擬卡（deleteAttendance endpoint）
      //   - 未來其他單筆操作
      // 舊聚合 doc（pre-2026-05-14）的 record 內無此欄位，前端需 fallback
      id: r.id || "",
      time: `${hh}:${mm}`,
      type: r.type || "",
      location: r.locationName || "",
      note: r.note || "",
      audit: r.audit || "",
      adjustmentType: r.adjustmentType || "",
      // 2026-05-15：admin 代員工補卡會寫 createdByAdmin = adminUserId
      // 帶出來讓前端 badge 區分「員工補卡」vs「Admin 代補」
      createdByAdmin: r.createdByAdmin || "",
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

    // 工時只計「已核准」的補打卡：未核准（'?' 待審）或已拒絕（'x'）的補打卡
    // 不得灌工時（否則審核流程對薪資計算形同虛設）。一般即時打卡與系統虛擬卡的
    // adjustmentType 非 '補打卡'、admin 代補卡 audit 已是 'v'，維持納入。
    const countable = day.record.filter(
      (p) => p.adjustmentType !== "補打卡" || p.audit === "v"
    );
    const hasIn = countable.some((p) => /上班|IN|in/i.test(p.type));
    const hasOut = countable.some((p) => /下班|OUT|out/i.test(p.type));

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

    // 簡易工時估算（不扣休息）
    // punchInTime 取「最早」上班、punchOutTime 取「最晚」下班（顯示用欄位不變）
    // 2026-06-03 雙班修正：hours 改為「逐班 span 加總」— 舊版用 首上班→末下班
    // 整段計算，雙班日（早班+晚班）的班距空檔被誤算成工時。
    let hours = 0;
    let punchInTime = "";
    let punchOutTime = "";
    if (hasIn) {
      punchInTime = countable.find((p) => /上班|IN|in/i.test(p.type)).time;
    }
    if (hasOut) {
      const outRecs = countable.filter((p) => /下班|OUT|out/i.test(p.type));
      punchOutTime = outRecs[outRecs.length - 1].time;
    }
    if (punchInTime && punchOutTime) {
      const toMin = (t) => {
        const [h, m] = String(t).split(":").map(Number);
        return h * 60 + m;
      };
      // 配對班次：依時間排序，上班配下一筆下班；連續上班取最早、連續下班取最晚
      const sorted = countable
        .filter((p) => p.time && /上班|下班|IN|OUT/i.test(p.type || ""))
        .slice()
        .sort((a, b) => String(a.time).localeCompare(String(b.time)));
      const ranges = [];
      let pendingIn = null;
      for (const p of sorted) {
        const isOut = /下班|OUT/i.test(p.type || "");
        if (!isOut) {
          if (pendingIn == null) pendingIn = p.time;
        } else if (pendingIn != null) {
          ranges.push([pendingIn, p.time]);
          pendingIn = null;
        } else if (ranges.length > 0 && String(p.time) > String(ranges[ranges.length - 1][1])) {
          ranges[ranges.length - 1][1] = p.time; // 連續下班取最晚
        }
      }
      if (ranges.length > 0) {
        hours = ranges.reduce(
          (acc, [tin, tout]) => acc + Math.max(0, (toMin(tout) - toMin(tin)) / 60),
          0
        );
      } else {
        // 配不出完整班次（理論上 hasIn && hasOut 必有一班；保險 fallback 舊整段法）
        hours = Math.max(0, (toMin(punchOutTime) - toMin(punchInTime)) / 60);
      }
    }

    // 2026-05-14：hasVirtual flag 標記該日含系統虛擬卡（dailyVirtualPunch 補的）
    //   前端月曆用此 flag 加紫色角標，跟 reason 解耦（reason 仍照 hasIn/hasOut 算）
    const hasVirtual = day.record.some(
      (p) => p.adjustmentType === "系統虛擬卡"
    );

    // M4「請假為準」：當日已核准請假/休假時，工時歸零（避免請假與出勤雙重給付）。
    // 請假為整日單位，其給付另循請假規則，不再疊算出勤工時/加班。
    if (reason === "STATUS_LEAVE_APPROVED" || reason === "STATUS_VACATION_APPROVED") {
      hours = 0;
    }

    days.push({
      date: day.date,
      reason,
      hours: Number(hours.toFixed(2)),
      punchInTime,
      punchOutTime,
      isHoliday: false, // TODO：整合國定假日 map
      hasVirtual,
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

/**
 * 把 Date 推算成 Asia/Taipei 時區的 month / dateKey / 該日 UTC 起訖
 * @returns { month: 'YYYY-MM', dateKey: 'YYYY-MM-DD', dayStart, dayEnd }
 */
function _taipeiDayBounds(date) {
  const t = toTaipei(date);
  const year = t.getUTCFullYear();
  const monthIdx = t.getUTCMonth(); // 0-indexed
  const dayNum = t.getUTCDate();
  const month = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
  const dateKey = `${month}-${String(dayNum).padStart(2, "0")}`;
  // Taipei 該日 00:00 = UTC 該日 00:00 - 8h
  const dayStart = new Date(Date.UTC(year, monthIdx, dayNum, 0, 0, 0) - TAIPEI_OFFSET_MS);
  const dayEnd = new Date(Date.UTC(year, monthIdx, dayNum + 1, 0, 0, 0) - TAIPEI_OFFSET_MS);
  return { month, dateKey, dayStart, dayEnd };
}

/**
 * 把單一事件（打卡 / 申請 / approve / reject）反映到 attendanceMonthly 物化視圖。
 *
 * 演算法：「day-level recompute」——只重算受影響那一天的 dailyStatus，再 merge 進
 * 原本的月度 doc。每次呼叫 ~3-5 reads（該日的 raw records）+ 1 read（聚合 doc）+ 1 write。
 *
 * Race-safe：用 transaction 包住「讀該日 raw records → 讀現有聚合 → 寫回」，
 * 兩個並行 punch 透過 Firestore 自動 retry 機制處理。
 *
 * 設計細節參考 docs/plans/Firestore-讀取最佳化-月度聚合計畫.md §3.3
 *
 * @param {string} userId
 * @param {Date | Timestamp | string} eventDate 事件發生的時間（用來推算月份與日期）
 * @returns {Promise<void>}
 */
async function applyEventToMonthly(userId, eventDate) {
  if (!userId || !eventDate) return;
  const d = eventDate instanceof Date ? eventDate : new Date(eventDate?.toDate?.() || eventDate);
  if (isNaN(d.getTime())) return;

  const { month, dateKey, dayStart, dayEnd } = _taipeiDayBounds(d);
  const monthRef = db
    .collection(COLLECTIONS.ATTENDANCE_MONTHLY)
    .doc(`${userId}_${month}`);

  // 該日 query（incremental update 用）
  const dayQuery = db
    .collection(COLLECTIONS.ATTENDANCE)
    .where("userId", "==", userId)
    .where("timestamp", ">=", dayStart)
    .where("timestamp", "<", dayEnd);

  // 該月 query（首次建立聚合用，避免「只寫一天」造成歷史日資料看似消失）
  const monthRange = parseMonth(month);

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(monthRef);

    if (!existing.exists) {
      // ===== 首次建立：讀整月 raw 重建 dailyStatus =====
      // 否則只寫「事件當日」一天，其他歷史日會在後續讀月曆時看似消失。
      // 成本：~50 reads + 1 write（每員工每月只發生一次）
      const monthSnap = await tx.get(
        db
          .collection(COLLECTIONS.ATTENDANCE)
          .where("userId", "==", userId)
          .where("timestamp", ">=", monthRange.start)
          .where("timestamp", "<", monthRange.end)
      );
      const monthRecords = monthSnap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          date: data.timestamp?.toDate?.() || data.timestamp,
        };
      });
      const dailyStatus = summarizeByDay(monthRecords);

      tx.set(monthRef, {
        userId,
        month,
        dailyStatus,
        recordCount: monthRecords.length,
        lastEventAt: admin.firestore.FieldValue.serverTimestamp(),
        rebuiltAt: admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion: 1,
      });
      return;
    }

    // ===== 增量更新：只重算該日，併入現有 dailyStatus =====
    // 成本：~3-5 reads + 1 write（每次 punch / approve / reject）
    const daySnap = await tx.get(dayQuery);
    const records = daySnap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        date: data.timestamp?.toDate?.() || data.timestamp,
      };
    });

    const oldDailyStatus = existing.data().dailyStatus || [];
    const dayResults = summarizeByDay(records);
    const dayData = dayResults.find((x) => x.date === dateKey) || null;

    let dailyStatus = oldDailyStatus.filter((x) => x.date !== dateKey);
    if (dayData) dailyStatus.push(dayData);
    dailyStatus.sort((a, b) => a.date.localeCompare(b.date));

    tx.set(monthRef, {
      userId,
      month,
      dailyStatus,
      recordCount: dailyStatus.reduce(
        (sum, day) => sum + ((day.record || []).length),
        0
      ),
      lastEventAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 1,
    });
  });

  // 同容器月度 cache 也清掉，跨容器仰賴 5 分鐘 TTL
  invalidateMonthlyCacheForDate(d, userId);
}

/**
 * 取得月度 dailyStatus（Phase 2 主入口，被 getCalendarSummary / getAttendanceDetails 共用）
 *
 * 流程：
 *   1. 快速路徑：讀 attendanceMonthly 物化視圖（1 read）。命中 → 直接回傳 dailyStatus
 *   2. Lazy fallback（Phase 1.5 backfill 涵蓋後極少觸發）：
 *      a. 讀 raw attendance + summarizeByDay 重算（~50 reads）
 *      b. transaction 內 recheck：若期間有並行 punch 已建立聚合 doc，
 *         合併後寫回（existing 優先，因為它較新）
 *
 * 期望命中率 > 99%（Phase 1.5 backfill 已涵蓋所有歷史月份），
 * fallback 是兜底安全網。
 *
 * @param {string} userId
 * @param {string} month 'YYYY-MM'
 * @returns {Promise<Array>} dailyStatus 陣列
 */
async function getMonthlyDailyStatus(userId, month) {
  if (!userId || !month) return [];

  const monthRef = db
    .collection(COLLECTIONS.ATTENDANCE_MONTHLY)
    .doc(`${userId}_${month}`);

  // ===== 快速路徑：聚合 doc 已存在 =====
  const snap = await monthRef.get();
  if (snap.exists) {
    // hit log：用於統計命中率（不要太冗長，每次只印 1 行）
    console.log(`[reads] getMonthlyDailyStatus HIT u=${userId.slice(0, 8)} m=${month} reads=1`);
    const data = snap.data();
    return Array.isArray(data?.dailyStatus) ? data.dailyStatus : [];
  }

  // ===== Lazy fallback：從 raw attendance 重算 =====
  // ⚠️ MISS 代表這個 (userId, month) 還沒 backfill，會燒 ~50 reads。
  //    如果經常看到 MISS log，請跑 backfill-attendance-monthly.js --month=YYYY-MM
  const records = await getMonthlyAttendance(month, userId);
  const dailyStatus = summarizeByDay(records);
  console.warn(
    `[reads] getMonthlyDailyStatus MISS u=${userId.slice(0, 8)} m=${month} reads=~${records.length + 2} (建議跑 backfill --month=${month})`
  );

  // 用 transaction 寫入，避免被並行 punch 蓋掉
  await db.runTransaction(async (tx) => {
    const recheck = await tx.get(monthRef);

    if (!recheck.exists) {
      // 沒有競態，正常寫入完整 backfill
      tx.set(monthRef, {
        userId,
        month,
        dailyStatus,
        recordCount: records.length,
        rebuiltAt: admin.firestore.FieldValue.serverTimestamp(),
        lastEventAt: admin.firestore.FieldValue.serverTimestamp(),
        schemaVersion: 1,
      });
      return;
    }

    // 競態發生：在 raw read 期間有 applyEventToMonthly 寫入，
    // 把我們的 backfill 與 existing merge（existing 優先，因它較新）
    const existing = recheck.data() || {};
    const existingDays = Array.isArray(existing.dailyStatus) ? existing.dailyStatus : [];
    const byDate = new Map();
    dailyStatus.forEach((d) => byDate.set(d.date, d)); // ours
    existingDays.forEach((d) => byDate.set(d.date, d)); // existing 覆蓋
    const merged = Array.from(byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    tx.set(monthRef, {
      userId,
      month,
      dailyStatus: merged,
      recordCount: merged.reduce(
        (sum, d) => sum + ((d.record || []).length),
        0
      ),
      rebuiltAt: admin.firestore.FieldValue.serverTimestamp(),
      lastEventAt: admin.firestore.FieldValue.serverTimestamp(),
      schemaVersion: 1,
    });
  });

  // 重讀拿最終版本（可能是 ours 也可能是 merged）
  const final = await monthRef.get();
  const finalData = final.data();
  return Array.isArray(finalData?.dailyStatus) ? finalData.dailyStatus : dailyStatus;
}

/**
 * 從 raw attendance 重建單一員工單月的聚合 doc（一次性 backfill 用）
 *
 * 與 applyEventToMonthly 不同：這個跑「全月 recompute」（讀 ~60 docs），
 * 適合 Phase 1.5 一次性 backfill 腳本，或 Phase 2 fallback 時走的全月重建路徑。
 *
 * 注意：本函式不使用 transaction（呼叫端應確保沒有並行 punch，例如離線跑腳本時）。
 * 在 Phase 2 fallback 內呼叫請另外用 transaction 包，避免覆寫並行 punch 寫入。
 *
 * @param {string} userId
 * @param {string} month 'YYYY-MM'
 * @returns {Promise<{ recordCount: number, dailyStatus: Array }>}
 */
async function rebuildMonthlyAggregate(userId, month) {
  const records = await getMonthlyAttendance(month, userId);
  const dailyStatus = summarizeByDay(records);
  const monthRef = db
    .collection(COLLECTIONS.ATTENDANCE_MONTHLY)
    .doc(`${userId}_${month}`);

  await monthRef.set({
    userId,
    month,
    dailyStatus,
    recordCount: records.length,
    lastEventAt: admin.firestore.FieldValue.serverTimestamp(),
    rebuiltAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 1,
  });

  return { recordCount: records.length, dailyStatus };
}

module.exports = {
  parseMonth,
  getMonthlyAttendance,
  invalidateMonthlyCacheForDate,
  summarizeByDay,
  detectAbnormal,
  applyEventToMonthly,
  rebuildMonthlyAggregate,
  getMonthlyDailyStatus,
};
