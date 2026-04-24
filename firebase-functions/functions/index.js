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

// ===== 打卡核心 =====
exports.punch = require("./src/punch");
exports.getLocations = require("./src/getLocations");

// ===== 待實作（下一輪） =====
// exports.punchWithoutLocation = require("./src/punchWithoutLocation");
// exports.adjustPunch = require("./src/adjustPunch");
// exports.getCalendarSummary = require("./src/getCalendarSummary");
// exports.getAttendanceDetails = require("./src/getAttendanceDetails");
// exports.getCompleteAttendanceRecords = require("./src/getCompleteAttendanceRecords");
// exports.getAbnormalRecords = require("./src/getAbnormalRecords");
// exports.getEmployeeList = require("./src/getEmployeeList");
// exports.addLocation = require("./src/addLocation");
// exports.submitLeave = require("./src/submitLeave");
// exports.getReviewRequest = require("./src/getReviewRequest");
// exports.approveReview = require("./src/approveReview");
// exports.rejectReview = require("./src/rejectReview");
// exports.testNotification = require("./src/testNotification");
