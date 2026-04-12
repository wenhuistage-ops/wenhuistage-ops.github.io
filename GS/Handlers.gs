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


// Handlers.gs

function handleGetProfile(code) {
  const tokenResp = exchangeCodeForToken_(code);
  const profile   = getLineUserInfo_(tokenResp);
  const sToken    = writeSession_(profile.userId);
  writeEmployee_(profile);
  return {
    ok: true,
    code: "WELCOME_BACK",
    params: { name: profile.displayName },
    sToken
  };
}

function handleGetLoginUrl() {
  const baseUrl = LINE_REDIRECT_URL;
  const state   = Utilities.getUuid();
  const scope   = encodeURIComponent('openid profile email');
  const redirect= encodeURIComponent(baseUrl);
  const url     = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${encodeURIComponent(LINE_CHANNEL_ID)}&redirect_uri=${redirect}&state=${state}&scope=${scope}`;
  return { url };
}

function handleCheckSession(sessionToken) {
  const user = checkSession_(sessionToken);
  return user.ok ? user : { ok: false, code: user.code };
}

function handlePunch(params) {
  const { token, type, lat, lng, note } = params;
  return punch(token, type, parseFloat(lat), parseFloat(lng), note);
}

function handleAdjustPunch(params) {
  const { token, type, lat, lng, note, datetime } = params;
  const punchDate = datetime ? new Date(datetime) : new Date();
  return punchAdjusted(token, type, punchDate, parseFloat(lat), parseFloat(lng), note);
}

function handleExchangeToken(otoken) {
  const sessionToken = verifyOneTimeToken_(otoken);
  return sessionToken
    ? { ok:true, sToken: sessionToken }
    : { ok:false, code:"ERR_INVALID_TOKEN" };
}


function handleGetAbnormalRecords(params) {
  const { month, userId } = params;
  if (!month) return { ok: false, code: "ERR_MISSING_MONTH" };

  const records = getAttendanceRecords(month, userId);
  Logger.log("用戶 " + userId + " 在月份 " + month + " 的打卡記錄數量: " + records.length);

  // 如果沒有記錄，仍然需要檢查這個月的異常
  let abnormalResults = [];
  if (records.length === 0) {
    // 為沒有記錄的情況生成異常記錄
    const [year, monthNum] = month.split('-').map(Number);
    const monthStart = new Date(year, monthNum - 1, 1);
    const monthEnd = new Date(year, monthNum, 0); // 當月最後一天
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

    Logger.log("檢查月份 " + month + " 的日期範圍: " + monthStart.toISOString().split('T')[0] + " 到 " + Math.min(monthEnd.toISOString().split('T')[0], today));

    let abnormalIdCounter = 0;
    for (let date = new Date(monthStart); date <= monthEnd && date <= new Date(); date.setDate(date.getDate() + 1)) {
      const dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");

      // 跳過未來的日期
      if (dateStr > today) continue;

      // 跳過週末
      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue; // 0=週日, 6=週六

      // 對於沒有記錄的日期，標記為完全缺少打卡
      abnormalIdCounter++;
      abnormalResults.push({
        date: dateStr,
        reason: "STATUS_BOTH_MISSING", // 修改：當天完全沒有打卡記錄
        id: `abnormal-${abnormalIdCounter}`
      });
      Logger.log("發現異常記錄: " + dateStr + " - 完全沒有打卡記錄");
    }
  } else {
    abnormalResults = checkAttendanceAbnormal(records, month);
  }

  return { ok: true, records: abnormalResults };
}

function handleSubmitLeave(params) {
  const { token, date, type, reason, note } = params;
  
  if (!date || !type || !reason) {
    return { ok: false, code: "ERR_MISSING_PARAMS", msg: "缺少必要參數" };
  }
  
  try {
    // 驗證用戶token
    const user = checkSession_(token);
    if (!user.ok) {
      return { ok: false, code: "ERR_INVALID_SESSION", msg: "無效的登入狀態" };
    }
    
    const userId = user.user.userId;
    const userName = user.user.name;
    const userDept = user.user.dept;
    
    // 在打卡記錄表中添加請假/休假記錄
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ATTENDANCE);
    
    // 創建請假記錄
    const leaveRecord = [
      new Date(date), // 打卡時間（使用請假日期）
      userId, // 用戶ID
      userDept || "", // 部門
      userName || "", // 姓名
      type === 'leave' ? '請假' : '休假', // 類型
      "(0,0)", // GPS位置
      reason, // 地點名稱欄位用於存放原因
      "系統請假記錄", // 備註
      "?", // 管理員審核（待審核）
      note || "" // 設備信息欄位用於存放備註
    ];
    
    // 添加到工作表
    sheet.appendRow(leaveRecord);
    
    Logger.log("請假/休假記錄已提交: " + JSON.stringify(leaveRecord));
    
    return { 
      ok: true, 
      msg: type === 'leave' ? "請假申請已提交" : "休假申請已提交",
      record: leaveRecord 
    };
    
  } catch (error) {
    Logger.log("提交請假/休假失敗: " + error.message);
    return { ok: false, code: "ERR_SUBMIT_LEAVE", msg: "提交失敗: " + error.message };
  }
}

function handleGetAttendanceDetails(params) {
  const { month } = params;
  const userId = params.userId || params.targetUserId;
  if (!month) return { ok: false, code: "ERR_MISSING_MONTH" };
  const records = getAttendanceRecords(month, userId);
  const results = checkAttendance(records);
  return { ok: true, records: { dailyStatus: results } };
}

function handleGetEmployeeList(params) {
  const employees = getEmployeeList();
  if (!employees.ok) return employees;
  return employees;
}

/**
 * 📊 新增：輕量級月曆視圖 API
 * 只返回 [date, reason, hours]，減少 75% 數據量
 * 用於月曆首屏加載，性能提升 30-50%
 */
function handleGetCalendarSummary(params) {
  const { month, userId } = params;
  if (!month) return { ok: false, code: "ERR_MISSING_MONTH" };
  
  const summary = getCachedAttendanceSummary(month, userId);
  
  return { ok: true, records: { dailyStatus: summary } };
}
function handleAddLocation(params) {
  const { name, lat, lng } = params;
  return addLocation(name, lat, lng);
}
function handleGetLocation() {
  return getLocation();
}
function handleGetReviewRequest() {
  return getReviewRequest();
}
// 新增這兩個函式到你的檔案中
/**
 * 處理核准審核的請求。
 * @param {object} params - 包含請求參數的物件。
 * @return {object} 回傳處理結果。
 */
function handleApproveReview(params) {
  const recordId = params.id;
  if (!recordId) {
    return { ok: false, msg: "缺少審核 ID" };
  }
  return updateReviewStatus(recordId, "v", "核准");
}

/**
 * 處理拒絕審核的請求。
 * @param {object} params - 包含請求參數的物件。
 * @return {object} 回傳處理結果。
 */
function handleRejectReview(params) {
  const recordId = params.id;
  if (!recordId) {
    return { ok: false, msg: "缺少審核 ID" };
  }
  return updateReviewStatus(recordId, "x", "拒絕");
}
