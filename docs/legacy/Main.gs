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


// Main.gs

// 從其他模組匯入函式
// 這裡沒有 ES6 模組匯入，但我們可以用註解來表示程式碼的來源
// 實際開發中，GAS 專案會自動將所有 .gs 檔視為同一專案

// ✅ 改進 2.1：統一的請求處理函數（支持 GET 和 POST）
// 注意：推薦使用 POST 以避免 token 在 URL 中洩露
function handleRequest(e) {
  const action       = e.parameter.action;
  const callback     = e.parameter.callback || null;
  const sessionToken = e.parameter.token;  // ✅ 支持 URL 參數或 POST body
  const code         = e.parameter.otoken;

  function respond(obj) {
    const json = JSON.stringify(obj);
    if (callback) {
      return ContentService.createTextOutput(
        `${callback}(${json})`
      ).setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    const output = ContentService.createTextOutput(json);
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
  function respond1(obj) {
    const output = ContentService.createTextOutput(JSON.stringify(obj));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
  try {
    switch (action) {
      case "getProfile":
        return respond(handleGetProfile(code, e.parameter.redirectUrl));
      case "getLoginUrl":
        return respond(handleGetLoginUrl(e.parameter));
      case "checkSession":
        return respond(handleCheckSession(sessionToken));
      case "punch":
        return respond(handlePunch(e.parameter));
      case "punchWithoutLocation":
        return respond(handlePunchWithoutLocation(e.parameter));
      case "adjustPunch":
        return respond(handleAdjustPunch(e.parameter));
      case "exchangeToken":
        return respond(handleExchangeToken(e.parameter.otoken));
      case "getAbnormalRecords":
        return respond(handleGetAbnormalRecords(e.parameter));
      case "submitLeave":
        return respond(handleSubmitLeave(e.parameter));
      case "getAttendanceDetails":
        return respond(handleGetAttendanceDetails(e.parameter));
      case "getCompleteAttendanceRecords":
        return respond(handleGetCompleteAttendanceRecords(e.parameter));
      case "getEmployeeList":
        return respond(handleGetEmployeeList(e.parameter));
      case "getCalendarSummary":
        return respond(handleGetCalendarSummary(e.parameter));
      case "addLocation":
        return respond(handleAddLocation(e.parameter));
      case "getLocations":
        return respond(handleGetLocation());
      case "getReviewRequest":
        return respond(handleGetReviewRequest());
      case "approveReview":
        return respond(handleApproveReview(e.parameter));
      case "rejectReview":
        return respond(handleRejectReview(e.parameter));
      case "testEndpoint": // 新增一個測試用的 action
        return respond({ ok: true, msg: "CORS 測試成功!" });
      case "testNotification": // 測試通知功能
        return respond(handleTestNotification(e.parameter));
      default:
        return HtmlService.createHtmlOutputFromFile('index')
               .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  } catch (err) {
    return respond({ ok: false, msg: err.message });
  }
}

// ✅ 改進 2.1：支持 GET 請求（向後相容）
function doGet(e) {
  return handleRequest(e);
}

// ✅ 改進 2.1：支持 POST 請求（推薦使用，token 不在 URL 中）
function doPost(e) {
  return handleRequest(e);
}
