/**
 * Cloud Functions 主入口
 *
 * 每個 action 拆為獨立檔案（src/<action>.js），此檔只負責 exports。
 * 新增 action 時於下方 exports 一行即可。
 *
 * 部署指令：
 *   cd firebase-functions && firebase deploy --only functions
 */

"use strict";

// ===== 身份與 session =====
exports.checkSession = require("./src/checkSession");
exports.getLoginUrl = require("./src/getLoginUrl");
exports.getProfile = require("./src/getProfile");
exports.exchangeToken = require("./src/exchangeToken");

// ===== 打卡寫入 =====
exports.punch = require("./src/punch");
exports.punchWithoutLocation = require("./src/punchWithoutLocation");
exports.adjustPunch = require("./src/adjustPunch");

// ===== 打卡查詢 =====
exports.getLocations = require("./src/getLocations");
exports.getCalendarSummary = require("./src/getCalendarSummary");
exports.getAttendanceDetails = require("./src/getAttendanceDetails");
exports.getCompleteAttendanceRecords = require("./src/getCompleteAttendanceRecords");
exports.getAbnormalRecords = require("./src/getAbnormalRecords");

// ===== 管理員 =====
exports.getEmployeeList = require("./src/getEmployeeList");
exports.addLocation = require("./src/addLocation");

// ===== 請假與審核 =====
exports.submitLeave = require("./src/submitLeave");
exports.getReviewRequest = require("./src/getReviewRequest");
exports.approveReview = require("./src/approveReview");
exports.rejectReview = require("./src/rejectReview");

// ===== 通知測試 =====
exports.testNotification = require("./src/testNotification");

// ===== 公司設定 =====
exports.getBreakTimes = require("./src/getBreakTimes");
exports.setBreakTimes = require("./src/setBreakTimes");

// ===== 員工薪資與勞保（管理員專用） =====
exports.setEmployeeSalaryProfile = require("./src/setEmployeeSalaryProfile");

// ===== 員工帳號狀態切換（管理員專用） =====
exports.setEmployeeStatus = require("./src/setEmployeeStatus");
