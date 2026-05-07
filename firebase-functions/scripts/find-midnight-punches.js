#!/usr/bin/env node
/**
 * find-midnight-punches — 找出所有 00:00 的下班/上班打卡
 *
 * 用途：
 *   `dailyVirtualPunch` 排程上線前，admin 用 adjustPunch（補打卡）處理
 *   跨日班時，把下班時間填成「00:00」而不是「23:59」，造成 _pairShifts
 *   把孤兒下班 + 孤兒上班排到不同欄位，Excel 顯示「時間跑掉」。
 *
 *   此腳本掃出所有疑似誤填的「00:00 下班」紀錄，admin review 後決定是
 *   保留 / 改成 23:59（前一日）/ 或刪除。
 *
 * 用法（從 firebase-functions/ 目錄執行）：
 *   1. 先設定 ADC：
 *        gcloud auth application-default login
 *
 *   2. 列出當月（5 月）所有 00:00 下班：
 *        node scripts/find-midnight-punches.js
 *
 *   3. 列出指定月份：
 *        node scripts/find-midnight-punches.js --month=2026-04
 *
 *   4. 列出指定員工：
 *        node scripts/find-midnight-punches.js --user=U9e0f0ac0...
 *
 *   5. 也找上班 00:00（很罕見）：
 *        node scripts/find-midnight-punches.js --type=both
 *
 *   6. 輸出 JSON 方便後續處理：
 *        node scripts/find-midnight-punches.js --json
 *
 * 旗標：
 *   --month=YYYY-MM     掃指定月份（預設當月，台灣時區）
 *   --user=Uxxx         只找指定員工
 *   --type=下班|上班|both 只找該 type（預設下班，最常出錯的）
 *   --json              輸出 JSON（方便 jq pipe）
 *   --project=…         覆寫 project ID
 *   --fix               修正模式：把 timestamp 從 T16:00:00 推 1 秒到 T15:59:59
 *                       並刪除受影響的 attendanceMonthly（讓 lazy backfill 重建）
 *   --dry-run           搭配 --fix 用：只列計畫不動資料
 *
 * 修正流程範例：
 *   # 1. 先列出 4 月可疑紀錄
 *   node scripts/find-midnight-punches.js --month=2026-04
 *   # 2. 預演要做的修正動作
 *   node scripts/find-midnight-punches.js --month=2026-04 --fix --dry-run
 *   # 3. 確認後實際修正（5 秒倒數，可 Ctrl+C 中止）
 *   node scripts/find-midnight-punches.js --month=2026-04 --fix
 */

"use strict";

const path = require("node:path");
const { createRequire } = require("node:module");
const requireFromFunctions = createRequire(
  path.join(__dirname, "..", "functions", "package.json")
);
const admin = requireFromFunctions("firebase-admin");
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

// ===== CLI 參數 =====
const args = process.argv.slice(2);
const flags = {
  month: null,
  user: null,
  type: "下班",
  json: false,
  project: null,
  fix: false,
  dryRun: false,
};
for (const arg of args) {
  if (arg.startsWith("--month=")) flags.month = arg.slice(8);
  else if (arg.startsWith("--user=")) flags.user = arg.slice(7);
  else if (arg.startsWith("--type=")) flags.type = arg.slice(7);
  else if (arg === "--json") flags.json = true;
  else if (arg.startsWith("--project=")) flags.project = arg.slice(10);
  else if (arg === "--fix") flags.fix = true;
  else if (arg === "--dry-run") flags.dryRun = true;
}
if (!["下班", "上班", "both"].includes(flags.type)) {
  console.error(`❌ --type 必須是 下班 / 上班 / both`);
  process.exit(1);
}

// 預設當月（台灣時區）
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
function defaultMonth() {
  const now = new Date(Date.now() + TAIPEI_OFFSET_MS);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
if (!flags.month) flags.month = defaultMonth();
if (!/^\d{4}-\d{2}$/.test(flags.month)) {
  console.error(`❌ --month 格式錯誤：${flags.month}`);
  process.exit(1);
}

// ===== Firebase init =====
const projectId = flags.project || process.env.GCLOUD_PROJECT || "wenhui-check-in-system";
admin.initializeApp({ projectId });
const db = getFirestore(admin.app(), "default");

// ===== Helpers =====
function parseMonth(monthStr) {
  const m = monthStr.match(/^(\d{4})-(\d{2})$/);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const start = new Date(Date.UTC(year, month, 1) - TAIPEI_OFFSET_MS);
  const end = new Date(Date.UTC(year, month + 1, 1) - TAIPEI_OFFSET_MS);
  return { start, end };
}

function toTaipei(date) {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS);
}

function formatTaipei(date) {
  const t = toTaipei(date);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const d = String(t.getUTCDate()).padStart(2, "0");
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  const ss = String(t.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function isMidnightTaipei(date) {
  const t = toTaipei(date);
  return t.getUTCHours() === 0 && t.getUTCMinutes() === 0;
}

// ===== Main =====
async function main() {
  const { start, end } = parseMonth(flags.month);

  // 員工 userId → name 對應（為了人類可讀的輸出）
  const empSnap = await db.collection("employees").get();
  const userIdToName = new Map();
  empSnap.docs.forEach((d) => {
    userIdToName.set(d.id, d.data()?.name || "(未命名)");
  });

  // 掃 attendance
  let q = db
    .collection("attendance")
    .where("timestamp", ">=", start)
    .where("timestamp", "<", end);
  if (flags.user) q = q.where("userId", "==", flags.user);

  const snap = await q.get();

  // 過濾：type 符合 + 時間正好 00:00（台灣）
  const targetTypes = flags.type === "both" ? ["下班", "上班"] : [flags.type];
  const matches = [];
  snap.docs.forEach((doc) => {
    const data = doc.data();
    const ts = data.timestamp?.toDate?.();
    if (!ts) return;
    if (!targetTypes.includes(data.type)) return;
    if (!isMidnightTaipei(ts)) return;

    matches.push({
      docId: doc.id,
      userId: data.userId,
      name: userIdToName.get(data.userId) || "(已離職?)",
      type: data.type,
      timestamp: formatTaipei(ts),
      timestampUTC: ts.toISOString(),
      adjustmentType: data.adjustmentType || "",
      audit: data.audit || "",
      locationName: data.locationName || "",
      note: data.note || "",
    });
  });

  matches.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (flags.json) {
    console.log(JSON.stringify({ month: flags.month, count: matches.length, matches }, null, 2));
    return;
  }

  // 人類友善輸出
  console.log("");
  console.log(
    `🔍 月份：${flags.month}  Type：${flags.type}  ` +
      (flags.user ? `User：${flags.user}` : `(全部員工)`)
  );
  console.log(`   找到 ${matches.length} 筆「00:00」打卡（台灣時區）`);
  console.log("");

  if (matches.length === 0) {
    console.log("✅ 沒有可疑紀錄");
    return;
  }

  console.log("─".repeat(120));
  matches.forEach((m, i) => {
    console.log(
      `${String(i + 1).padStart(3)}. ${m.timestamp}  ${m.type}  ${m.name.padEnd(15)} ${m.userId.slice(0, 12)}…`
    );
    console.log(
      `      docId=${m.docId}` +
        `  adj=${m.adjustmentType || "(空)"}  audit=${m.audit || "(空)"}` +
        `  loc=${m.locationName || "(空)"}`
    );
    if (m.note) console.log(`      note: ${m.note.slice(0, 80)}${m.note.length > 80 ? "…" : ""}`);
  });
  console.log("─".repeat(120));

  // ===== 修正模式 =====
  if (flags.fix) {
    await applyFix(matches);
    return;
  }

  console.log("");
  console.log("💡 修法建議：");
  console.log("   📋 List 模式（目前）：只顯示，不動資料");
  console.log("   🔍 預演：node scripts/find-midnight-punches.js --month=" + flags.month + " --fix --dry-run");
  console.log("   ✏️  實際修正：node scripts/find-midnight-punches.js --month=" + flags.month + " --fix");
  console.log("");
  console.log("修正動作（每筆）：");
  console.log("   1. attendance.timestamp 從 T16:00:00 往前推 1 秒 → 前一日 T15:59:59 (= 台灣 23:59:59)");
  console.log("   2. 刪除受影響的 attendanceMonthly/{userId}_{YYYY-MM} doc → lazy backfill 重建");
}

/**
 * 把列出的「00:00」誤填補卡修正為「前一日 23:59:59」
 *
 * 安全：先列計畫，倒數 5 秒後才動手；--dry-run 只列計畫不動手
 */
async function applyFix(matches) {
  if (matches.length === 0) {
    console.log("✅ 無需修正");
    return;
  }

  console.log("");
  console.log(flags.dryRun ? "🔍 [DRY-RUN] 修正計畫：" : "✏️ 修正計畫：");
  console.log("─".repeat(120));

  // 計算每筆 new timestamp + 收集要刪的 attendanceMonthly key
  const plans = matches.map((m) => {
    const oldTs = new Date(m.timestampUTC);
    const newTs = new Date(oldTs.getTime() - 1000); // -1 秒
    return {
      ...m,
      oldTimestamp: m.timestamp,
      newTimestamp: formatTaipei(newTs),
      newTsDate: newTs,
      // 受影響月份：原始月 + 新月份（若跨月，譬如 5/1 00:00 → 4/30 23:59:59）
      affectedMonthKeys: collectMonthKeys(oldTs, newTs).map((mk) => `${m.userId}_${mk}`),
    };
  });

  plans.forEach((p, i) => {
    console.log(
      `${String(i + 1).padStart(3)}. ${p.name.padEnd(15)} ${p.userId.slice(0, 12)}…`
    );
    console.log(`      docId=${p.docId}`);
    console.log(`      ${p.oldTimestamp}  →  ${p.newTimestamp}`);
    console.log(`      將刪除聚合: ${p.affectedMonthKeys.join(", ")}`);
  });

  // 收集所有不重複的 attendanceMonthly key
  const aggregateKeysToDelete = new Set();
  plans.forEach((p) => p.affectedMonthKeys.forEach((k) => aggregateKeysToDelete.add(k)));

  console.log("─".repeat(120));
  console.log(`✏️ 共修正 ${plans.length} 筆 attendance + 刪除 ${aggregateKeysToDelete.size} 個 attendanceMonthly`);

  if (flags.dryRun) {
    console.log("");
    console.log("⚠️ DRY-RUN：實際沒有寫入。確認計畫無誤後，拿掉 --dry-run 重跑。");
    return;
  }

  console.log("");
  console.log("⏳ 5 秒後開始執行（Ctrl+C 中斷）...");
  await sleep(5000);

  let okCount = 0;
  let failCount = 0;

  // 1. 修正 attendance docs
  for (const p of plans) {
    try {
      await db.collection("attendance").doc(p.docId).update({
        timestamp: admin.firestore.Timestamp.fromDate(p.newTsDate),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: "scripts/find-midnight-punches.js --fix",
        fixHistory: admin.firestore.FieldValue.arrayUnion({
          at: new Date().toISOString(),
          from: p.oldTimestamp,
          to: p.newTimestamp,
          reason: "誤填 00:00 下班 → 前一日 23:59:59",
        }),
      });
      console.log(`   ✅ ${p.docId} ${p.oldTimestamp} → ${p.newTimestamp}`);
      okCount++;
    } catch (err) {
      console.error(`   ❌ ${p.docId} 失敗: ${err.message}`);
      failCount++;
    }
  }

  // 2. 刪除受影響的 attendanceMonthly 聚合 doc（讓 lazy backfill 重建）
  console.log("");
  console.log("🗑️ 刪除受影響的 attendanceMonthly 聚合 doc...");
  let deletedCount = 0;
  for (const key of aggregateKeysToDelete) {
    try {
      const ref = db.collection("attendanceMonthly").doc(key);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.delete();
        console.log(`   ✅ 刪除 ${key}`);
        deletedCount++;
      } else {
        console.log(`   ⏭️ 跳過 ${key}（doc 不存在）`);
      }
    } catch (err) {
      console.error(`   ❌ ${key} 刪除失敗: ${err.message}`);
    }
  }

  console.log("");
  console.log(`📊 完成：attendance 修正 ${okCount} / 失敗 ${failCount}；attendanceMonthly 刪除 ${deletedCount}`);
  console.log("");
  console.log("🔁 下次有人開該員工該月月曆時，會自動 lazy backfill 重建聚合 doc（getMonthlyDailyStatus）。");
  console.log("   建議現在去前端測試：選一位被修正的員工 → 看 4 月月曆 → 應該看到正確的 D/E 時間欄位。");
}

/**
 * 推算 oldTs 到 newTs 之間涵蓋的「YYYY-MM」月份（台灣時區）
 * 通常返回 1 個月，但跨月時會返回 2 個月（譬如 5/1 00:00 → 4/30 23:59:59）
 */
function collectMonthKeys(oldTs, newTs) {
  const monthKey = (date) => {
    const t = toTaipei(date);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const keys = new Set([monthKey(oldTs), monthKey(newTs)]);
  return Array.from(keys);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[find-midnight-punches] 例外:", err);
    process.exit(1);
  });
