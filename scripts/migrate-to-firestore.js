#!/usr/bin/env node
/**
 * Google Sheets → Firestore 資料遷移腳本（雛形）
 *
 * ⚠️ 執行前必讀：
 *   1. 本腳本會「讀取 Google Sheets + 寫入 Firestore」
 *   2. 請「先複製一份正式 Sheets 為測試版」後，針對測試 Sheets 執行
 *   3. Firestore 請使用「測試專案」（不要用正式專案）
 *   4. 沒有測試環境時請勿執行本腳本
 *
 * 前置：
 *   npm install firebase-admin googleapis
 *   將 serviceAccountKey.json 放於專案根（已加入 .gitignore）
 *
 * 使用：
 *   node scripts/migrate-to-firestore.js --dry-run    # 乾跑，不寫入
 *   node scripts/migrate-to-firestore.js              # 實際執行
 */

"use strict";

// ============================================================================
// 設定區（請先修改）
// ============================================================================

const CONFIG = {
  // 測試用 Google Sheet ID（複製正式 Sheet 後取得）
  spreadsheetId: process.env.TEST_SPREADSHEET_ID || "REPLACE_WITH_TEST_SHEET_ID",

  // 服務帳號金鑰路徑（Firebase Console → 專案設定 → 服務帳戶）
  serviceAccountKey: process.env.SERVICE_ACCOUNT_KEY || "./serviceAccountKey.json",

  // Sheet 名稱 → Firestore collection 對照
  mapping: {
    "員工清單": { collection: "employees", idField: "userId" },
    "打卡紀錄": { collection: "attendance", idStrategy: "userId_timestamp" },
    "地點": { collection: "locations", idField: "id" },
    // "會話": { collection: "sessions", idField: "sessionToken" }, // 會話通常不遷移
    // "待審核": { collection: "reviewRequests", idStrategy: "uuid" },
  },
};

// ============================================================================
// 實作（骨架，尚未完成）
// ============================================================================

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`🚀 Firestore 資料遷移腳本${isDryRun ? "（乾跑模式）" : ""}`);
  console.log("");

  // 檢查前置
  if (CONFIG.spreadsheetId === "REPLACE_WITH_TEST_SHEET_ID") {
    console.error("❌ 請先設定 CONFIG.spreadsheetId 或環境變數 TEST_SPREADSHEET_ID");
    process.exit(1);
  }

  // TODO: 實際啟動時解除註解
  // const admin = require("firebase-admin");
  // const { google } = require("googleapis");
  //
  // admin.initializeApp({
  //   credential: admin.credential.cert(require(CONFIG.serviceAccountKey)),
  // });
  // const db = admin.firestore();
  //
  // const auth = new google.auth.GoogleAuth({
  //   keyFile: CONFIG.serviceAccountKey,
  //   scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  // });
  // const sheets = google.sheets({ version: "v4", auth });
  //
  // for (const [sheetName, spec] of Object.entries(CONFIG.mapping)) {
  //   await migrateSheet(sheets, db, sheetName, spec, isDryRun);
  // }

  console.log("🚧 本腳本目前為骨架（尚未實作 SDK 呼叫）");
  console.log("   實作步驟見 docs/architecture/Firestore遷移計劃.md Phase 2");
  console.log("");
  console.log("建議流程：");
  console.log("  1. 建立 Firebase 測試專案");
  console.log("  2. 下載服務帳號金鑰放到專案根（檔名 serviceAccountKey.json）");
  console.log("  3. 複製一份正式 Sheet 作為測試來源");
  console.log("  4. 設定 TEST_SPREADSHEET_ID 環境變數");
  console.log("  5. 解除本腳本中 TODO 註解並完成實作");
  console.log("  6. --dry-run 驗證資料結構 → 正式跑");
}

main().catch((err) => {
  console.error("❌ 遷移失敗：", err);
  process.exit(1);
});
