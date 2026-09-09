/**
 * 打卡流程純邏輯測試（2026-09-08 檢查報告第 3 節修復）
 *
 * 一律「從原始檔抽出函式本體 + new Function」來測（同 escape-html.test.js），
 * 確保測到的就是真正上線的那份程式碼，而不是測試裡另外抄一份。
 */
const fs = require('fs');
const path = require('path');

const readSrc = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/** 從原始碼抽出具名的頂層函式（結尾大括號在第 0 欄） */
function extractFn(src, name) {
    const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
    if (!m) throw new Error(`找不到函式 ${name}`);
    return m[0];
}

/** 抽出頂層的 const 宣告（單行或陣列） */
function extractConst(src, name) {
    const m = src.match(new RegExp(`const ${name} = [\\s\\S]*?;`));
    if (!m) throw new Error(`找不到常數 ${name}`);
    return m[0];
}

// ===================================
// U-H1：補卡日期範圍（js/punch/make-up.js）
// ===================================
describe('補卡日期範圍（U-H1）', () => {
    const src = readSrc('js/punch/make-up.js');
    const notices = [];

    const build = () => {
        const body = [
            // tOr 住在 core.js，validateAdjustTime 會用它，直接把真的那份帶進來
            extractFn(readSrc('js/core.js'), 'tOr'),
            extractConst(src, 'MAKEUP_MAX_BACKDAYS'),
            extractFn(src, '_startOfToday'),
            extractFn(src, 'getMakeupMinDate'),
            extractFn(src, 'getMakeupMaxDate'),
            extractFn(src, '_toLocalInputValue'),
            extractFn(src, 'validateAdjustTime'),
        ].join('\n');
        return new Function('showNotification', 't', `
            ${body};
            return { MAKEUP_MAX_BACKDAYS, getMakeupMinDate, getMakeupMaxDate, validateAdjustTime };
        `)(
            (msg) => notices.push(msg),
            (key, params = {}) => `${key}:${JSON.stringify(params)}`
        );
    };

    const mod = build();
    // 2026-09-01（月初）：報告裡「依 LINE 提醒回來補上月最後一天」的那一天
    const firstOfMonth = new Date(2026, 8, 1, 10, 0, 0);

    beforeEach(() => { notices.length = 0; });

    it('回溯天數是具名常數，且足以涵蓋跨月結算', () => {
        expect(mod.MAKEUP_MAX_BACKDAYS).toBe(45);
        expect(mod.MAKEUP_MAX_BACKDAYS).toBeGreaterThanOrEqual(31);
    });

    it('月初 1 號可以補「上個月最後一天」（原本被擋死的死路）', () => {
        expect(mod.validateAdjustTime('2026-08-31T18:00', firstOfMonth)).toBe(true);
        expect(notices).toHaveLength(0);
    });

    it('下限正好是今天往前 45 天，再往前一天就擋掉', () => {
        expect(mod.validateAdjustTime('2026-07-18T08:00', firstOfMonth)).toBe(true);
        expect(mod.validateAdjustTime('2026-07-17T23:59', firstOfMonth)).toBe(false);
    });

    it('超出範圍的錯誤訊息要說明「可以補哪一段」', () => {
        mod.validateAdjustTime('2026-01-05T08:00', firstOfMonth);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toContain('ERR_MAKEUP_OUT_OF_WINDOW');
        expect(notices[0]).toContain('"days":45');
        expect(notices[0]).toContain('"from":"2026-07-18"');
        expect(notices[0]).toContain('"to":"2026-09-01"');
    });

    it('今天最後一刻可以補，明天不行', () => {
        expect(mod.validateAdjustTime('2026-09-01T23:59', firstOfMonth)).toBe(true);
        expect(mod.validateAdjustTime('2026-09-02T00:00', firstOfMonth)).toBe(false);
        expect(notices[notices.length - 1]).toContain('ERR_AFTER_TODAY');
    });

    it('空字串／亂填的日期不會被當成 1970 年而丟出範圍錯誤', () => {
        expect(mod.validateAdjustTime('', firstOfMonth)).toBe(false);
        expect(notices[0]).toContain('MSG_PLEASE_SELECT_REPAIR_DATETIME');
    });

    it('min/max 用本地時間計算，不會因 UTC 位移而少一天', () => {
        // 台灣 UTC+8，凌晨 00:30 用 toISOString() 會退回前一天
        const midnight = new Date(2026, 8, 1, 0, 30, 0);
        expect(mod.getMakeupMaxDate(midnight).getDate()).toBe(1);
        expect(mod.getMakeupMaxDate(midnight).getMonth()).toBe(8);
        expect(mod.getMakeupMinDate(midnight).getHours()).toBe(0);
    });
});

// ===================================
// U-H2：GPS 錯誤碼對應（js/punch/geolocation.js）
// ===================================
describe('GPS 錯誤碼對應 i18n key（U-H2）', () => {
    const src = readSrc('js/punch/geolocation.js');
    const mod = new Function('tr_geo', `
        ${extractFn(src, 'geolocationErrorKey')}
        ${extractFn(src, 'geolocationErrorMessage')}
        return { geolocationErrorKey, geolocationErrorMessage };
    `)((key) => key);

    it('code 1/2/3 對到既有的三個 5 語 key', () => {
        expect(mod.geolocationErrorKey({ code: 1 })).toBe('ERROR_GEOLOCATION_PERMISSION_DENIED');
        expect(mod.geolocationErrorKey({ code: 2 })).toBe('ERROR_GEOLOCATION_UNAVAILABLE');
        expect(mod.geolocationErrorKey({ code: 3 })).toBe('ERROR_GEOLOCATION_TIMEOUT');
    });

    it('未知／缺 code 落到 UNKNOWN，不會回 undefined', () => {
        expect(mod.geolocationErrorKey({ code: 99 })).toBe('ERROR_GEOLOCATION_UNKNOWN');
        expect(mod.geolocationErrorKey({})).toBe('ERROR_GEOLOCATION_UNKNOWN');
        expect(mod.geolocationErrorKey(null)).toBe('ERROR_GEOLOCATION_UNKNOWN');
    });

    it('訊號不足／逾時要附「到空曠處再試」的建議，權限被拒不附（另有引導彈窗）', () => {
        expect(mod.geolocationErrorMessage({ code: 2 })).toContain('GPS_TIP_OPEN_SKY');
        expect(mod.geolocationErrorMessage({ code: 3 })).toContain('GPS_TIP_OPEN_SKY');
        expect(mod.geolocationErrorMessage({ code: 1 })).not.toContain('GPS_TIP_OPEN_SKY');
    });

    it('訊息裡不再出現瀏覽器英文原文或 [code N]', () => {
        const err = { code: 3, message: 'Timeout expired' };
        const msg = mod.geolocationErrorMessage(err);
        expect(msg).not.toContain('Timeout expired');
        expect(msg).not.toMatch(/\[code \d\]/);
    });
});

// ===================================
// U-M6：審核中狀態判斷（js/punch/abnormal-records.js）
// ===================================
describe('異常紀錄「審核中」判斷（U-M6）', () => {
    const src = readSrc('js/punch/abnormal-records.js');
    const mod = new Function(`
        ${extractConst(src, 'PENDING_REASON_CODES')}
        ${extractFn(src, 'isPendingAbnormalRecord')}
        return { isPendingAbnormalRecord, PENDING_REASON_CODES };
    `)();

    it('有待審核申請（pending / reviewing）算審核中', () => {
        expect(mod.isPendingAbnormalRecord({ status: 'pending', reason: 'STATUS_BOTH_MISSING' })).toBe(true);
        expect(mod.isPendingAbnormalRecord({ status: 'reviewing', reason: 'STATUS_BOTH_MISSING' })).toBe(true);
    });

    it('狀態本身就是 XXX(審核中) 也算，不該再用紅字催員工重送', () => {
        expect(mod.isPendingAbnormalRecord({ reason: 'STATUS_REPAIR_PENDING' })).toBe(true);
        expect(mod.isPendingAbnormalRecord({ reason: 'STATUS_LEAVE_PENDING' })).toBe(true);
        expect(mod.isPendingAbnormalRecord({ reason: 'STATUS_VACATION_PENDING' })).toBe(true);
    });

    it('真正還沒處理的異常仍算異常（維持紅字）', () => {
        expect(mod.isPendingAbnormalRecord({ reason: 'STATUS_BOTH_MISSING' })).toBe(false);
        expect(mod.isPendingAbnormalRecord({ reason: 'STATUS_PUNCH_IN_MISSING' })).toBe(false);
        expect(mod.isPendingAbnormalRecord({ reason: 'STATUS_PUNCH_OUT_MISSING' })).toBe(false);
        expect(mod.isPendingAbnormalRecord(null)).toBe(false);
    });

    it('已核准的狀態不算審核中（那些根本不會進異常清單）', () => {
        expect(mod.isPendingAbnormalRecord({ reason: 'STATUS_LEAVE_APPROVED' })).toBe(false);
    });
});

// ===================================
// U-H5：session 失效碼判斷（js/firestore-client.js）
// ===================================
describe('session 失效統一攔截（U-H5）', () => {
    const src = readSrc('js/firestore-client.js');
    const mod = new Function(`
        ${extractConst(src, 'SESSION_INVALID_CODES')}
        ${extractFn(src, 'isSessionInvalidResponse')}
        return { isSessionInvalidResponse, SESSION_INVALID_CODES };
    `)();

    it('三個 session 失效碼都攔得到', () => {
        ['ERR_SESSION_EXPIRED', 'ERR_SESSION_INVALID', 'ERR_ACCOUNT_INACTIVE'].forEach((code) => {
            expect(mod.isSessionInvalidResponse({ ok: false, code })).toBe(true);
        });
    });

    it('其他錯誤與成功回應不會誤觸發登出', () => {
        expect(mod.isSessionInvalidResponse({ ok: false, code: 'ERR_OUT_OF_RANGE' })).toBe(false);
        expect(mod.isSessionInvalidResponse({ ok: false, code: 'ERR_FIRESTORE_CALL_FAILED' })).toBe(false);
        expect(mod.isSessionInvalidResponse({ ok: true, code: 'ERR_SESSION_EXPIRED' })).toBe(false);
        expect(mod.isSessionInvalidResponse(null)).toBe(false);
        expect(mod.isSessionInvalidResponse(undefined)).toBe(false);
    });
});

// ===================================
// U-H2：超出範圍要附可執行建議（js/punch/punch-flow.js）
// ===================================
describe('超出打卡範圍的建議文案（U-H2）', () => {
    const src = readSrc('js/punch/punch-flow.js');
    const mod = new Function('t', `
        ${extractFn(readSrc('js/core.js'), 'tOr')}
        ${extractConst(src, 'OUT_OF_RANGE_CODES')}
        ${extractFn(src, 'withOutOfRangeTip')}
        return { withOutOfRangeTip };
    // 模擬「key 已經進 i18n 檔」：回傳與 key 不同的字串，tOr 才會採用它
    `)((key, params = {}) => `T[${key}]${params.location ? '(' + params.location + ')' : ''}`);

    it('後端有帶地點時，建議要指名該走近哪個地點', () => {
        const out = mod.withOutOfRangeTip('打卡失敗', {
            ok: false, code: 'ERR_OUT_OF_RANGE_WITH_DISTANCE', params: { location: '公司' },
        });
        expect(out).toContain('打卡失敗');
        expect(out).toContain('T[MSG_OUT_OF_RANGE_TIP](公司)');
    });

    it('沒帶地點時退回通用建議，不會印出 undefined', () => {
        const out = mod.withOutOfRangeTip('打卡失敗', { ok: false, code: 'ERR_OUT_OF_RANGE' });
        expect(out).toContain('T[MSG_OUT_OF_RANGE_TIP_NO_LOCATION]');
        expect(out).not.toContain('undefined');
    });

    it('成功或其他錯誤碼不加建議', () => {
        expect(mod.withOutOfRangeTip('打卡成功', { ok: true, code: 'PUNCH_SUCCESS' })).toBe('打卡成功');
        expect(mod.withOutOfRangeTip('連線失敗', { ok: false, code: 'ERR_FIRESTORE_CALL_FAILED' })).toBe('連線失敗');
        expect(mod.withOutOfRangeTip('x', null)).toBe('x');
    });
});

// ===================================
// 新 i18n key 尚未併入 i18n/*.json 時的後備（js/core.js）
// ===================================
describe('tOr：翻譯後備', () => {
    const src = readSrc('js/core.js');
    const buildWith = (tImpl) => new Function('t', `
        ${extractFn(src, 'tOr')}
        return tOr;
    `)(tImpl);

    it('key 有翻譯時用翻譯', () => {
        const tOr = buildWith((key) => (key === 'KNOWN' ? '已翻譯' : key));
        expect(tOr('KNOWN', '後備')).toBe('已翻譯');
    });

    it('t() 回傳 key 本身（＝查不到）時要用中文後備，不能把 key 秀給使用者', () => {
        const tOr = buildWith((key) => key);
        expect(tOr('MSG_SUBMITTING', '提交中...')).toBe('提交中...');
        expect(tOr('MSG_SUBMITTING', '提交中...')).not.toContain('MSG_');
    });

    it('後備文字也會做 {param} 替換', () => {
        const tOr = buildWith((key) => key);
        expect(tOr('X', '請走近「{location}」再試', { location: '公司' })).toBe('請走近「公司」再試');
    });
});

// ===================================
// F-L5：打卡備註不再存整串 userAgent（js/core.js）
// ===================================
describe('裝置標記取代 userAgent（F-L5）', () => {
    const src = readSrc('js/core.js');
    const buildWith = (ua) => new Function('navigator', `
        ${extractFn(src, 'deviceTag')}
        return deviceTag;
    `)({ userAgent: ua })();

    const IPHONE_LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.9.0';
    const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
    const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

    it('只留「作業系統/瀏覽器」，不含版本號或完整指紋', () => {
        expect(buildWith(IPHONE_LINE)).toBe('iOS/LINE');
        expect(buildWith(ANDROID_CHROME)).toBe('Android/Chrome');
        expect(buildWith(IPHONE_SAFARI)).toBe('iOS/Safari');
    });

    it('LINE 內建瀏覽器不會被誤判成 Safari/Chrome', () => {
        expect(buildWith(IPHONE_LINE)).not.toContain('Safari');
    });

    it('輸出短、不外洩原始 userAgent', () => {
        const tag = buildWith(ANDROID_CHROME);
        expect(tag.length).toBeLessThan(24);
        expect(ANDROID_CHROME).not.toContain(tag);
    });

    it('抓不到 userAgent 時回 Other/Other，不會丟例外', () => {
        expect(buildWith('')).toBe('Other/Other');
        expect(buildWith(undefined)).toBe('Other/Other');
    });
});
