/**
 * 管理端 / 月曆的純邏輯測試（2026-09-09 稽核修復）
 *
 * 一律「從原始檔抽出函式本體 + new Function」執行，確保測到的是真正上線的那份，
 * 而不是測試裡另外抄一份（抄的那份不會跟著改，等於沒測）。
 * 手法與 tests/escape-html.test.js 相同。
 */
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// ---------------------------------------------------------------
// 抽函式：js/modules/calendar.js 的本地日期解析（U-M2）
// ---------------------------------------------------------------
const calendarSrc = read('js/modules/calendar.js');
const parseLocalDateSrc = calendarSrc.match(/function parseLocalDate\(dateStr\) \{[\s\S]*?\n\}/)[0];
const isFutureDateKeySrc = calendarSrc.match(/function isFutureDateKey\(dateStr, today = new Date\(\)\) \{[\s\S]*?\n\}/)[0];
const { parseLocalDate, isFutureDateKey } = new Function(`
  ${parseLocalDateSrc}
  ${isFutureDateKeySrc}
  return { parseLocalDate, isFutureDateKey };
`)();

// ---------------------------------------------------------------
// 抽函式：js/state.js 的瀏覽器語言偵測（U-M10）
// ---------------------------------------------------------------
const stateSrc = read('js/state.js');
const detectBrowserLangSrc = stateSrc.match(/function detectBrowserLang\(browserLang\) \{[\s\S]*?\n\}/)[0];
const detectBrowserLang = new Function(`${detectBrowserLangSrc}; return detectBrowserLang;`)();

// ---------------------------------------------------------------
// 抽函式：js/modules/i18n.js 的錯誤碼轉譯（U-M8）
// t() 依賴自由變數 translations，包一層注入
// ---------------------------------------------------------------
const i18nSrc = read('js/modules/i18n.js');
const tSrc = i18nSrc.match(/function t\(code, params = \{\}\) \{[\s\S]*?\n\}/)[0];
const apiErrorTextSrc = i18nSrc.match(/function apiErrorText\(err, fallbackKey\) \{[\s\S]*?\n\}/)[0];
const makeApiErrorText = (dict) => new Function('translations', `
  ${tSrc}
  ${apiErrorTextSrc}
  return apiErrorText;
`)(dict);

// ---------------------------------------------------------------
// 抽函式：js/admin.js 的假別代碼對應（U-M4）
// 從 LEAVE_KIND_I18N 宣告一路抽到 leaveKindStatKey 結尾
// ---------------------------------------------------------------
const adminSrc = read('js/admin.js');
const leaveBlock = adminSrc.substring(
  adminSrc.indexOf('/** 代碼 → i18n key（新制固定代碼） */'),
  adminSrc.indexOf('\n}', adminSrc.indexOf('function leaveKindStatKey(raw)')) + 2
);
const leaveKinds = new Function('translations', `
  ${tSrc}
  const _tt = (key, fallback) => (t(key) || fallback);
  ${leaveBlock}
  return { normalizeLeaveKind, leaveKindLabel, leaveKindStatKey, leaveKindCanonicalZh,
           LEAVE_KIND_ZH, LEAVE_GROUP_KINDS };
`);

// ---------------------------------------------------------------
// 勞基法常數：直接 require（labor-hours.js 有 module.exports）
// ---------------------------------------------------------------
const { LABOR_CONSTANTS, EMPLOYEE_CONTRIBUTION_RATES, LABOR_INSURANCE_GRADES,
        monthlyToHourly } = require('../js/labor-hours.js');

// ===============================================================
describe('U-M2 本地日期解析（凌晨點月曆「今天」）', () => {
  it("parseLocalDate 以本地時區解析，不是 UTC 午夜", () => {
    const d = parseLocalDate('2026-09-09');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);   // 0-based
    expect(d.getDate()).toBe(9);
    expect(d.getHours()).toBe(0);
  });

  it('格式不符回 null，不回 Invalid Date', () => {
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate('2026/09/09')).toBeNull();
    expect(parseLocalDate('not-a-date')).toBeNull();
  });

  it('帶時間後綴也解析得到（只取日期部分）', () => {
    const d = parseLocalDate('2026-09-09 13:45:00');
    expect(d.getDate()).toBe(9);
    expect(d.getHours()).toBe(0);
  });

  it('台灣凌晨 00:30 點「今天」不會被判成未來日期（本題的原始 bug）', () => {
    // 舊寫法 new Date('2026-09-09') 是 UTC 午夜 = 台灣 08:00，
    // 拿去跟 03:30 的 now 比會大於 → 今天被當未來，點了完全沒反應。
    const earlyMorning = new Date(2026, 8, 9, 0, 30, 0);
    expect(isFutureDateKey('2026-09-09', earlyMorning)).toBe(false);
    // 對照組：舊寫法確實會誤判
    expect(new Date('2026-09-09') > earlyMorning).toBe(true);
  });

  it('昨天不是未來、明天是未來', () => {
    const today = new Date(2026, 8, 9, 12, 0, 0);
    expect(isFutureDateKey('2026-09-08', today)).toBe(false);
    expect(isFutureDateKey('2026-09-09', today)).toBe(false);
    expect(isFutureDateKey('2026-09-10', today)).toBe(true);
  });

  it('跨月 / 跨年邊界正確', () => {
    const today = new Date(2026, 11, 31, 23, 59, 0);
    expect(isFutureDateKey('2026-12-31', today)).toBe(false);
    expect(isFutureDateKey('2027-01-01', today)).toBe(true);
  });

  it('解析失敗一律回 false（寧可讓使用者點得到）', () => {
    expect(isFutureDateKey('', new Date())).toBe(false);
    expect(isFutureDateKey(undefined, new Date())).toBe(false);
  });
});

// ===============================================================
describe('U-M10 瀏覽器語言偵測（首次沒有 lang 時）', () => {
  it.each([
    ['zh-TW', 'zh-TW'],
    ['zh-CN', 'zh-TW'],
    ['ja-JP', 'ja'],
    ['vi-VN', 'vi'],
    ['id-ID', 'id'],
    ['in', 'id'],          // 舊版 Android 用 'in' 代表印尼文
    ['en-GB', 'en-US'],
    ['fr-FR', 'en-US'],
    ['', 'en-US'],
  ])('%s → %s', (browser, expected) => {
    expect(detectBrowserLang(browser)).toBe(expected);
  });

  it('大小寫不敏感', () => {
    expect(detectBrowserLang('VI-vn')).toBe('vi');
    expect(detectBrowserLang('ZH-Hant-TW')).toBe('zh-TW');
  });
});

// ===============================================================
describe('U-M8 錯誤碼轉譯（不把技術字串顯示給使用者）', () => {
  const dict = {
    UNKNOWN_ERROR: '發生未知錯誤，請稍後重試',
    ERR_NOT_FOUND: '找不到資料',
    MY_REQUESTS_LOAD_ERROR: '無法取得申請紀錄',
  };
  const apiErrorText = makeApiErrorText(dict);

  it('有翻譯的錯誤碼 → 用翻譯', () => {
    expect(apiErrorText({ ok: false, code: 'ERR_NOT_FOUND' })).toBe('找不到資料');
  });

  it('沒翻譯的錯誤碼 → 退回通用文案，不顯示代碼本身', () => {
    const out = apiErrorText({ ok: false, code: 'ERR_FIRESTORE_CALL_FAILED' });
    expect(out).toBe('發生未知錯誤，請稍後重試');
    expect(out).not.toContain('ERR_');
  });

  it('沒翻譯但有指定 fallbackKey → 用 fallbackKey 的翻譯', () => {
    expect(apiErrorText({ code: 'ERR_WHATEVER' }, 'MY_REQUESTS_LOAD_ERROR'))
      .toBe('無法取得申請紀錄');
  });

  it('fallbackKey 也沒翻譯 → 仍退回 UNKNOWN_ERROR，不外洩 key', () => {
    const out = apiErrorText({ code: 'ERR_X' }, 'NO_SUCH_KEY');
    expect(out).toBe('發生未知錯誤，請稍後重試');
  });

  it('res.msg / err.message / stack 一律不會被顯示', () => {
    expect(apiErrorText({ ok: false, msg: 'FirebaseError: internal', code: 'ERR_X' }))
      .toBe('發生未知錯誤，請稍後重試');
    const err = new Error('TypeError: undefined is not a function');
    expect(apiErrorText(err)).toBe('發生未知錯誤，請稍後重試');
  });

  it('null / undefined / 空物件都安全', () => {
    expect(apiErrorText(null)).toBe('發生未知錯誤，請稍後重試');
    expect(apiErrorText(undefined)).toBe('發生未知錯誤，請稍後重試');
    expect(apiErrorText({})).toBe('發生未知錯誤，請稍後重試');
  });

  it('後端英文長句不會被當成翻譯 key 查', () => {
    expect(apiErrorText('Something went terribly wrong'))
      .toBe('發生未知錯誤，請稍後重試');
  });

  it('code 是字串本身時也接受', () => {
    expect(apiErrorText('ERR_NOT_FOUND')).toBe('找不到資料');
  });
});

// ===============================================================
describe('U-M4 假別代碼對應（管理端統計不再被語言拆開）', () => {
  const zhDict = {
    LEAVE_SICK: '病假', LEAVE_PERSONAL: '事假', LEAVE_OTHER: '其他',
    VACATION_ANNUAL: '年假', VACATION_SPECIAL: '特休',
    VACATION_COMPENSATORY: '補休', VACATION_TYPHOON: '颱風假',
  };
  const viDict = {
    LEAVE_SICK: 'Nghỉ ốm', LEAVE_PERSONAL: 'Nghỉ việc riêng', LEAVE_OTHER: 'Khác',
    VACATION_ANNUAL: 'Nghỉ phép năm', VACATION_SPECIAL: 'Nghỉ đặc biệt',
    VACATION_COMPENSATORY: 'Nghỉ bù', VACATION_TYPHOON: 'Nghỉ bão',
  };
  const zh = leaveKinds(zhDict);
  const vi = leaveKinds(viDict);

  it('新制固定代碼直接認得', () => {
    ['sick', 'personal', 'other', 'annual', 'special', 'compensatory', 'typhoon']
      .forEach((code) => expect(zh.normalizeLeaveKind(code)).toBe(code));
  });

  it('舊制各語言文字都對應到同一個代碼', () => {
    expect(zh.normalizeLeaveKind('病假')).toBe('sick');
    expect(zh.normalizeLeaveKind('Nghỉ ốm')).toBe('sick');
    expect(zh.normalizeLeaveKind('Izin Sakit')).toBe('sick');
    expect(zh.normalizeLeaveKind('Sick Leave')).toBe('sick');
    expect(zh.normalizeLeaveKind('病欠')).toBe('sick');
  });

  it('統計 key：五種語言的病假合併成一類（原始 bug）', () => {
    const raws = ['病假', 'Nghỉ ốm', 'Izin Sakit', 'Sick Leave', '病欠', 'sick'];
    const keys = new Set(raws.map((r) => zh.leaveKindStatKey(r)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('sick');
  });

  it('大小寫與越南文組合字元（NFD）都比得到', () => {
    expect(zh.normalizeLeaveKind('NGHỈ ỐM')).toBe('sick');
    expect(zh.normalizeLeaveKind('Nghỉ ốm'.normalize('NFD'))).toBe('sick');
  });

  it('顯示文字：代碼翻成當前語言', () => {
    expect(zh.leaveKindLabel('sick')).toBe('病假');
    expect(vi.leaveKindLabel('sick')).toBe('Nghỉ ốm');
    // 舊的越南文值，在中文介面也會被正規化後翻成中文
    expect(zh.leaveKindLabel('Nghỉ ốm')).toBe('病假');
  });

  it('認不出的舊自由文字：原樣顯示、原樣分組，不會被吃掉', () => {
    expect(zh.normalizeLeaveKind('家裡有事')).toBeNull();
    expect(zh.leaveKindLabel('家裡有事')).toBe('家裡有事');
    expect(zh.leaveKindStatKey('家裡有事')).toBe('家裡有事');
  });

  it('空值安全', () => {
    expect(zh.normalizeLeaveKind('')).toBeNull();
    expect(zh.normalizeLeaveKind(null)).toBeNull();
    expect(zh.leaveKindLabel(null)).toBe('');
    expect(zh.leaveKindStatKey(undefined)).toBe('');
  });

  it('存檔用的正規中文值必須落在後端 LEAVE_KINDS 白名單內', () => {
    // 後端 _helpers.js：{ 請假: [病假, 事假, 其他], 休假: [年假, 特休, 補休, 颱風假] }
    const backendWhitelist = {
      '請假': ['病假', '事假', '其他'],
      '休假': ['年假', '特休', '補休', '颱風假'],
    };
    Object.entries(zh.LEAVE_GROUP_KINDS).forEach(([group, codes]) => {
      codes.forEach((code) => {
        expect(backendWhitelist[group]).toContain(zh.LEAVE_KIND_ZH[code]);
      });
    });
    // 反向：白名單每一項都有對應代碼
    Object.values(backendWhitelist).flat().forEach((kind) => {
      expect(zh.leaveKindCanonicalZh(kind)).toBe(kind);
    });
  });

  it('越南文舊值也換得回後端接受的中文值', () => {
    expect(zh.leaveKindCanonicalZh('Nghỉ việc riêng')).toBe('事假');
    expect(zh.leaveKindCanonicalZh('Cuti Tahunan')).toBe('年假');
    expect(zh.leaveKindCanonicalZh('自由文字')).toBeNull();
  });
});

// ===============================================================
describe('勞基法常數集中後數值未變（薪資防呆）', () => {
  it('工時與換算常數', () => {
    expect(LABOR_CONSTANTS.STANDARD_HOURS).toBe(8);
    expect(LABOR_CONSTANTS.DAILY_LEGAL_MAX_HOURS).toBe(12);
    expect(LABOR_CONSTANTS.MONTHLY_DAYS).toBe(30);
    expect(LABOR_CONSTANTS.HOURLY_DIVISOR).toBe(240);
    // 施行細則 §31：÷30÷8 = ÷240
    expect(LABOR_CONSTANTS.MONTHLY_DAYS * LABOR_CONSTANTS.STANDARD_HOURS)
      .toBe(LABOR_CONSTANTS.HOURLY_DIVISOR);
  });

  it('加班倍率', () => {
    expect(LABOR_CONSTANTS.OT_RATE).toEqual({
      WORKDAY_1: 1.34, WORKDAY_2: 1.67,
      REST_1: 1.34, REST_2: 1.67, REST_3: 2.67,
      PUBLIC_1: 1.34, PUBLIC_2: 1.67,
      REGULAR: 2,
    });
  });

  it('加班分段門檻', () => {
    expect(LABOR_CONSTANTS.OT_TIER).toEqual({
      WORKDAY_OT1_HOURS: 2,
      REST_OT1_HOURS: 2,
      REST_OT2_HOURS: 6,
      REST_OT2_END_HOURS: 8,
      PUBLIC_OT1_HOURS: 2,
    });
    // 休息日第二段結束點 = 前兩段相加
    expect(LABOR_CONSTANTS.OT_TIER.REST_OT1_HOURS + LABOR_CONSTANTS.OT_TIER.REST_OT2_HOURS)
      .toBe(LABOR_CONSTANTS.OT_TIER.REST_OT2_END_HOURS);
  });

  it('2026 基本工資', () => {
    expect(LABOR_CONSTANTS.MIN_MONTHLY_WAGE).toBe(29500);
    expect(LABOR_CONSTANTS.MIN_HOURLY_WAGE).toBe(190);
    // 分級表第 1 級 = 基本工資
    expect(LABOR_INSURANCE_GRADES[0].salary).toBe(LABOR_CONSTANTS.MIN_MONTHLY_WAGE);
  });

  it('員工自付率沿用字面值（不可寫成乘式，浮點會差一個 ulp）', () => {
    expect(EMPLOYEE_CONTRIBUTION_RATES.laborInsuranceTaiwanese).toBe(0.025);
    expect(EMPLOYEE_CONTRIBUTION_RATES.laborInsuranceForeign).toBe(0.023);
    expect(EMPLOYEE_CONTRIBUTION_RATES.healthInsurance).toBe(0.0517 * 0.30);
    // 佐證：外籍費率不能用乘式導出
    expect(LABOR_CONSTANTS.INSURANCE.LABOR_TOTAL_FOREIGN
           * LABOR_CONSTANTS.INSURANCE.LABOR_EMPLOYEE_SHARE)
      .not.toBe(EMPLOYEE_CONTRIBUTION_RATES.laborInsuranceForeign);
  });

  it('保險費率（顯示用）', () => {
    expect(LABOR_CONSTANTS.INSURANCE).toEqual({
      LABOR_TOTAL_TAIWANESE: 0.125,
      LABOR_TOTAL_FOREIGN: 0.115,
      LABOR_EMPLOYEE_SHARE: 0.20,
      HEALTH_TOTAL: 0.0517,
      HEALTH_EMPLOYEE_SHARE: 0.30,
    });
  });

  it('月薪換時薪走同一個除數', () => {
    expect(monthlyToHourly(29500)).toBe(Math.round(29500 / LABOR_CONSTANTS.HOURLY_DIVISOR));
    expect(monthlyToHourly(36000)).toBe(150);
  });
});

// ===============================================================
describe('admin.js 不再殘留原生對話框與間接 eval', () => {
  /** 粗略移除 // 行註解與 block 註解，避免把說明文字誤判成程式碼 */
  const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  it('沒有 alert( / window.prompt( 呼叫', () => {
    const code = stripComments(adminSrc);
    expect(code).not.toMatch(/(^|[^.\w])alert\s*\(/m);
    expect(code).not.toMatch(/window\.prompt\s*\(/);
  });

  it('沒有 (0, eval)() 間接 eval（註解提到不算，看的是可執行碼）', () => {
    const code = stripComments(adminSrc);
    expect(code).not.toMatch(/\(\s*0\s*,\s*eval\s*\)\s*\(/);
    expect(code).not.toContain('_ensure=');
    expect(code).not.toContain('ensureWeeklyChartLoaded');
  });

  it('location.js 也不再用原生 alert', () => {
    const locationSrc = stripComments(read('js/location.js'));
    expect(locationSrc).not.toMatch(/(^|[^.\w])alert\s*\(/m);
  });

  it('ui.js 月曆點擊不再用 new Date(dateStr) 判斷未來日期', () => {
    const uiSrc = stripComments(read('js/ui.js'));
    expect(uiSrc).not.toMatch(/new Date\(dateStr\)/);
    expect(uiSrc).toContain('isFutureDateKey');
  });
});
