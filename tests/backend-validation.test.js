/**
 * 後端純函式驗證測試（firebase-functions/functions/src）
 *
 * 這些函式住在需要 firebase-admin 初始化的模組裡，直接 require 會在測試環境炸掉
 * （沒有 GCP 憑證）。作法與 tests/escape-html.test.js 相同：從原始檔用正規表達式
 * 抽出函式本體，再以 new Function 求值 —— 測到的一定是真正會上線的那份程式碼，
 * 不是測試檔裡另抄一份。
 *
 * 對應稽核項目：
 *   B-M1  isValidMonth 月份範圍
 *   B-M2  checkPunchCooldown 60 秒重複打卡判斷
 *   B-M5  isValidPunchType 打卡類型白名單
 *   B-L9  isValidDocId doc id 字元白名單
 *   B-L11 normalizeLeaveKind / leaveGroupOf 假別白名單（多語相容）
 *   B-L16 parseMonth 月份解析收緊
 */

const fs = require('fs');
const path = require('path');

const HELPERS_SRC = fs.readFileSync(
  path.join(__dirname, '../firebase-functions/functions/src/_helpers.js'),
  'utf8'
);
const ATTENDANCE_SRC = fs.readFileSync(
  path.join(__dirname, '../firebase-functions/functions/src/_attendance.js'),
  'utf8'
);

/** 從原始碼抽出一段（以第一行開頭比對，抓到下一個頂層 `\n}` 為止） */
function grab(src, startsWith) {
  const i = src.indexOf(startsWith);
  if (i === -1) throw new Error(`原始碼中找不到：${startsWith}`);
  // 頂層宣告：一直吃到行首只有 "}" 或 "};" 的那行為止
  const rest = src.slice(i);
  const m = rest.match(/^[\s\S]*?\n\};?\n/);
  if (!m) throw new Error(`抓不到區塊結尾：${startsWith}`);
  return m[0];
}

/** 抓單行常數宣告 */
function grabLine(src, startsWith) {
  const line = src.split('\n').find((l) => l.startsWith(startsWith));
  if (!line) throw new Error(`原始碼中找不到單行：${startsWith}`);
  return line + '\n';
}

// ---------------------------------------------------------------- 月份驗證
const monthSrc = [
  grabLine(HELPERS_SRC, 'const TAIPEI_OFFSET_MS'),
  grabLine(HELPERS_SRC, 'const MIN_VALID_MONTH'),
  grab(HELPERS_SRC, 'function maxValidMonth()'),
  grab(HELPERS_SRC, 'function isValidMonth(month)'),
].join('\n');
const { isValidMonth, maxValidMonth } = new Function(
  `${monthSrc}; return { isValidMonth, maxValidMonth };`
)();

// ------------------------------------------------------- 打卡類型 / doc id
const whitelistSrc = [
  grabLine(HELPERS_SRC, 'const VALID_PUNCH_TYPES'),
  grab(HELPERS_SRC, 'function isValidPunchType(type)'),
  grab(HELPERS_SRC, 'function isValidDocId(id)'),
].join('\n');
const { isValidPunchType, isValidDocId } = new Function(
  `${whitelistSrc}; return { isValidPunchType, isValidDocId };`
)();

// -------------------------------------------------------------- 假別白名單
const leaveSrc = [
  grab(HELPERS_SRC, 'const LEAVE_KINDS = {'),
  grabLine(HELPERS_SRC, 'const LEAVE_KIND_ALIASES'),
  grab(HELPERS_SRC, 'function _alias(canonical, values)'),
  HELPERS_SRC.split('\n')
    .filter((l) => l.startsWith('_alias("'))
    .join('\n'),
  grab(HELPERS_SRC, 'function normalizeLeaveKind(raw)'),
  grab(HELPERS_SRC, 'function leaveGroupOf(kind)'),
].join('\n');
const { normalizeLeaveKind, leaveGroupOf, LEAVE_KINDS } = new Function(
  `${leaveSrc}; return { normalizeLeaveKind, leaveGroupOf, LEAVE_KINDS };`
)();

// ------------------------------------------------------------ 打卡冷卻判斷
const cooldownSrc = [
  grabLine(HELPERS_SRC, 'const PUNCH_COOLDOWN_MS'),
  grab(HELPERS_SRC, 'async function checkPunchCooldown('),
].join('\n');
// db / COLLECTIONS / console 以參數注入，不碰 firebase-admin
const makeCheckPunchCooldown = new Function(
  'db',
  'COLLECTIONS',
  'console',
  `${cooldownSrc}; return checkPunchCooldown;`
);

/** 假的 Firestore query builder：回傳指定的 docs */
function fakeDb(docs) {
  const q = {
    where: () => q,
    get: async () => ({ docs: docs.map((d) => ({ data: () => d })) }),
  };
  return { collection: () => q };
}
const silentConsole = { warn() {}, log() {}, error() {} };
const checkPunchCooldown = (docs) =>
  makeCheckPunchCooldown(fakeDb(docs), { ATTENDANCE: 'attendance' }, silentConsole);

/** 產生一筆假 attendance doc（timestamp 用 Firestore Timestamp 介面） */
function rec({ type = '上班', adjustmentType = '', agoMs = 0 }) {
  const ms = Date.now() - agoMs;
  return { type, adjustmentType, timestamp: { toMillis: () => ms } };
}

// -------------------------------------------------------------- parseMonth
const parseMonthSrc = [
  grabLine(ATTENDANCE_SRC, 'const TAIPEI_OFFSET_MS'),
  grab(ATTENDANCE_SRC, 'function parseMonth(monthStr)'),
].join('\n');
const parseMonth = new Function(`${parseMonthSrc}; return parseMonth;`)();

// ============================================================== 測試開始

describe('isValidMonth（B-M1：月份需在 2020-01 ~ 今日+1 月）', () => {
  it('接受本月與下個月', () => {
    const now = new Date(Date.now() + 8 * 3600 * 1000);
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(isValidMonth(thisMonth)).toBe(true);
    expect(isValidMonth(maxValidMonth())).toBe(true);
  });

  it('接受下界 2020-01，拒絕 2019-12', () => {
    expect(isValidMonth('2020-01')).toBe(true);
    expect(isValidMonth('2019-12')).toBe(false);
    expect(isValidMonth('0001-01')).toBe(false);
  });

  it('拒絕超過「今日 + 1 月」的未來月份', () => {
    expect(isValidMonth('9999-12')).toBe(false);
    const y = new Date().getUTCFullYear();
    expect(isValidMonth(`${y + 1}-12`)).toBe(false);
  });

  it('拒絕格式錯誤：月份 00/13、非字串、含 /', () => {
    expect(isValidMonth('2026-00')).toBe(false);
    expect(isValidMonth('2026-13')).toBe(false);
    expect(isValidMonth('2026-1')).toBe(false);
    expect(isValidMonth('2026/01')).toBe(false);
    expect(isValidMonth('2026-01/../x')).toBe(false);
    expect(isValidMonth(202601)).toBe(false);
    expect(isValidMonth(null)).toBe(false);
    expect(isValidMonth(undefined)).toBe(false);
  });

  it('maxValidMonth 永遠是合法的 YYYY-MM 且月份介於 01-12', () => {
    expect(maxValidMonth()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});

describe('parseMonth（B-L16：2026-13 不得靜默算成 2027-01）', () => {
  it('合法月份可解析出台北時區的起訖', () => {
    const r = parseMonth('2026-04');
    expect(r).not.toBeNull();
    // Taipei 2026-04-01 00:00 = UTC 2026-03-31 16:00
    expect(r.start.toISOString()).toBe('2026-03-31T16:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-04-30T16:00:00.000Z');
  });

  it('2026-13 / 2026-00 回 null（原本會進位成 2027-01）', () => {
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('2026-00')).toBeNull();
  });

  it('單位數月份 2026-4 不再被接受（避免與 2026-04 混用）', () => {
    expect(parseMonth('2026-4')).toBeNull();
  });

  it('空值與垃圾字串回 null', () => {
    expect(parseMonth('')).toBeNull();
    expect(parseMonth(null)).toBeNull();
    expect(parseMonth('abcd-ef')).toBeNull();
  });
});

describe('isValidPunchType（B-M5：打卡類型白名單）', () => {
  it('只接受上班 / 下班', () => {
    expect(isValidPunchType('上班')).toBe(true);
    expect(isValidPunchType('下班')).toBe(true);
  });

  it('拒絕請假 / 休假（會讓當日工時歸零）與其他值', () => {
    ['請假', '休假', '系統虛擬卡', 'IN', 'in', '', null, undefined, 0].forEach((v) => {
      expect(isValidPunchType(v)).toBe(false);
    });
  });
});

describe('isValidDocId（B-L9：doc id 字元白名單）', () => {
  it('接受 LINE userId 與 Firestore auto-id 形式', () => {
    expect(isValidDocId('U1234567890abcdef1234567890abcdef')).toBe(true);
    expect(isValidDocId('aBc-123_XYZ')).toBe(true);
  });

  it('拒絕含 / 的值（.doc() 會直接拋錯 500）', () => {
    expect(isValidDocId('a/b')).toBe(false);
    expect(isValidDocId('../../employees/victim')).toBe(false);
    expect(isValidDocId('employees/x/attendance/y')).toBe(false);
  });

  it('拒絕空字串、非字串、超長值', () => {
    expect(isValidDocId('')).toBe(false);
    expect(isValidDocId(null)).toBe(false);
    expect(isValidDocId(undefined)).toBe(false);
    expect(isValidDocId(123)).toBe(false);
    expect(isValidDocId('a'.repeat(129))).toBe(false);
    expect(isValidDocId('a'.repeat(128))).toBe(true);
  });

  it('拒絕含空白與特殊字元', () => {
    ['a b', 'a.b', 'a#b', 'a\nb', '假別'].forEach((v) => {
      expect(isValidDocId(v)).toBe(false);
    });
  });
});

describe('normalizeLeaveKind / leaveGroupOf（B-L11：假別白名單「新舊都收」）', () => {
  it('中文假別原樣通過', () => {
    ['病假', '事假', '其他', '年假', '特休', '補休', '颱風假'].forEach((k) => {
      expect(normalizeLeaveKind(k)).toBe(k);
    });
  });

  it('越南文員工送出的翻譯字串仍可送出假單（相容性關鍵）', () => {
    expect(normalizeLeaveKind('Nghỉ ốm')).toBe('病假');
    expect(normalizeLeaveKind('Nghỉ việc riêng')).toBe('事假');
    expect(normalizeLeaveKind('Khác')).toBe('其他');
    expect(normalizeLeaveKind('Nghỉ phép năm')).toBe('年假');
    expect(normalizeLeaveKind('Nghỉ bù')).toBe('補休');
    expect(normalizeLeaveKind('Nghỉ bão')).toBe('颱風假');
  });

  it('印尼文 / 英文 / 日文的翻譯字串也收', () => {
    expect(normalizeLeaveKind('Izin Sakit')).toBe('病假');
    expect(normalizeLeaveKind('Cuti Tahunan')).toBe('年假');
    expect(normalizeLeaveKind('Sick Leave')).toBe('病假');
    expect(normalizeLeaveKind('Compensatory Leave')).toBe('補休');
    expect(normalizeLeaveKind('病欠')).toBe('病假');
    expect(normalizeLeaveKind('台風休暇')).toBe('颱風假');
  });

  it('新的固定代碼也收（未來前端可改送代碼）', () => {
    expect(normalizeLeaveKind('sick')).toBe('病假');
    expect(normalizeLeaveKind('personal')).toBe('事假');
    expect(normalizeLeaveKind('other')).toBe('其他');
    expect(normalizeLeaveKind('annual')).toBe('年假');
    expect(normalizeLeaveKind('special')).toBe('特休');
    expect(normalizeLeaveKind('compensatory')).toBe('補休');
    expect(normalizeLeaveKind('typhoon')).toBe('颱風假');
  });

  it('大小寫與前後空白不影響比對', () => {
    expect(normalizeLeaveKind('  SICK  ')).toBe('病假');
    expect(normalizeLeaveKind('sick leave')).toBe('病假');
    expect(normalizeLeaveKind('ANNUAL')).toBe('年假');
  });

  it('越南文組合字元（NFD）也能比對到', () => {
    expect(normalizeLeaveKind('Nghỉ ốm'.normalize('NFD'))).toBe('病假');
  });

  it('白名單外的自由文字一律拒絕（原本會直接寫進薪資判斷欄位）', () => {
    ['隨便打的原因', '<script>alert(1)</script>', 'x'.repeat(600), '', null, undefined].forEach(
      (v) => expect(normalizeLeaveKind(v)).toBeNull()
    );
  });

  it('leaveGroupOf 把假別歸到正確群組', () => {
    expect(leaveGroupOf('病假')).toBe('請假');
    expect(leaveGroupOf('事假')).toBe('請假');
    expect(leaveGroupOf('其他')).toBe('請假');
    expect(leaveGroupOf('年假')).toBe('休假');
    expect(leaveGroupOf('特休')).toBe('休假');
    expect(leaveGroupOf('補休')).toBe('休假');
    expect(leaveGroupOf('颱風假')).toBe('休假');
    expect(leaveGroupOf('不存在的假')).toBeNull();
  });

  it('每個正規假別都必定屬於某一群組（白名單與群組表不漂移）', () => {
    const all = Object.values(LEAVE_KINDS).flat();
    all.forEach((k) => expect(leaveGroupOf(k)).not.toBeNull());
    // 兩組假別互斥，反推群組才安全
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('checkPunchCooldown（B-M2：後端 60 秒重複打卡防護）', () => {
  it('沒有任何近期紀錄 → 放行', async () => {
    await expect(checkPunchCooldown([])('U1', '上班')).resolves.toEqual({ ok: true });
  });

  it('10 秒前打過同一種卡 → 擋下並回剩餘秒數', async () => {
    const res = await checkPunchCooldown([rec({ type: '上班', agoMs: 10_000 })])('U1', '上班');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('ERR_PUNCH_COOLDOWN');
    expect(res.params.seconds).toBeGreaterThan(45);
    expect(res.params.seconds).toBeLessThanOrEqual(50);
  });

  it('10 秒前打的是「下班」，現在打「上班」 → 放行（按錯類型要能立刻更正）', async () => {
    const res = await checkPunchCooldown([rec({ type: '下班', agoMs: 10_000 })])('U1', '上班');
    expect(res).toEqual({ ok: true });
  });

  it('61 秒前的同型紀錄已超出冷卻窗 → 放行', async () => {
    const res = await checkPunchCooldown([rec({ type: '上班', agoMs: 61_000 })])('U1', '上班');
    expect(res).toEqual({ ok: true });
  });

  it('補打卡 / 虛擬卡 / 請假記錄不算「剛剛按過按鈕」 → 放行', async () => {
    for (const adjustmentType of ['補打卡', '系統虛擬卡', '系統請假記錄']) {
      const res = await checkPunchCooldown([
        rec({ type: '上班', adjustmentType, agoMs: 5_000 }),
      ])('U1', '上班');
      expect(res).toEqual({ ok: true });
    }
  });

  it('多筆混雜時取最新的同型即時打卡判斷', async () => {
    const res = await checkPunchCooldown([
      rec({ type: '上班', agoMs: 55_000 }),
      rec({ type: '上班', adjustmentType: '補打卡', agoMs: 1_000 }),
      rec({ type: '上班', agoMs: 5_000 }),
    ])('U1', '上班');
    expect(res.ok).toBe(false);
    expect(res.params.seconds).toBeGreaterThan(50); // 以 5 秒前那筆算，而非 55 秒前
  });

  it('沒有 userId → 放行（不阻斷主流程）', async () => {
    await expect(checkPunchCooldown([])('', '上班')).resolves.toEqual({ ok: true });
  });

  it('查詢丟例外時放行（防濫用機制不該擋住正常打卡）', async () => {
    const throwingDb = {
      collection: () => ({
        where() { return this; },
        get: async () => { throw new Error('index not ready'); },
      }),
    };
    const fn = makeCheckPunchCooldown(throwingDb, { ATTENDANCE: 'attendance' }, silentConsole);
    await expect(fn('U1', '上班')).resolves.toEqual({ ok: true });
  });
});
