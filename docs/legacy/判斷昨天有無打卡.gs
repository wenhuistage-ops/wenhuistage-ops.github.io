const BROADCAST_TEXT = {
  // 情境 1：整天都沒有打卡紀錄
  PUNCH_ALL_MISS: {
    'zh-TW': "⚠️ 您昨天無打卡紀錄。若非休假，請記得補打卡。",
    'vi': "⚠️ Bạn không có dữ liệu chấm công hôm qua. Nếu không phải là ngày nghỉ, hãy bổ sung nhé.",
    'id': "⚠️ Anda tidak memiliki catatan absensi kemarin. Jika bukan hari libur, harap lengkapi absensi Anda.",
    'en': "⚠️ No attendance record found for yesterday. If you weren't on leave, please complete your punch-in/out.",
    'ja': "⚠️ 昨日の打刻記録がありません。休暇でない場合は、打刻修正を行ってください。",
    'ko': "⚠️ 어제 출퇴근 기록이 없습니다. 휴무가 아니었다면 출퇴근 기록을 보완해 주세요."
  },
  // 情境 2：只有上班漏打
  PUNCH_IN_MISS: {
    'zh-TW': "⚠️ 您昨天漏打「上班卡」。若非休假，請記得補打卡。",
    'vi': "⚠️ Bạn quên chấm công 「Giờ vào」 hôm qua. Nếu không phải là ngày nghỉ, hãy bổ sung nhé.",
    'id': "⚠️ Anda lupa absen 「Masuk」 kemarin. Jika bukan hari libur, harap lengkapi absensi Anda.",
    'en': "⚠️ You missed your 「Clock-in」 yesterday. If you weren't on leave, please complete it.",
    'ja': "⚠️ 昨日の「出勤打刻」が漏れています。休暇でない場合は修正してください。",
    'ko': "⚠️ 어제 「출근 기록」이 누락되었습니다. 휴무가 아니었다면 기록을 보완해 주세요."
  },
  // 情境 3：只有下班漏打
  PUNCH_OUT_MISS: {
    'zh-TW': "⚠️ 您昨天漏打「下班卡」。若非休假，請記得補打卡。",
    'vi': "⚠️ Bạn quên chấm công 「Giờ ra」 hôm qua. Nếu không phải là ngày nghỉ, hãy bổ sung nhé.",
    'id': "⚠️ Anda lupa absen 「Pulang」 kemarin. Jika bukan hari libur, harap lengkapi absensi Anda.",
    'en': "⚠️ You missed your 「Clock-out」 yesterday. If you weren't on leave, please complete it.",
    'ja': "⚠️ 昨日の「退勤打刻」が漏れています。休暇でない場合は修正してください。",
    'ko': "⚠️ 어제 「퇴근 기록」이 누락되었습니다. 휴무가 아니었다면 기록을 보완해 주세요."
  },
  // 提醒補卡的按鈕文字
  PUNCH_REPAIR: {
    'zh-TW': "補打卡",
    'vi': "Bổ sung công",
    'id': "Absensi",
    'en': "Fix Punch",
    'ja': "打刻修正",
    'ko': "출퇴근 수정"
  },
  // 系統維護通知
  SYSTEM_MAINTAIN: {
    'zh-TW': "🔧 系統將於今晚 23:00 進行維護。",
    'vi': "🔧 Hệ thống sẽ bảo trì vào 23:00 tối nay.",
    'id': "🔧 Sistem akan melakukan pemeliharaan pada pukul 23:00 malam ini.",
    'en': "🔧 System maintenance will be performed tonight at 23:00.",
    'ja': "🔧 今夜 23:00 にシステムメンテナンスを行います。",
    'ko': "🔧 오늘 밤 23:00에 시스템 점검이 예정되어 있습니다."
  }
};
function checkYesterdayPunchAndNotify() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetEmployees = ss.getSheetByName(SHEET_EMPLOYEES);
  const sheetAttendance = ss.getSheetByName(SHEET_ATTENDANCE);

  // ===== 員工 =====
  const employeeValues = sheetEmployees.getDataRange().getValues();
  const employeeHeaders = employeeValues.shift();
  const nameIndex = employeeHeaders.indexOf('name');
  const lineIdIndex = employeeHeaders.indexOf('userId');
  const employeeLanguageIndex = employeeHeaders.indexOf('偏好語言');
  // ===== 打卡 =====
  const attendanceValues = sheetAttendance.getDataRange().getValues();
  const attendanceHeaders = attendanceValues.shift();
  const userIdIndex = attendanceHeaders.indexOf('打卡人員ＩＤ');
  const timeIndex = attendanceHeaders.indexOf('打卡時間');
  const typeIndex = attendanceHeaders.indexOf('打卡類別');

  // ===== 今天時間區間 =====
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  // ===== 先整理「今天的打卡」 =====
  const todayAttendanceMap = {};

  attendanceValues.forEach(row => {
    const recordTime = new Date(row[timeIndex]);
    if (recordTime < yesterday || recordTime >= today) return;

    const userId = row[userIdIndex];
    if (!todayAttendanceMap[userId]) {
      todayAttendanceMap[userId] = [];
    }
    todayAttendanceMap[userId].push(row);
  });

  // ===== 處理每位員工 =====
  employeeValues.forEach(emp => {
    const userId = emp[lineIdIndex];
    const name = emp[nameIndex];
    const employeeLanguage = emp[employeeLanguageIndex];
    const records = todayAttendanceMap[userId] || [];

    if (records.length === 0) {
      Logger.log(`${name} 昨天無打卡`);
      const punchUrl = `${LINE_REDIRECT_URL}`;
      sendLineButtonMessage({
        to: userId,
        text: getBroadcastText_('PUNCH_ALL_MISS', employeeLanguage),
        buttonLabel: getBroadcastText_('PUNCH_REPAIR', employeeLanguage),
        url: punchUrl
      });
      return;
    }

    const hasOn = records.some(r => r[typeIndex] === '上班');
    const hasOff = records.some(r => r[typeIndex] === '下班');

    if (!hasOn) {
      Logger.log(`${name} 昨天無打上班卡`);
      const punchUrl = `${LINE_REDIRECT_URL}`;
      sendLineButtonMessage({
        to: userId,
        text: getBroadcastText_('PUNCH_IN_MISS', employeeLanguage),
        buttonLabel: getBroadcastText_('PUNCH_REPAIR', employeeLanguage),
        url: punchUrl
      });
    } else if (!hasOff) {
      Logger.log(`${userId} 昨天無打下班卡`);
      const punchUrl = `${LINE_REDIRECT_URL}`;
      sendLineButtonMessage({
        to: userId,
        text: getBroadcastText_('PUNCH_OUT_MISS', employeeLanguage),
        buttonLabel: getBroadcastText_('PUNCH_REPAIR', employeeLanguage),
        url: punchUrl
      });
    }

    Logger.log(`${name} 昨天打卡 ${records.length} 筆`);
  });
}
function sendLineButtonMessage({
  to,
  text,
  buttonLabel,
  url
}) {
  const payload = {
    to,
    messages: [{
      type: "template",
      altText: text,
      template: {
        type: "buttons",
        text,
        actions: [{
          type: "uri",
          label: buttonLabel,
          uri: url
        }]
      }
    }]
  };

  return sendLineRequest(payload);
}
function sendLineRequest(payload) {
  const options = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(LINE_MESSAGING_API_URL, options);

  // 可選：紀錄錯誤
  if (response.getResponseCode() !== 200) {
    Logger.log('LINE 發送失敗: ' + response.getContentText());
  }

  return response;
}
function getBroadcastText_(code, lang) {
  const item = BROADCAST_TEXT[code];
  if (!item) return null;

  // 找不到語言就退回中文
  return item[lang] || item['zh-TW'];
}