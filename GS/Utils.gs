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
  
  // 第一遍：分組並預計算計數器
  attendanceRows.forEach(row => {
    try {
      const date = getYmdFromRow(row);
      const userId = row.userId;
  
      if (!dailyRecords[userId]) dailyRecords[userId] = {};
      if (!dailyRecords[userId][date]) {
        dailyRecords[userId][date] = {
          punchInCount: 0,
          punchOutCount: 0,
          records: []
        };
      }
      dailyRecords[userId][date].records.push(row);

    } catch (err) {
      Logger.log("❌ 解析 row 失敗: " + JSON.stringify(row) + " | 錯誤: " + err.message);
    }
  });

  // 第二遍：判斷狀態（使用預計算）
  for (const userId in dailyRecords) {
    for (const date in dailyRecords[userId]) {
      // 確保 rows 是一個陣列，即使原始資料不是
      const rows = dailyRecords[userId][date].records || [];

      // 過濾系統虛擬卡
      const filteredRows = rows.filter(r => r.note !== "系統虛擬卡");

      const record = filteredRows.map(r => ({
        time: getHhMmFromRow(r),
        type: r.type || '未知類型',
        note: r.note || "",
        audit: r.audit || "",
        location: r.location || ""
      }));

      // 確保 record 總是一個數組
      const safeRecord = Array.isArray(record) ? record : [];

      // ✅ 優化：預計算計數器而不是使用 every/some
      let punchInCount = 0;
      let punchOutCount = 0;
      let hasAdjustment = false;
      let approvedAdjustmentCount = 0;
      let totalAdjustments = 0;
      
      record.forEach(r => {
        if (r.type === "上班") punchInCount++;
        if (r.type === "下班") punchOutCount++;
        if (r.note === "補打卡") {
          hasAdjustment = true;
          totalAdjustments++;
          if (r.audit === "v") approvedAdjustmentCount++;
        }
      });

      let reason = "";
      let id = "normal";

      // 使用預計算的計數器進行判斷
      const hasPair = punchInCount > 0 && punchOutCount > 0;
      const isAllApproved = totalAdjustments > 0 && approvedAdjustmentCount === totalAdjustments;

      if (!hasPair) {
        if (punchInCount === 0 && punchOutCount === 0) {
          reason = "STATUS_PUNCH_IN_MISSING";
        } else if (punchInCount > 0) {
          reason = "STATUS_PUNCH_OUT_MISSING";
        } else {
          reason = "STATUS_PUNCH_IN_MISSING";
        }
      } else if (isAllApproved) {
        reason = "STATUS_REPAIR_APPROVED";
      } else if (hasAdjustment) {
        reason = "STATUS_REPAIR_PENDING";
      } else {
        reason = "STATUS_PUNCH_NORMAL";
      }

      if (reason) {
        abnormalIdCounter++;
        id = `abnormal-${abnormalIdCounter}`;
      }

      dailyStatus.push({
        ok: !reason,
        date: date,
        record: safeRecord,
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

/**
 * 📊 優化版：月曆視圖專用簡化函數
 * 只返回日期、狀態、工時三項資訊，減少 75% 數據量
 * @param {Array} attendanceRows 打卡紀錄陣列
 * @returns {Array} 簡化後的日曆資料 [ {date, reason, hours}, ... ]
 */
function checkAttendanceCalendar(attendanceRows) {
  const dailyRecords = {}; // 按 userId+date 分組
  
  // 第一遍：分組並預計算
  attendanceRows.forEach(row => {
    try {
      const date = getYmdFromRow(row);
      const userId = row.userId;
      if (!date || !userId) return;
      
      const key = `${userId}_${date}`;
      if (!dailyRecords[key]) {
        dailyRecords[key] = {
          userId: userId,
          date: date,
          punchInCount: 0,
          punchOutCount: 0,
          totalHours: 0,
          hasAdjustment: false,
          approvedAdjustmentCount: 0,
          totalAdjustments: 0,
          records: []
        };
      }
      
      const item = dailyRecords[key];
      
      // 過濾系統虛擬卡
      if (row.note === "系統虛擬卡") return;
      
      // 預計算計數器
      if (row.type === "上班") item.punchInCount++;
      if (row.type === "下班") item.punchOutCount++;
      if (row.note === "補打卡") {
        item.hasAdjustment = true;
        item.totalAdjustments++;
        if (row.audit === "v") item.approvedAdjustmentCount++;
      }
      
      item.records.push(row);
    } catch (err) {
      Logger.log("❌ checkAttendanceCalendar 解析失敗: " + err.message);
    }
  });

  // 第二遍：判斷狀態（使用預計算的計數，避免 some/every）
  const dailyStatus = [];
  
  for (const key in dailyRecords) {
    const item = dailyRecords[key];
    let reason = "";
    
    // 使用預計算的計數器，而不是 some/every（O(1) vs O(n)）
    const hasPair = item.punchInCount > 0 && item.punchOutCount > 0;
    const isAllApproved = item.totalAdjustments > 0 && 
                          item.approvedAdjustmentCount === item.totalAdjustments;
    
    // 判斷狀態邏輯（簡化版）
    if (!hasPair) {
      if (item.punchInCount === 0 && item.punchOutCount === 0) {
        reason = "STATUS_PUNCH_IN_MISSING";
      } else if (item.punchInCount > 0) {
        reason = "STATUS_PUNCH_OUT_MISSING";
      } else {
        reason = "STATUS_PUNCH_IN_MISSING";
      }
    } else if (isAllApproved) {
      reason = "STATUS_REPAIR_APPROVED";
    } else if (item.hasAdjustment) {
      reason = "STATUS_REPAIR_PENDING";
    } else {
      reason = "STATUS_PUNCH_NORMAL";
    }
    
    // 計算工時
    let hours = 0;
    if (item.records.length >= 2) {
      const sortedRecords = item.records.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateA - dateB;
      });
      
      const punchIn = sortedRecords.find(r => r.type === "上班");
      const punchOut = sortedRecords.find(r => r.type === "下班");
      
      if (punchIn && punchOut) {
        const inTime = new Date(punchIn.date);
        const outTime = new Date(punchOut.date);
        hours = ((outTime - inTime) / (1000 * 60 * 60)).toFixed(2);
      }
    }
    
    // ✅ 簡化返回：只保留必要的三個字段
    dailyStatus.push({
      date: item.date,
      reason: reason,
      hours: parseFloat(hours) || 0
    });
  }
  
  return dailyStatus;
}
