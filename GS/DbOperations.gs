/*
 * Copyright (C) 2025 0J (Lin Jie / 0rigin1856)
 *
 * This file is part of 0riginAttendance-System.
 *
 * 0riginAttendance-System is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * 0riginAttendance-System is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with 0riginAttendance-System.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Please credit "0J (Lin Jie / 0rigin1856)" when redistributing or modifying this project.
 */


// DbOperations.gs

function writeEmployee_(profile) {
  const sheet  = SpreadsheetApp.getActive().getSheetByName(SHEET_EMPLOYEES);
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === profile.userId) return values[i]; // 已存在
  }
  const row = [ profile.userId, profile.email, profile.displayName, profile.pictureUrl, new Date(), "", "", "未啟用" ];
  sheet.appendRow(row);
  return row;
}

function findEmployeeByLineUserId_(userId) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_EMPLOYEES);
  const values = sh.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === userId) {
      const status = values[i][7] ? String(values[i][7]).trim() : "啟用";
      if (status !== '啟用') return { ok: false, code: "ERR_ACCOUNT_DISABLED" };
      return {
        ok: true,
        userId: values[i][0],
        email: values[i][1],
        name: values[i][2],
        picture: values[i][3],
        dept: values[i][5],
        status
      };
    }
  }
  return { ok: false, code: "ERR_NO_DATA" };
}

function writeSession_(userId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_SESSION);

  const oneTimeToken = Utilities.getUuid();
  const now          = new Date();
  const expiredAt    = new Date(now.getTime() + SESSION_TTL_MS);

  // 🔍 直接找 userId 在 B 欄
  const range = sheet.getRange("B:B").createTextFinder(userId).findNext();

  if (range) {
    const row = range.getRow();

    // ⚡ 一次寫入 (A, C, D)
    sheet.getRange(row, 1, 1, 4).setValues([[oneTimeToken, userId, now, expiredAt]]);
  } else {
    // 沒找到 → 新增一列
    sheet.appendRow([oneTimeToken, userId, now, expiredAt]);
  }
  return oneTimeToken;
}

// 兌換一次性 token
function verifyOneTimeToken_(otoken) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_SESSION);

  // 🔍 直接找 token
  const range = sheet.getRange("A:A").createTextFinder(otoken).findNext();
  if (!range) return null;

  const row = range.getRow();
  const sessionToken = Utilities.getUuid();
  const now          = new Date();
  const expiredAt    = new Date(now.getTime() + SESSION_TTL_MS);

  // ⚡ 一次寫入三個欄位
  sheet.getRange(row, 1, 1, 3).setValues([[sessionToken, now, expiredAt]]);

  return sessionToken;
}

// 檢查 Session
function checkSession_(sessionToken) {
  if (!sessionToken) return { ok: false, code: "MISSING_SESSION_TOKEN " };

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_SESSION);
  if (!sh) return { ok: false, code: "SESSION_SHEET_NOT_FOUND" };

  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const [ token, userId, , expiredAt ] = values[i];
    if (token === sessionToken) {
      if (expiredAt && new Date() > new Date(expiredAt)) {
        return { ok: false, code: "ERR_SESSION_EXPIRED" };
      }
      const employee = findEmployeeByLineUserId_(userId);
      if (!employee.ok) {Logger.log("測試"+employee); return { ok: employee.ok ,code:employee.code };}
      return { ok: true, user: employee ,code:"WELCOME_BACK",params: { name: employee.name },};
    }
  }
  return { ok: false, code: "ERR_SESSION_INVALID" };
}

// 打卡功能
function punch(sessionToken, type, lat, lng, note) {
  const employee = checkSession_(sessionToken);
  const user     = employee.user;
  if (!user) return { ok: false, code: "ERR_SESSION_INVALID" };

  // === 讀取打卡地點 ===
  const shLoc = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LOCATIONS);
  const values = shLoc.getRange(2, 1, shLoc.getLastRow() - 1, 5).getValues();
  // ⚡ 只取有資料的範圍，避免整張表

  let locationName = null;
  for (let [ , name, locLat, locLng, radius ] of values) {
    const dist = getDistanceMeters_(lat, lng, Number(locLat), Number(locLng));
    if (dist <= Number(radius)) {
      locationName = name;
      break; // ✅ 找到第一個合法地點就停
    }
  }

  if (!locationName) {
    return { ok: false, code: "ERR_OUT_OF_RANGE" };
  }

  // === 寫入打卡紀錄 ===
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ATTENDANCE);
  const row = [
    new Date(),
    user.userId,
    user.dept,
    user.name,
    type,
    `(${lat},${lng})`,
    locationName,
    "",
    "",
    note || ""
  ];
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  // ⚡ 用 setValues() 取代 appendRow()

  return { ok: true, code: `PUNCH_SUCCESS`,params: { type: type }, };
}


// 補打卡功能
function punchAdjusted(sessionToken, type, punchDate, lat, lng, note) {
  const employee = checkSession_(sessionToken);
  const user     = employee.user;
  if (!user) return { ok: false, code: "ERR_SESSION_INVALID" };

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ATTENDANCE);
  sh.appendRow([
    punchDate,              // 使用者指定時間
    user.userId,
    user.dept,
    user.name,
    type,
    `(${lat},${lng})`,
    "",                     // locationName 補打卡不填
    "補打卡",
    "?",
    note
  ]);

  return { ok: true, code: `ADJUST_PUNCH_SUCCESS`,params: { type: type } };
}

function getAttendanceRecords(monthParam, userIdParam) {
    // 從 `getAbnormalRecords` 案例中提取的邏輯
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ATTENDANCE);
    const values = sheet.getDataRange().getValues().slice(1);
    
    // 過濾本月資料，若有 userId 則只取該使用者
    return values.filter(row => {
      const d = new Date(row[0]);
      const yyyy_mm = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0");
      const monthMatch = yyyy_mm === monthParam;
      const userMatch  = userIdParam ? row[1] === userIdParam : true;
      return monthMatch && userMatch;
    }).map(r => ({
      date: r[0],
      userId: r[1],
      salary: r[2],
      name: r[3],
      type: r[4],
      gps: r[5],
      location: r[6],
      note: r[7],
      audit: r[8],
      device: r[9]
    }));
}
// 加入地點
function addLocation( name, lat, lng) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_LOCATIONS);
  sh.appendRow([
    "",              // 使用者指定時間
    name,
    lat,
    lng,
    "100"
  ]);
  return { ok: true, code: `新增地點成功` };
}
// 取地點
function getLocation() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LOCATIONS);
    const values = sheet.getDataRange().getValues();
    const headers = values.shift(); // 取得標頭並移除
    const locations = values.map(row => {
        return {
            id: row[headers.indexOf('ID')],
            name: row[headers.indexOf('地點名稱')],
            lat: row[headers.indexOf('GPS(緯度)')],
            lng: row[headers.indexOf('GPS(經度)')],
            scope:row[headers.indexOf('容許誤差(公尺)')]
        };
    });
    
    return { ok: true, locations: locations };
}
//取得審核請求
function getReviewRequest() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ATTENDANCE);
    const values = sheet.getDataRange().getValues();
    const headers = values[0]; // 取得標頭列

    const reviewRequest = values.filter((row, index) => {
        // 跳過標頭列
        if (index === 0) return false;

        const _remarkMatch = row[headers.indexOf('備註')] === "補打卡";
        const _administratorReviewIsPending = row[headers.indexOf('管理員審核')] === "?";
        
        return _remarkMatch && _administratorReviewIsPending;
    }).map(row => {
        const actualRowNumber = values.indexOf(row) + 1; // 取得原始陣列中的索引並轉換為行號
        return {
            id: actualRowNumber,
            name: row[headers.indexOf('打卡人員')],
            type: row[headers.indexOf('打卡類別')],
            remark: row[headers.indexOf('備註')],
            applicationPeriod: row[headers.indexOf('打卡時間')]
        };
    });
    
    Logger.log("getReviewRequest: " + JSON.stringify(reviewRequest));
    return { ok: true, reviewRequest: reviewRequest };
}
/**
 * 更新試算表中的審核狀態。
 * @param {number} rowNumber - 記錄所在的試算表行號。
 * @param {string} status - 審核狀態（例如："v" 或 "x"）。
 * @param {string} note - 審核備註。
 * @return {object} 回傳成功或失敗的訊息。
 */
function updateReviewStatus(rowNumber, status, note) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ATTENDANCE);
    // 取得標頭以找到正確的欄位索引
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const reviewStatusCol = headers.indexOf('管理員審核') + 1;
    //const reviewNoteCol = headers.indexOf('審核備註') + 1;

    if (reviewStatusCol === 0) {
      return { ok: false, msg: "試算表缺少必要欄位：'管理員審核' 或 '審核備註'" };
    }

    // 更新管理員審核與審核備註欄位
    sheet.getRange(rowNumber, reviewStatusCol).setValue(status);
    //sheet.getRange(rowNumber, reviewNoteCol).setValue(note);

    return { ok: true, msg: "審核成功" };
  } catch (err) {
    return { ok: false, msg: `審核失敗：${err.message}` };
  }
}
