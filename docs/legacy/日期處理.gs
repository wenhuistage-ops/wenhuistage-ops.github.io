function fetchTaiwanHolidaysWithWeek() {
  const url = 'https://api.pin-yi.me/taiwan-calendar/2026/';
  const response = UrlFetchApp.fetch(url);
  const data = JSON.parse(response.getContentText());

  const sheetName = '假日表';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear(); // 清空舊資料
  }

  // 建立表頭
  sheet.getRange(1, 1, 1, 5).setValues([['日期', '星期(英文)', '星期(中文)', '是否假日', '假日名稱']]);

  // 填入資料
  const values = data.map(item => [
    item.date_format,
    item.week,
    item.week_chinese,
    item.isHoliday ? '是' : '否',
    item.caption
  ]);

  sheet.getRange(2, 1, values.length, 5).setValues(values);
}
