/**
 * 設定檔：集中管理常數，方便未來修改
 */
const CONFIG = {
  SHEET_NAME: '打卡紀錄',
  SHEET_EMPLOYEE: '員工名單',
  // 欄位名稱設定
  COL_USER_ID: '打卡人員ＩＤ',
  COL_TIME: '打卡時間',
  COL_TYPE: '打卡類別',
  // 打卡狀態關鍵字
  TYPE_IN: '上班',
  TYPE_OUT: '下班',
  // 虛擬卡設定
  VIRTUAL_NOTE_OUT: '系統自動新增虛擬下班卡（跨日前下班），待管理員審核',
  VIRTUAL_NOTE_IN: '系統自動新增虛擬上班卡（跨日後上班），待管理員審核',
  // 效能設定：只掃描最後 N 筆資料 (避免資料量大時卡死)
  SCAN_ROW_LIMIT: 3000
};

/**
 * 主函式：每日自動檢查並修補跨日班
 * 建議觸發時間：每日 04:00
 */
function dailyVirtualPunch() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    Logger.log(`❌ 錯誤：找不到 '${CONFIG.SHEET_NAME}' 工作表。`);
    return;
  }

  // --- 1. 效能優化：只讀取最後 N 筆資料 ---
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow <= 1) return; // 沒資料

  // 決定讀取的起始行數 (保留標題列)
  const startRow = Math.max(2, lastRow - CONFIG.SCAN_ROW_LIMIT);
  const numRows = lastRow - startRow + 1;

  // 讀取標題 (永遠是第1列) 以確認欄位位置
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idxUserId = headers.indexOf(CONFIG.COL_USER_ID);
  const idxDate = headers.indexOf(CONFIG.COL_TIME);
  const idxType = headers.indexOf(CONFIG.COL_TYPE);

  if (idxUserId === -1 || idxDate === -1 || idxType === -1) {
    Logger.log("❌ 錯誤：找不到指定的欄位名稱，請檢查 CONFIG 設定或工作表標題。");
    return;
  }

  // 讀取資料區段
  const data = sheet.getRange(startRow, 1, numRows, lastCol).getValues();
  Logger.log(`📊 讀取範圍：第 ${startRow} 行至第 ${lastRow} 行 (共 ${data.length} 筆)`);

  // --- 2. 時間設定 ---
  const today = new Date();
  const yesterday = getDateOffset(today, -1);
  const dayBeforeYesterday = getDateOffset(today, -2);

  // 轉換為 timestamp (午夜 00:00:00) 方便比對
  const timeYesterday = yesterday.getTime();
  const timeDayBefore = dayBeforeYesterday.getTime();

  // --- 3. 資料整理 (Grouping) ---
  const userDailyRecords = {};

  data.forEach(row => {
    const punchTime = row[idxDate];
    if (!(punchTime instanceof Date)) return;

    // 取得該次打卡的「日期午夜時間」
    const punchDateOnly = new Date(punchTime.getFullYear(), punchTime.getMonth(), punchTime.getDate()).getTime();

    // 只關心「昨天」和「前天」
    if (punchDateOnly !== timeYesterday && punchDateOnly !== timeDayBefore) return;

    const userId = row[idxUserId];
    if (!userId) return;

    // 初始化結構
    if (!userDailyRecords[userId]) userDailyRecords[userId] = {};
    if (!userDailyRecords[userId][punchDateOnly]) {
      userDailyRecords[userId][punchDateOnly] = {
        hasPunchIn: false,
        hasPunchOut: false,
        punches: []
      };
    }

    const type = row[idxType];
    const record = userDailyRecords[userId][punchDateOnly];

    // 狀態標記
    if (type === CONFIG.TYPE_IN) record.hasPunchIn = true;
    if (type === CONFIG.TYPE_OUT) record.hasPunchOut = true;

    record.punches.push({ type: type, time: punchTime });
  });

  // --- 4. 邏輯判斷與補卡 ---
  let processCount = 0;

  for (const userId in userDailyRecords) {
    const recordDayBefore = userDailyRecords[userId][timeDayBefore];
    const recordYesterday = userDailyRecords[userId][timeYesterday];

    // 必須兩天都有資料才需要判斷跨日
    if (!recordDayBefore || !recordYesterday) continue;

    // === 關鍵修正：確保兩天的紀錄都按時間排序 ===
    // 只有排序後，我們才能確定哪一筆是「最後一筆」
    if (recordDayBefore.punches.length > 0) {
      recordDayBefore.punches.sort((a, b) => a.time - b.time);
    }
    if (recordYesterday.punches.length > 0) {
      recordYesterday.punches.sort((a, b) => a.time - b.time);
    }

    // === 修正後的判斷邏輯 ===

    // 條件 1：前一天的「最後一筆」打卡必須是「上班」
    // (這代表不管前面上了幾次班，只要最後沒打下班卡，就是跨夜或異常)
    const lastPunchDayBefore = recordDayBefore.punches[recordDayBefore.punches.length - 1];
    const condition1 = lastPunchDayBefore && lastPunchDayBefore.type === CONFIG.TYPE_IN;

    // 條件 2：昨天的「第一筆」打卡必須是「下班」
    // (這代表這是承接前一天的班次)
    const firstPunchYesterday = recordYesterday.punches[0];
    const condition2 = firstPunchYesterday && firstPunchYesterday.type === CONFIG.TYPE_OUT;

    // 檢查日誌 (方便除錯)
    // Logger.log(`ID: ${userId}, 前日最後:${lastPunchDayBefore?.type}, 昨日第一:${firstPunchYesterday?.type}`);

    if (condition1 && condition2) {
      Logger.log(`👉 發現跨日班員工 (雙班/單班通用判定)：${userId}`);

      const employee = findEmployeeByLineUserId_V(userId);
      // ... (以下程式碼與之前相同，無需更動) ...
      const userName = employee.ok ? employee.name : "未知/已停用";

      if (!employee.ok) {
        Logger.log(`   ⚠️ 跳過：員工狀態異常 (${employee.error})`);
        continue;
      }

      // 準備寫入資料
      // 1. 前天 23:59:59 下班
      const dateOut = new Date(timeDayBefore);
      dateOut.setHours(23, 59, 59, 999);

      // 2. 昨天 00:00:00 上班
      const dateIn = new Date(timeYesterday);
      dateIn.setHours(0, 0, 0, 0);

      const rowOut = [
        formatDate(dateOut), userId, "", userName, CONFIG.TYPE_OUT,
        "系統虛擬卡", "系統虛擬卡", CONFIG.VIRTUAL_NOTE_OUT, ""
      ];

      const rowIn = [
        formatDate(dateIn), userId, "", userName, CONFIG.TYPE_IN,
        "系統虛擬卡", "系統虛擬卡", CONFIG.VIRTUAL_NOTE_IN, ""
      ];

      sheet.appendRow(rowOut);
      sheet.appendRow(rowIn);

      Logger.log(`   ✅ 已為 ${userName} 自動補入兩筆虛擬跨日卡。`);
      processCount++;
    }
  }

  Logger.log(`🏁 執行結束。共處理了 ${processCount} 位員工的跨日紀錄。`);
}

/**
 * 工具函式：日期偏移 (去除時間，只留日期)
 */
function getDateOffset(baseDate, offsetDays) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + offsetDays);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()); // 回傳午夜時間物件
}

/**
 * 工具函式：格式化日期字串
 */
function formatDate(dateObj) {
  return Utilities.formatDate(dateObj, "Asia/Taipei", "yyyy/MM/dd HH:mm:ss");
}

/**
 * (維持原樣，但加上錯誤處理)
 * 輔助函式，用於在員工名單中尋找使用者。
 */
function findEmployeeByLineUserId_V(userId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_EMPLOYEE);
  if (!sh) return { ok: false, error: "找不到員工名單工作表" };

  const values = sh.getDataRange().getValues();
  // 從第 2 行開始 (跳過標題)
  for (let i = 1; i < values.length; i++) {
    // 轉字串並 Trim 防止空白導致比對失敗
    if (String(values[i][0]).trim() === String(userId).trim()) {
      const status = values[i][7] ? String(values[i][7]).trim() : "啟用";
      if (status !== '啟用') return { ok: false, error: "員工狀態非啟用" };

      return {
        ok: true,
        userId: values[i][0],
        email: values[i][1],
        name: values[i][2],
        picture: values[i][3],
        dept: values[i][5],
        status: status
      };
    }
  }
  return { ok: false, error: "名單中無此 ID" };
}