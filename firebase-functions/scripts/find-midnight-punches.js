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
};
for (const arg of args) {
  if (arg.startsWith("--month=")) flags.month = arg.slice(8);
  else if (arg.startsWith("--user=")) flags.user = arg.slice(7);
  else if (arg.startsWith("--type=")) flags.type = arg.slice(7);
  else if (arg === "--json") flags.json = true;
  else if (arg.startsWith("--project=")) flags.project = arg.slice(10);
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

  console.log("");
  console.log("💡 修法建議：");
  console.log("   1. 確認該紀錄是「跨日下班補卡誤填 00:00」（看 adj=補打卡 + note）");
  console.log("   2. Firestore Console 找到該 docId，把 timestamp 改成「前一日 23:59:59」");
  console.log("   3. 修完後 admin 重匯該員工的 Excel，時間欄位會回到 D/E");
  console.log("");
  console.log("⚠️ 不要直接刪除！否則 attendanceMonthly 聚合 doc 不會跟著更新；");
  console.log("   應該『改 timestamp 同時保留 doc』，並手動觸發該員工該月的重算");
  console.log("   （或刪除 attendanceMonthly/{userId}_YYYY-MM doc 讓 lazy backfill 重建）");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[find-midnight-punches] 例外:", err);
    process.exit(1);
  });
