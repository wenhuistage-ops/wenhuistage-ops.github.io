#!/usr/bin/env node
/**
 * Google Sheets → Firestore 資料遷移腳本
 *
 * 完整實作：讀 Google Sheets → 依欄位對應寫入 Firestore collections。
 *
 * ⚠️ 執行前必讀：
 *   1. 請「先複製正式 Sheets 為測試副本」，對副本執行本腳本
 *   2. 服務帳號必須被加入 Sheet 的「共用者」名單（至少「檢視者」）
 *   3. 第一次先跑 --dry-run 驗證欄位對應正確
 *   4. 執行前確認已備份，或者確認 Firestore 可重跑
 *
 * 前置：
 *   cd scripts
 *   npm install                                       # 安裝 firebase-admin + googleapis
 *   # 把 Firebase 服務帳號金鑰放在 scripts/serviceAccountKey.json（已 gitignore）
 *   export TEST_SPREADSHEET_ID=<複製副本的 Sheet ID>
 *
 * 使用：
 *   node migrate-to-firestore.js --dry-run            # 乾跑，輸出計畫不寫入
 *   node migrate-to-firestore.js                      # 正式執行
 *   node migrate-to-firestore.js --only=employees     # 只遷某個 collection
 *   node migrate-to-firestore.js --clear              # 寫入前先清空該 collection
 */

"use strict";

const path = require("path");
const admin = require("firebase-admin");
const { google } = require("googleapis");

// ============================================================================
// 設定
// ============================================================================

const CONFIG = {
  // 複製自正式 Sheets 的副本 ID
  spreadsheetId: process.env.TEST_SPREADSHEET_ID,

  // Firebase 服務帳號金鑰路徑（Firebase Console → 專案設定 → 服務帳戶 → 產生新私密金鑰）
  serviceAccountKey:
    process.env.SERVICE_ACCOUNT_KEY ||
    path.resolve(__dirname, "serviceAccountKey.json"),

  // Sheet 名稱對應（與 GS/Constants.gs 同步）
  sheets: {
    EMPLOYEES: "員工名單",
    ATTENDANCE: "打卡紀錄",
    LOCATIONS: "打卡地點表",
  },
};

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const shouldClear = args.includes("--clear");
const onlyArg = args.find((a) => a.startsWith("--only="));
const onlyTarget = onlyArg ? onlyArg.split("=")[1] : null;

// ============================================================================
// 工具
// ============================================================================

function log(msg) {
  console.log(msg);
}
function warn(msg) {
  console.warn(`⚠️  ${msg}`);
}
function err(msg) {
  console.error(`❌ ${msg}`);
}

function requirePreconditions() {
  if (!CONFIG.spreadsheetId) {
    err("缺少環境變數 TEST_SPREADSHEET_ID（複製副本的 Sheet ID）");
    process.exit(1);
  }
  try {
    require(CONFIG.serviceAccountKey);
  } catch (e) {
    err(`找不到服務帳號金鑰：${CONFIG.serviceAccountKey}`);
    err("請從 Firebase Console → 專案設定 → 服務帳戶 → 產生新私密金鑰");
    err("並放到 scripts/serviceAccountKey.json（已 gitignore）");
    process.exit(1);
  }
}

/**
 * 將 Google Sheets 回傳的 cell 值轉為適合 Firestore 的型別
 * - 空字串 → ""
 * - 數字字串但 header 已知是 number → Number()
 * - ISO 日期字串或含時間的日期 → Timestamp
 */
function toFirestoreTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return admin.firestore.Timestamp.fromDate(value);
  const d = new Date(value);
  if (!isNaN(d.getTime())) return admin.firestore.Timestamp.fromDate(d);
  return null;
}

// ============================================================================
// Sheet 讀取
// ============================================================================

async function initGoogleSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CONFIG.serviceAccountKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function readSheet(sheets, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.spreadsheetId,
    range: sheetName,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  return res.data.values || [];
}

// ============================================================================
// 批次寫入 Firestore（避免單次 > 500 限制）
// ============================================================================

async function writeBatch(db, collection, docs, clearFirst) {
  if (clearFirst && !isDryRun) {
    log(`   🧹 清空 ${collection}...`);
    const snap = await db.collection(collection).get();
    while (!snap.empty) {
      const batch = db.batch();
      snap.docs.slice(0, 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
      break; // 單次足夠，若資料很多可改為迴圈
    }
  }

  if (isDryRun) {
    log(`   📋 [dry-run] 將寫入 ${docs.length} 筆至 ${collection}`);
    if (docs.length > 0) {
      log(`   📄 第 1 筆範例：${JSON.stringify(docs[0].data, null, 2).substring(0, 400)}`);
    }
    return docs.length;
  }

  let written = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const chunk = docs.slice(i, i + 400);
    const batch = db.batch();
    chunk.forEach(({ id, data }) => {
      const ref = id
        ? db.collection(collection).doc(String(id))
        : db.collection(collection).doc();
      batch.set(ref, data);
    });
    await batch.commit();
    written += chunk.length;
    log(`   ✓ 已寫入 ${written} / ${docs.length}`);
  }
  return written;
}

// ============================================================================
// 遷移：員工名單
// ============================================================================

/**
 * GS/DbOperations.gs writeEmployee_ 定義的欄位順序：
 *   userId, email, name, picture, firstLoginTime, dept, salary,
 *   leaveInsurance, healthInsurance, housingExpense, status,
 *   preferredLanguage, lastLoginTime
 */
async function migrateEmployees(sheets, db) {
  log("\n📥 員工名單 → employees");
  const rows = await readSheet(sheets, CONFIG.sheets.EMPLOYEES);
  if (rows.length < 2) {
    warn("沒有員工資料（或只有 header）");
    return 0;
  }
  // 跳過 header
  const dataRows = rows.slice(1);
  const docs = dataRows
    .filter((r) => r[0])
    .map((r) => ({
      id: String(r[0]).trim(),
      data: {
        userId: String(r[0] || "").trim(),
        email: String(r[1] || "").trim(),
        name: String(r[2] || "").trim(),
        picture: String(r[3] || "").trim(),
        firstLoginTime: toFirestoreTimestamp(r[4]),
        dept: String(r[5] || "").trim(),
        salary: Number(r[6] || 0),
        leaveInsurance: String(r[7] || "第2級").trim(),
        healthInsurance: String(r[8] || "第2級").trim(),
        housingExpense: Number(r[9] || 1000),
        status: String(r[10] || "啟用").trim(),
        preferredLanguage: String(r[11] || "").trim(),
        lastLoginTime: toFirestoreTimestamp(r[12]),
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    }));
  return writeBatch(db, "employees", docs, shouldClear);
}

// ============================================================================
// 遷移：打卡紀錄
// ============================================================================

/**
 * GS punch 寫入格式：
 *   [ new Date(), userId, dept, name, type, `(lat,lng)`, locationName,
 *     adjustmentType, audit, note ]
 */
async function migrateAttendance(sheets, db) {
  log("\n📥 打卡紀錄 → attendance");
  const rows = await readSheet(sheets, CONFIG.sheets.ATTENDANCE);
  if (rows.length < 2) {
    warn("沒有打卡資料（或只有 header）");
    return 0;
  }
  const dataRows = rows.slice(1);
  const docs = dataRows
    .filter((r) => r[0] && r[1]) // 需有日期與 userId
    .map((r, idx) => {
      const timestamp = toFirestoreTimestamp(r[0]);
      const userId = String(r[1] || "").trim();
      const coords = String(r[5] || "").trim(); // 格式: (lat,lng) 或 "申請時間: ..." 或 "無定位"
      const coordsMatch = coords.match(/^\(([\d.\-]+),([\d.\-]+)\)$/);

      // 用 userId + timestamp(ms) 作為 doc id 以避免重複
      const tsMs = timestamp ? timestamp.toMillis() : Date.now() + idx;
      const id = `${userId}_${tsMs}_${idx}`;

      return {
        id,
        data: {
          timestamp,
          userId,
          dept: String(r[2] || "").trim(),
          name: String(r[3] || "").trim(),
          type: String(r[4] || "").trim(),
          coords,
          lat: coordsMatch ? Number(coordsMatch[1]) : null,
          lng: coordsMatch ? Number(coordsMatch[2]) : null,
          locationName: String(r[6] || "").trim(),
          adjustmentType: String(r[7] || "").trim(), // 補打卡 / 系統請假記錄
          audit: String(r[8] || "").trim(), // ? / v / x
          note: String(r[9] || "").trim(),
          migratedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      };
    });
  return writeBatch(db, "attendance", docs, shouldClear);
}

// ============================================================================
// 遷移：打卡地點表
// ============================================================================

/**
 * GS getLocationsCached 使用欄位：
 *   row[1]=name, row[2]=lat, row[3]=lng, row[4]=radius（row[0] 是 ID）
 */
async function migrateLocations(sheets, db) {
  log("\n📥 打卡地點 → locations");
  const rows = await readSheet(sheets, CONFIG.sheets.LOCATIONS);
  if (rows.length < 2) {
    warn("沒有地點資料（或只有 header）");
    return 0;
  }
  const dataRows = rows.slice(1);
  const docs = dataRows
    .filter((r) => r[1]) // 需有地點名稱
    .map((r, idx) => {
      const lat = Number(r[2]);
      const lng = Number(r[3]);
      if (isNaN(lat) || isNaN(lng)) return null;
      return {
        id: String(r[0] || "").trim() || `loc_${idx + 1}`,
        data: {
          name: String(r[1] || "").trim(),
          lat,
          lng,
          radius: Number(r[4] || 100),
          migratedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      };
    })
    .filter(Boolean);
  return writeBatch(db, "locations", docs, shouldClear);
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  log("🚀 Firestore 資料遷移" + (isDryRun ? "（乾跑模式）" : ""));
  log("=====================================================");
  requirePreconditions();

  log(`📋 來源 Sheet ID: ${CONFIG.spreadsheetId}`);
  log(`🔑 服務帳號: ${CONFIG.serviceAccountKey}`);
  log(`🎯 模式: ${isDryRun ? "dry-run（不寫入）" : "正式執行"}${shouldClear ? "（先清空）" : ""}`);
  if (onlyTarget) log(`🎚️  僅遷移: ${onlyTarget}`);
  log("");

  // 初始化 Firebase Admin
  admin.initializeApp({
    credential: admin.credential.cert(require(CONFIG.serviceAccountKey)),
  });
  const db = admin.firestore();

  // 初始化 Sheets API
  const sheets = await initGoogleSheets();

  const runners = {
    employees: () => migrateEmployees(sheets, db),
    attendance: () => migrateAttendance(sheets, db),
    locations: () => migrateLocations(sheets, db),
  };

  const targets = onlyTarget ? [onlyTarget] : Object.keys(runners);
  const results = {};

  for (const t of targets) {
    if (!runners[t]) {
      warn(`未知遷移目標：${t}（可選：${Object.keys(runners).join(", ")}）`);
      continue;
    }
    try {
      results[t] = await runners[t]();
    } catch (e) {
      err(`遷移 ${t} 失敗：${e?.message || e}`);
      results[t] = `FAILED: ${e?.message}`;
    }
  }

  log("\n=====================================================");
  log("📊 遷移結果：");
  for (const [t, count] of Object.entries(results)) {
    log(`   ${t}: ${count}`);
  }
  if (isDryRun) {
    log("\n💡 乾跑模式未實際寫入，確認資料無誤後移除 --dry-run 正式執行。");
  }
  log("✅ 完成");
}

main().catch((e) => {
  err(`腳本崩潰：${e?.stack || e?.message || e}`);
  process.exit(1);
});
