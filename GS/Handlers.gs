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
  const abnormalResults = checkAttendanceAbnormal(records);
  return { ok: true, records: abnormalResults };
}

function handleGetAttendanceDetails(params) {
  const { month, userId } = params;
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
  
  const records = getAttendanceRecords(month, userId);
  const summary = checkAttendanceCalendar(records);
  
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
