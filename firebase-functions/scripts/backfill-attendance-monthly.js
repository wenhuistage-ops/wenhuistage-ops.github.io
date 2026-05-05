#!/usr/bin/env node
/**
 * backfill-attendance-monthly — 一次性 backfill 歷史月份聚合 doc
 *
 * 對應計畫：docs/plans/Firestore-讀取最佳化-月度聚合計畫.md §3.7
 *
 * 用途：
 *   Phase 2 deploy 前跑一次，把所有歷史月份的 attendanceMonthly 聚合 doc 補完，
 *   把 lazy backfill 的競態窗口降到 0。
 *
 * 前置條件：
 *   - Phase 1 (mutation 端點 shadow write) 已 deploy
 *   - 跑這個腳本時，建議在低流量時段（避免並行 punch 造成競態，雖然腳本檢查 doc
 *     存在性會 idempotent，但避免不必要的覆寫）
 *
 * 執行方式（從 firebase-functions/ 目錄執行）：
 *   1. 先設定 ADC（Application Default Credentials）：
 *        gcloud auth application-default login
 *
 *   2. 試跑（不寫入）：
 *        node scripts/backfill-attendance-monthly.js --dry-run --month=2026-04
 *
 *   3. 試跑單員工：
 *        node scripts/backfill-attendance-monthly.js --dry-run --user=Uxxxxxx
 *
 *   4. 正式跑：
 *        node scripts/backfill-attendance-monthly.js
 *
 *   5. 強制覆寫已存在的聚合 doc（譬如修 schema bug 後重建）：
 *        node scripts/backfill-attendance-monthly.js --force
 *
 * 旗標：
 *   --dry-run            只 log 不寫入
 *   --force              覆寫已存在的聚合 doc（預設跳過）
 *   --month=YYYY-MM      只處理指定月份（其他月份不動）
 *   --user=Uxxxxxx       只處理指定員工
 *   --project=wenhui-…   覆寫專案 ID（預設讀 ADC）
 */

"use strict";

const admin = require("firebase-admin");

// ===================================
// CLI 參數解析
// ===================================
const args = process.argv.slice(2);
const flags = {
  dryRun: args.includes("--dry-run"),
  force: args.includes("--force"),
  month: null,
  user: null,
  project: null,
};
for (const arg of args) {
  if (arg.startsWith("--month=")) flags.month = arg.slice(8);
  if (arg.startsWith("--user=")) flags.user = arg.slice(7);
  if (arg.startsWith("--project=")) flags.project = arg.slice(10);
}

if (flags.month && !/^\d{4}-\d{2}$/.test(flags.month)) {
  console.error(`❌ --month 格式錯誤：${flags.month}，預期 YYYY-MM`);
  process.exit(1);
}

// ===================================
// Firebase Admin 初始化
// ===================================
const projectId = flags.project || process.env.GCLOUD_PROJECT || "wenhui-check-in-system";
admin.initializeApp({ projectId });
const FIRESTORE_DATABASE_ID = "default"; // 與 _helpers.js 一致
const db = admin.firestore.getFirestore
  ? admin.firestore.getFirestore(admin.app(), FIRESTORE_DATABASE_ID)
  : require("firebase-admin/firestore").getFirestore(admin.app(), FIRESTORE_DATABASE_ID);

// ===================================
// 載入 _attendance.js 的 summarizeByDay
// ===================================
// 該 module 會 require _helpers.js 引發 admin.initializeApp() 衝突；
// 為了不重新實作 summarizeByDay 的去重 / reason / hours 邏輯，這裡直接 inline
// 一份最小化的 attendance 計算副本。長期可以 refactor 抽到 pure helper。
//
// 注意：此處的 summarizeByDay 必須與 functions/src/_attendance.js 保持邏輯一致。
// 若該檔修改判斷規則，本檔也須同步更新。

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function toTaipei(date) {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS);
}

function parseMonth(monthStr) {
  const m = String(monthStr || "").match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0) - TAIPEI_OFFSET_MS);
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0) - TAIPEI_OFFSET_MS);
  return { start, end, year, month };
}

function _hhmmToMin(s) {
  const m = String(s || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

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
        continue;
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
    const t = toTaipei(d);
    const key = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;

    if (!byDay.has(key)) byDay.set(key, { date: key, record: [] });
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

    const isDup = day.record.some(
      (p) =>
        p.time === newRecord.time &&
        p.type === newRecord.type &&
        p.location === newRecord.location
    );
    if (!isDup) day.record.push(newRecord);
  });

  const days = [];
  for (const day of byDay.values()) {
    day.record = _dedupeAdjacentSameType(day.record);

    const hasIn = day.record.some((p) => /上班|IN|in/i.test(p.type));
    const hasOut = day.record.some((p) => /下班|OUT|out/i.test(p.type));

    const leaveRecord = day.record.find(
      (p) => p.adjustmentType === "系統請假記錄" || /請假/.test(p.type)
    );
    const vacationRecord = day.record.find((p) => /休假/.test(p.type));
    const adjustRecord = day.record.find((p) => p.adjustmentType === "補打卡");
    const approvedAudit = (r) => r && r.audit === "v";
    const pendingAudit = (r) => r && r.audit === "?";

    let reason = "STATUS_PUNCH_NORMAL";
    if (approvedAudit(leaveRecord)) reason = "STATUS_LEAVE_APPROVED";
    else if (pendingAudit(leaveRecord)) reason = "STATUS_LEAVE_PENDING";
    else if (approvedAudit(vacationRecord)) reason = "STATUS_VACATION_APPROVED";
    else if (pendingAudit(vacationRecord)) reason = "STATUS_VACATION_PENDING";
    else if (approvedAudit(adjustRecord)) reason = "STATUS_REPAIR_APPROVED";
    else if (pendingAudit(adjustRecord)) reason = "STATUS_REPAIR_PENDING";
    else if (!hasIn && !hasOut) reason = "STATUS_BOTH_MISSING";
    else if (!hasIn) reason = "STATUS_PUNCH_IN_MISSING";
    else if (!hasOut) reason = "STATUS_PUNCH_OUT_MISSING";

    let hours = 0;
    let punchInTime = "";
    let punchOutTime = "";
    if (hasIn) punchInTime = day.record.find((p) => /上班|IN|in/i.test(p.type)).time;
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
      isHoliday: false,
      record: day.record,
    });
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

// ===================================
// Backfill 主邏輯
// ===================================

async function listEmployees() {
  if (flags.user) {
    const snap = await db.collection("employees").doc(flags.user).get();
    if (!snap.exists) {
      console.error(`❌ 員工 ${flags.user} 不存在`);
      process.exit(1);
    }
    return [{ userId: flags.user, name: snap.data()?.name || "" }];
  }
  const snap = await db.collection("employees").get();
  return snap.docs.map((d) => ({
    userId: d.id,
    name: d.data()?.name || "",
  }));
}

/**
 * 找出該員工所有「有 attendance 資料」的月份
 */
async function findActiveMonths(userId) {
  if (flags.month) return [flags.month];

  // 用兩次 limit(1) 查詢拿到最早 / 最晚的 timestamp
  const [oldestSnap, newestSnap] = await Promise.all([
    db
      .collection("attendance")
      .where("userId", "==", userId)
      .orderBy("timestamp", "asc")
      .limit(1)
      .get(),
    db
      .collection("attendance")
      .where("userId", "==", userId)
      .orderBy("timestamp", "desc")
      .limit(1)
      .get(),
  ]);

  if (oldestSnap.empty || newestSnap.empty) return [];

  const oldest = oldestSnap.docs[0].data().timestamp.toDate();
  const newest = newestSnap.docs[0].data().timestamp.toDate();

  const monthsSet = new Set();
  let cursor = toTaipei(oldest);
  const stop = toTaipei(newest);
  while (
    cursor.getUTCFullYear() < stop.getUTCFullYear() ||
    (cursor.getUTCFullYear() === stop.getUTCFullYear() &&
      cursor.getUTCMonth() <= stop.getUTCMonth())
  ) {
    monthsSet.add(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`
    );
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return Array.from(monthsSet).sort();
}

async function fetchMonthRecords(userId, month) {
  const range = parseMonth(month);
  if (!range) return [];
  const snap = await db
    .collection("attendance")
    .where("userId", "==", userId)
    .where("timestamp", ">=", range.start)
    .where("timestamp", "<", range.end)
    .orderBy("timestamp", "asc")
    .get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    date: doc.data().timestamp?.toDate?.() || doc.data().timestamp,
  }));
}

async function backfillUserMonth(userId, month, stats) {
  const docId = `${userId}_${month}`;
  const ref = db.collection("attendanceMonthly").doc(docId);

  if (!flags.force) {
    const existing = await ref.get();
    stats.reads += 1;
    if (existing.exists) {
      stats.skipped += 1;
      console.log(`  [skip] ${month}（已存在）`);
      return;
    }
  }

  const records = await fetchMonthRecords(userId, month);
  stats.reads += records.length || 1;

  if (records.length === 0) {
    stats.empty += 1;
    console.log(`  [empty] ${month}（無 attendance 資料，不寫入）`);
    return;
  }

  const dailyStatus = summarizeByDay(records);

  if (flags.dryRun) {
    stats.wouldWrite += 1;
    console.log(
      `  [dry] ${month}（讀 ${records.length} docs，會寫入 ${dailyStatus.length} 天 dailyStatus）`
    );
    return;
  }

  await ref.set({
    userId,
    month,
    dailyStatus,
    recordCount: records.length,
    rebuiltAt: admin.firestore.FieldValue.serverTimestamp(),
    lastEventAt: admin.firestore.FieldValue.serverTimestamp(),
    schemaVersion: 1,
    backfilledBy: "scripts/backfill-attendance-monthly.js",
  });
  stats.written += 1;
  stats.writes += 1;
  console.log(`  [write] ${month}（讀 ${records.length} docs → 寫 1 doc）`);
}

async function main() {
  const mode = flags.dryRun ? "DRY-RUN" : flags.force ? "FORCE" : "LIVE";
  console.log(`[backfill] 開始（mode=${mode}, project=${projectId}）`);
  if (flags.month) console.log(`[backfill] 限定月份：${flags.month}`);
  if (flags.user) console.log(`[backfill] 限定員工：${flags.user}`);

  const stats = {
    reads: 0,
    writes: 0,
    written: 0,
    skipped: 0,
    empty: 0,
    wouldWrite: 0,
    failed: 0,
  };

  const employees = await listEmployees();
  stats.reads += employees.length || 1;
  console.log(`[backfill] 找到 ${employees.length} 員工`);

  for (const emp of employees) {
    let months;
    try {
      months = await findActiveMonths(emp.userId);
      stats.reads += 2; // oldest + newest 各 1 read
    } catch (err) {
      stats.failed += 1;
      console.error(`❌ ${emp.userId} ${emp.name} findActiveMonths 失敗:`, err.message);
      continue;
    }
    if (months.length === 0) {
      console.log(`[backfill] ${emp.userId} ${emp.name} → 無歷史資料，跳過`);
      continue;
    }
    console.log(
      `[backfill] ${emp.userId} ${emp.name} → ${months[0]} ~ ${months[months.length - 1]}（${months.length} 月）`
    );
    for (const month of months) {
      try {
        await backfillUserMonth(emp.userId, month, stats);
      } catch (err) {
        stats.failed += 1;
        console.error(
          `❌ ${emp.userId} ${month} 失敗:`,
          err.message
        );
      }
    }
  }

  console.log("");
  console.log("[backfill] 完成");
  console.log(
    `  員工 ${employees.length} / 寫入 ${stats.written} / 跳過 ${stats.skipped} / ` +
      `空月 ${stats.empty} / 預演 ${stats.wouldWrite} / 失敗 ${stats.failed}`
  );
  console.log(`  reads ≈ ${stats.reads}, writes ≈ ${stats.writes}`);
  if (flags.dryRun) {
    console.log("  ⚠️ DRY-RUN：沒有實際寫入。確認數字後拿掉 --dry-run 再跑一次。");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill] 例外:", err);
    process.exit(1);
  });
