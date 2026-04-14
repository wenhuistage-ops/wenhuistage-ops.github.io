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

// 距離計算公式 - 使用 Haversine 公式計算球面距離
function getDistanceMeters_(lat1, lng1, lat2, lng2) {
  // 輸入驗證
  if (typeof lat1 !== 'number' || typeof lng1 !== 'number' ||
      typeof lat2 !== 'number' || typeof lng2 !== 'number') {
    throw new Error('坐標必須是數字類型');
  }

  // 範圍檢查
  if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90) {
    throw new Error('緯度必須在 -90 到 90 度之間');
  }
  if (lng1 < -180 || lng1 > 180 || lng2 < -180 || lng2 > 180) {
    throw new Error('經度必須在 -180 到 180 度之間');
  }

  function toRad(deg) { return deg * Math.PI / 180; }

  const R = 6371000; // 地球半徑 (公尺)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng/2) * Math.sin(dLng/2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  // 確保返回有效的數字
  return isNaN(distance) ? 0 : Math.round(distance * 100) / 100; // 保留2位小數
}

/**
 * 檢查員工每天的打卡異常狀態，並回傳格式化的異常列表
 * @param {Array} attendanceRows 打卡紀錄，每筆包含：
 * [打卡時間, 員工ID, 薪資, 員工姓名, 上下班, GPS位置, 地點, 備註, 使用裝置詳細訊息]
 * @returns {Array} 每天每位員工的異常結果，格式為 { date: string, reason: string, id: string } 的陣列
 */
function checkAttendanceAbnormal(attendanceRows, targetMonth = null) {
  const dailyRecords = {}; // 按 userId+date 分組
  const abnormalRecords = []; // 新增：用於儲存格式化的異常紀錄
  let abnormalIdCounter = 0; // 新增：用於產生唯一的 id

  Logger.log("checkAttendanceAbnormal開始，記錄數量: " + attendanceRows.length + "，目標月份: " + targetMonth);

  // 確定月份範圍
  let monthStart, monthEnd;
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  if (targetMonth) {
    // 如果指定了目標月份，使用該月份
    const [year, month] = targetMonth.split('-').map(Number);
    monthStart = new Date(year, month - 1, 1);
    monthEnd = new Date(year, month, 0); // 當月最後一天
  } else {
    // 否則基於記錄確定範圍（向後兼容）
    let minDate = null;

    attendanceRows.forEach(row => {
      try {
        const date = getYmdFromRow(row);
        if (!minDate || date < minDate) minDate = date;
      } catch (err) {
        Logger.log("❌ 解析日期失敗: " + JSON.stringify(row) + " | 錯誤: " + err.message);
      }
    });

    if (!minDate) {
      Logger.log("沒有找到任何記錄");
      return [];
    }

    const [year, month] = minDate.split('-').map(Number);
    monthStart = new Date(year, month - 1, 1);
    monthEnd = new Date(year, month, 0);
  }

  Logger.log("檢查日期範圍: " + monthStart.toISOString().split('T')[0] + " 到 " + monthEnd.toISOString().split('T')[0]);

  // 將記錄按用戶和日期分組
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

  Logger.log("分組後的記錄: " + JSON.stringify(Object.keys(dailyRecords)));

  for (const userId in dailyRecords) {
    for (let date = new Date(monthStart); date <= monthEnd; date.setDate(date.getDate() + 1)) {
      const dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");

      // 跳過未來的日期
      if (dateStr > today) continue;

      const rows = dailyRecords[userId][dateStr] || [];
      Logger.log("檢查日期 " + dateStr + " 的記錄數量: " + rows.length);

      // 過濾系統虛擬卡
      const filteredRows = rows.filter(r => r.note !== "系統虛擬卡");
      Logger.log("過濾後記錄數量: " + filteredRows.length);

      // 使用與 checkAttendance 相同的邏輯
      let punchInCount = 0;
      let punchOutCount = 0;
      let hasAdjustment = false;
      let approvedAdjustmentCount = 0;
      let totalAdjustments = 0;
      let hasLeaveRequest = false;
      let approvedLeaveCount = 0;
      let totalLeaveRequests = 0;

      filteredRows.forEach(r => {
        if (r.type === "上班") punchInCount++;
        if (r.type === "下班") punchOutCount++;
        if (r.note === "補打卡") {
          hasAdjustment = true;
          totalAdjustments++;
          if (r.audit === "v") approvedAdjustmentCount++;
          Logger.log("  ✓ 發現補打卡記錄: audit=" + r.audit);
        }
        if (r.note === "系統請假記錄") {
          hasLeaveRequest = true;
          totalLeaveRequests++;
          if (r.audit === "v") approvedLeaveCount++;
          Logger.log("  ✓ 發現請假記錄: type=" + r.type + ", audit=" + r.audit);
        }
      });

      Logger.log("日期 " + dateStr + " 統計: 上班=" + punchInCount + ", 下班=" + punchOutCount + ", 補卡=" + totalAdjustments + ", 通過=" + approvedAdjustmentCount + ", 請假=" + totalLeaveRequests + ", 請假通過=" + approvedLeaveCount);

      let reason = "";

      // 使用與 checkAttendance 相同的判斷邏輯
      const hasPair = punchInCount > 0 && punchOutCount > 0;
      const hasApprovedRepair = totalAdjustments > 0 && approvedAdjustmentCount === totalAdjustments;
      const hasApprovedLeave = hasLeaveRequest && approvedLeaveCount === totalLeaveRequests;
      const hasPendingRequest = (hasAdjustment && approvedAdjustmentCount < totalAdjustments) ||
                               (hasLeaveRequest && approvedLeaveCount < totalLeaveRequests);

      Logger.log("  📊 檢查條件: hasPair=" + hasPair + ", hasApprovedRepair=" + hasApprovedRepair + ", hasApprovedLeave=" + hasApprovedLeave + ", hasPendingRequest=" + hasPendingRequest);

      // ✅ 優先檢查是否有已批准的請假/休假（無論是否有打卡）
      if (hasApprovedLeave) {
        // 有已批准的請假/休假
        const leaveRecord = filteredRows.find(r => r.note === "系統請假記錄" && r.audit === "v");
        if (leaveRecord && leaveRecord.type) {
          reason = leaveRecord.type === "請假" ? "STATUS_LEAVE_APPROVED" : "STATUS_VACATION_APPROVED";
        } else {
          reason = "STATUS_LEAVE_APPROVED"; // 預設為請假
        }
        Logger.log("  ✅ 已批准請假: " + reason);
      }
      // 其次檢查是否有已批准的補卡
      else if (hasApprovedRepair) {
        // 有已批准的補卡
        reason = "STATUS_REPAIR_APPROVED";
        Logger.log("  ✅ 已批准補卡: STATUS_REPAIR_APPROVED");
      }
      // 然後檢查是否有待審核的請求
      else if (hasPendingRequest) {
        // 檢查是否有請假記錄的待審核請求
        if (hasLeaveRequest && approvedLeaveCount < totalLeaveRequests) {
          // 找到請假記錄的類型
          const leaveRecord = filteredRows.find(r => r.note === "系統請假記錄");
          if (leaveRecord && leaveRecord.type) {
            reason = leaveRecord.type === "請假" ? "STATUS_LEAVE_PENDING" : "STATUS_VACATION_PENDING";
          } else {
            reason = "STATUS_LEAVE_PENDING"; // 預設為請假
          }
          Logger.log("  ⏳ 請假待審核: " + reason);
        } else {
          reason = "STATUS_REPAIR_PENDING";
          Logger.log("  ⏳ 補卡待審核: STATUS_REPAIR_PENDING");
        }
      }
      // 最後檢查打卡情況
      else if (!hasPair) {
        if (punchInCount === 0 && punchOutCount === 0) {
          reason = "STATUS_BOTH_MISSING";
          Logger.log("  ❌ 本日未打卡: STATUS_BOTH_MISSING");
        } else if (punchInCount > 0) {
          reason = "STATUS_PUNCH_OUT_MISSING";
          Logger.log("  ❌ 缺下班卡: STATUS_PUNCH_OUT_MISSING");
        } else {
          reason = "STATUS_PUNCH_IN_MISSING";
          Logger.log("  ❌ 缺上班卡: STATUS_PUNCH_IN_MISSING");
        }
      } else {
        reason = "STATUS_PUNCH_NORMAL";
        Logger.log("  ✓ 打卡正常: STATUS_PUNCH_NORMAL");
      }

      // 只記錄異常記錄（非正常狀態和已批准狀態）
      const normalStatuses = [
        "STATUS_PUNCH_NORMAL",
        "STATUS_REPAIR_APPROVED",
        "STATUS_LEAVE_APPROVED",
        "STATUS_VACATION_APPROVED"
      ];
      if (reason && !normalStatuses.includes(reason)) {
        abnormalIdCounter++;
        abnormalRecords.push({
          date: dateStr,
          reason: reason,
          id: `abnormal-${abnormalIdCounter}`
        });
        Logger.log("  📋 新增異常記錄: " + dateStr + " - " + reason);
      } else if (normalStatuses.includes(reason)) {
        Logger.log("  ✓ 排除: " + reason + " (正常狀態)");
      }
    }
  }

  Logger.log("最終異常記錄數量: " + abnormalRecords.length);
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
      let hasLeaveRequest = false;
      let approvedLeaveCount = 0;
      let totalLeaveRequests = 0;
      
      record.forEach(r => {
        if (r.type === "上班") punchInCount++;
        if (r.type === "下班") punchOutCount++;
        if (r.note === "補打卡") {
          hasAdjustment = true;
          totalAdjustments++;
          if (r.audit === "v") approvedAdjustmentCount++;
        }
        if (r.note === "系統請假記錄") {
          hasLeaveRequest = true;
          totalLeaveRequests++;
          if (r.audit === "v") approvedLeaveCount++;
        }
      });

      // 計算工時
      let hours = 0;
      if (safeRecord.length >= 2) {
        const sortedRecords = safeRecord.sort((a, b) => {
          const dateA = new Date(a.time);
          const dateB = new Date(b.time);
          return dateA - dateB;
        });
        
        const punchIn = sortedRecords.find(r => r.type === "上班");
        const punchOut = sortedRecords.find(r => r.type === "下班");
        
        if (punchIn && punchOut) {
          const inTime = new Date(punchIn.time);
          const outTime = new Date(punchOut.time);
          hours = ((outTime - inTime) / (1000 * 60 * 60)).toFixed(2);
        }
      }

      let reason = "";
      let id = "normal";

      // 使用預計算的計數器進行判斷
      const hasPair = punchInCount > 0 && punchOutCount > 0;
      const hasApprovedRepair = totalAdjustments > 0 && approvedAdjustmentCount === totalAdjustments;
      const hasApprovedLeave = hasLeaveRequest && approvedLeaveCount === totalLeaveRequests;
      const hasPendingRequest = (hasAdjustment && approvedAdjustmentCount < totalAdjustments) ||
                               (hasLeaveRequest && approvedLeaveCount < totalLeaveRequests);

      // ✅ 優先檢查是否有已批准的請假/休假（無論打卡情況）
      if (hasApprovedLeave) {
        const leaveRecord = filteredRows.find(r => r.note === "系統請假記錄" && r.audit === "v");
        if (leaveRecord && leaveRecord.type) {
          reason = leaveRecord.type === "請假" ? "STATUS_LEAVE_APPROVED" : "STATUS_VACATION_APPROVED";
        } else {
          reason = "STATUS_LEAVE_APPROVED"; // 預設為請假
        }
      }
      // 其次檢查已批准的補卡
      else if (hasApprovedRepair) {
        reason = "STATUS_REPAIR_APPROVED";
      }
      // 然後檢查待審核的請求
      else if (hasPendingRequest) {
        if (hasLeaveRequest && approvedLeaveCount < totalLeaveRequests) {
          const leaveRecord = filteredRows.find(r => r.note === "系統請假記錄");
          if (leaveRecord && leaveRecord.type) {
            reason = leaveRecord.type === "請假" ? "STATUS_LEAVE_PENDING" : "STATUS_VACATION_PENDING";
          } else {
            reason = "STATUS_LEAVE_PENDING"; // 預設為請假
          }
        } else {
          reason = "STATUS_REPAIR_PENDING";
        }
      }
      // 最後判斷打卡情況
      else if (!hasPair) {
        if (punchInCount === 0 && punchOutCount === 0) {
          reason = "STATUS_BOTH_MISSING";
        } else if (punchInCount > 0) {
          reason = "STATUS_PUNCH_OUT_MISSING";
        } else {
          reason = "STATUS_PUNCH_IN_MISSING";
        }
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
        hours: parseFloat(hours) || 0,
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
          hasLeaveRequest: false,
          approvedLeaveCount: 0,
          totalLeaveRequests: 0,
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
      if (row.note === "系統請假記錄") {
        item.hasLeaveRequest = true;
        item.totalLeaveRequests++;
        if (row.audit === "v") item.approvedLeaveCount++;
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
    const hasApprovedRepair = item.totalAdjustments > 0 && item.approvedAdjustmentCount === item.totalAdjustments;
    const hasApprovedLeave = item.hasLeaveRequest && item.approvedLeaveCount === item.totalLeaveRequests;
    const hasPendingRequest = (item.hasAdjustment && item.approvedAdjustmentCount < item.totalAdjustments) ||
                             (item.hasLeaveRequest && item.approvedLeaveCount < item.totalLeaveRequests);

    // ✅ 優先檢查是否有已批准的請假/休假
    if (hasApprovedLeave) {
      const leaveRecord = item.records.find(r => r.note === "系統請假記錄" && r.audit === "v");
      if (leaveRecord && leaveRecord.type) {
        reason = leaveRecord.type === "請假" ? "STATUS_LEAVE_APPROVED" : "STATUS_VACATION_APPROVED";
      } else {
        reason = "STATUS_LEAVE_APPROVED"; // 預設為請假
      }
    }
    // 其次檢查已批准的補卡
    else if (hasApprovedRepair) {
      reason = "STATUS_REPAIR_APPROVED";
    }
    // 然後檢查待審核的請求
    else if (hasPendingRequest) {
      if (item.hasLeaveRequest && item.approvedLeaveCount < item.totalLeaveRequests) {
        const leaveRecord = item.records.find(r => r.note === "系統請假記錄");
        if (leaveRecord && leaveRecord.type) {
          reason = leaveRecord.type === "請假" ? "STATUS_LEAVE_PENDING" : "STATUS_VACATION_PENDING";
        } else {
          reason = "STATUS_LEAVE_PENDING"; // 預設為請假
        }
      } else {
        reason = "STATUS_REPAIR_PENDING";
      }
    }
    // 最後判斷打卡情況
    else if (!hasPair) {
      if (item.punchInCount === 0 && item.punchOutCount === 0) {
        reason = "STATUS_BOTH_MISSING";
      } else if (item.punchInCount > 0) {
        reason = "STATUS_PUNCH_OUT_MISSING";
      } else {
        reason = "STATUS_PUNCH_IN_MISSING";
      }
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
