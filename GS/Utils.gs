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


// Utils.gs

function jsonp(e, obj) {
  const cb = e.parameter.callback || "callback";
  return ContentService.createTextOutput(cb + "(" + JSON.stringify(obj) + ")")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// 距離計算公式
function getDistanceMeters_(lat1, lng1, lat2, lng2) {
  function toRad(deg) { return deg * Math.PI / 180; }
  const R = 6371000; // 地球半徑 (公尺)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/**
 * 檢查員工每天的打卡異常狀態，並回傳格式化的異常列表
 * @param {Array} attendanceRows 打卡紀錄，每筆包含：
 * [打卡時間, 員工ID, 薪資, 員工姓名, 上下班, GPS位置, 地點, 備註, 使用裝置詳細訊息]
 * @returns {Array} 每天每位員工的異常結果，格式為 { date: string, reason: string, id: string } 的陣列
 */
function checkAttendanceAbnormal(attendanceRows) {
  const dailyRecords = {}; // 按 userId+date 分組
  const abnormalRecords = []; // 新增：用於儲存格式化的異常紀錄
  let abnormalIdCounter = 0; // 新增：用於產生唯一的 id
  
  Logger.log("checkAttendanceAbnormal開始");
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  attendanceRows.forEach(row => {
    try {
      const date = getYmdFromRow(row);
      const userId = row.userId;
        // 🚫 跳過今天的資料
      if (date === today) return;
      if (!dailyRecords[userId]) dailyRecords[userId] = {};
      if (!dailyRecords[userId][date]) dailyRecords[userId][date] = [];
      dailyRecords[userId][date].push(row);

    } catch (err) {
      Logger.log("❌ 解析 row 失敗: " + JSON.stringify(row) + " | 錯誤: " + err.message);
    }
  });

  for (const userId in dailyRecords) {
    for (const date in dailyRecords[userId]) {
      const rows = dailyRecords[userId][date];

      // 過濾系統虛擬卡
      const filteredRows = rows.filter(r => r.notes !== "系統虛擬卡");
      const types = filteredRows.map(r => r.type);
      const notes = filteredRows.map(r => r.note);
      const audits =filteredRows.map(r => r.audit);

      let reason = "";
      if (types.length === 0) {
        reason = "未打上班卡, 未打下班卡";
      } else if (types.every(t => t === "上班")) {
        reason = "未打下班卡";
      } else if (types.every(t => t === "下班")) {
        reason = "未打上班卡";
      }else if (notes.every(t => t === "補卡")) {
        reason = "補卡(審核中)";
      }else if (audits.every(t => t === "v")) {
        reason = "補卡通過";
      }

      if (reason) {
        abnormalIdCounter++;
        abnormalRecords.push({
          date: date,
          reason: reason,
          id: `abnormal-${abnormalIdCounter}`
        });
      }
    }
  }

  Logger.log("checkAttendanceAbnormal debug: %s", JSON.stringify(abnormalRecords));
  return abnormalRecords;
}

function checkAttendance(attendanceRows) {
  const dailyRecords = {}; // 按 userId+date 分組
  const dailyStatus = []; // 用於儲存格式化的異常紀錄
  let abnormalIdCounter = 0; // 用於產生唯一的 id
  
  // 輔助函式：從時間戳記中擷取 'YYYY-MM-DD'
  function getYmdFromRow(row) {
    if (row.date) {
      const d = new Date(row.date);
      return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
    }
    return '';
  }

  // 輔助函式：從時間戳記中擷取 'HH:mm'
  function getHhMmFromRow(row) {
    if (row.date) {
      const d = new Date(row.date);
      return Utilities.formatDate(d, 'Asia/Taipei', 'HH:mm');
    }
    return '未知時間';
  }
  
  attendanceRows.forEach(row => {
    try {
      const date = getYmdFromRow(row);
      const userId = row.userId;
  
      if (!dailyRecords[userId]) dailyRecords[userId] = {};
      if (!dailyRecords[userId][date]) dailyRecords[userId][date] = [];
      dailyRecords[userId][date].push(row);

    } catch (err) {
      Logger.log("❌ 解析 row 失敗: " + JSON.stringify(row) + " | 錯誤: " + err.message);
    }
  });

  for (const userId in dailyRecords) {
    for (const date in dailyRecords[userId]) {
      // 確保 rows 是一個陣列，即使原始資料不是
      const rows = dailyRecords[userId][date] || [];

    // 過濾系統虛擬卡
    const filteredRows = rows.filter(r => r.note !== "系統虛擬卡");

    const record = filteredRows.map(r => ({
      time: getHhMmFromRow(r),
      type: r.type || '未知類型',
      note: r.note || "",
      audit: r.audit || "",
      location: r.location || ""
    }));

    const types = record.map(r => r.type);
    const notes = record.map(r => r.note);
    const audits = record.map(r => r.audit);

      let reason = "";
      let id = "normal";

      // notes = 每筆打卡的 note
      // audits = 每筆打卡的 audit 狀態 (假設 "v" 代表通過)

      const hasAdjustment = notes.some(note => note === "補打卡");
      
      const approvedAdjustments = record.filter(r => r.note === "補打卡");
      const isAllApproved = approvedAdjustments.length > 0 &&
                      approvedAdjustments.every(r => r.audit === "v");


        // 計算成對數量
      const typeCounts = { 上班: 0, 下班: 0 };
      record.forEach(r => {
        if (r.type === "上班") typeCounts["上班"]++;
        else if (r.type === "下班") typeCounts["下班"]++;
      });

      // 只要至少有一對就算正常
      const hasPair = typeCounts["上班"] > 0 && typeCounts["下班"] > 0;

      if (!hasPair) {
        if (typeCounts["上班"] === 0 && typeCounts["下班"] === 0) {
          reason = "未打上班卡, 未打下班卡";
        } else if (typeCounts["上班"] > 0) {
          reason = "未打下班卡";
        } else if (typeCounts["下班"] > 0) {
          reason = "未打上班卡";
        }
      } else if (isAllApproved) {
        reason = "補卡通過";
      } else if (hasAdjustment) {
        reason = "有補卡(審核中)";
      }else{
        reason = "正常";
      }

      if (reason) {
        abnormalIdCounter++;
        id = `abnormal-${abnormalIdCounter}`;
      }

      dailyStatus.push({
        ok: !reason,
        date: date,
        record: record,
        reason: reason,
        id: id
      });
    }
  }

  Logger.log("checkAttendance debug: %s", JSON.stringify(dailyStatus));
  return dailyStatus;
}



// 工具函式：將日期格式化 yyyy-mm-dd
/** 取得 row 的 yyy-MM-dd（支援物件/陣列、字串/Date），以台北時區輸出 */
function getYmdFromRow(row) {
  const raw = (row && (row.date ?? row[0])) ?? null; // 物件 row.date 或 陣列 row[0]
  if (raw == null) return null;

  try {
    if (raw instanceof Date) {
      return Utilities.formatDate(raw, "Asia/Taipei", "yyyy-MM-dd");
    }
    const s = String(raw).trim();

    // 先嘗試用 Date 解析（支援 ISO 或一般日期字串）
    const d = new Date(s);
    if (!isNaN(d)) {
      return Utilities.formatDate(d, "Asia/Taipei", "yyyy-MM-dd");
    }

    // 再退而求其次處理 ISO 字串（有 T）
    if (s.includes("T")) return s.split("T")[0];

    return s; // 最後保底，讓外層去判斷是否為有效格式
  } catch (e) {
    return null;
  }
}

/** 取欄位：優先物件屬性，其次陣列索引 */
function pick(row, objKey, idx) {
  const v = row?.[objKey];
  return (v !== undefined && v !== null) ? v : row?.[idx];
}
