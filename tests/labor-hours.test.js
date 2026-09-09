/**
 * 工時計算 — 補打卡審核狀態過濾（薪資金錢路徑）
 *
 * 鎖住修復：未核准（audit='?'）或已拒絕（audit='x'）的補打卡不得灌入工時，
 * 只有已核准（'v'，含 admin 代補）與一般即時打卡/系統虛擬卡才計入。
 * 對應 js/labor-hours.js _pairShiftRanges 與 firebase-functions .../_attendance.js。
 */

const {
  _pairShiftRanges,
  enrichDayWithLaborStats,
  leaveDeductionUnits,
  estimateShiftStart,
  estimateShiftEnd,
  calcWorkHours,
  calcWorkHoursFromShifts,
  aggregateMonthLaborStats,
  monthlyToHourly,
  inferGradeFromSalary,
  calcEmployeeDeductions,
} = require('../js/labor-hours.js');

describe('工時計算 - 補打卡審核狀態過濾', () => {
  const inAt = (time, extra = {}) => ({ time, type: '上班', ...extra });
  const outAt = (time, extra = {}) => ({ time, type: '下班', ...extra });

  test('未核准補打卡的下班不得延長班次', () => {
    const record = [
      inAt('08:00'),
      outAt('12:00'),
      // 員工偷送的補打卡下班（待審核）
      outAt('23:00', { adjustmentType: '補打卡', audit: '?' }),
    ];
    const ranges = _pairShiftRanges(record);
    expect(ranges).toEqual([{ inTime: '08:00', outTime: '12:00' }]);
  });

  test('已拒絕的補打卡一律排除', () => {
    const record = [
      inAt('08:00'),
      outAt('12:00'),
      outAt('23:00', { adjustmentType: '補打卡', audit: 'x' }),
    ];
    expect(_pairShiftRanges(record)).toEqual([{ inTime: '08:00', outTime: '12:00' }]);
  });

  test('已核准補打卡（audit=v，含 admin 代補）正常計入', () => {
    const record = [
      inAt('08:00', { adjustmentType: '補打卡', audit: 'v' }),
      outAt('17:00', { adjustmentType: '補打卡', audit: 'v' }),
    ];
    expect(_pairShiftRanges(record)).toEqual([{ inTime: '08:00', outTime: '17:00' }]);
  });

  test('一般即時打卡（無 adjustmentType）不受影響', () => {
    const record = [inAt('09:00'), outAt('18:00')];
    expect(_pairShiftRanges(record)).toEqual([{ inTime: '09:00', outTime: '18:00' }]);
  });
});

describe('工時計算 - M4 請假為準（已核准請假日不計工時）', () => {
  const breakTimes = [{ name: '午休', start: '12:00', end: '13:00' }];

  test('已核准請假日即使有整天打卡，工時與加班一律為 0', () => {
    const day = {
      date: '2026-07-15', // 平日
      reason: 'STATUS_LEAVE_APPROVED',
      punchInTime: '08:00',
      punchOutTime: '18:00',
      record: [
        { time: '08:00', type: '上班' },
        { time: '18:00', type: '下班' },
      ],
    };
    const { laborStats } = enrichDayWithLaborStats(day, breakTimes);
    expect(laborStats.net).toBe(0);
    expect(laborStats.equivalentHours).toBe(0);
    expect(laborStats.ot1 + laborStats.ot2).toBe(0);
  });

  test('已核准休假日同樣不計工時', () => {
    const day = {
      date: '2026-07-15',
      reason: 'STATUS_VACATION_APPROVED',
      punchInTime: '08:00',
      punchOutTime: '20:00',
      record: [
        { time: '08:00', type: '上班' },
        { time: '20:00', type: '下班' },
      ],
    };
    const { laborStats } = enrichDayWithLaborStats(day, breakTimes);
    expect(laborStats.net).toBe(0);
    expect(laborStats.equivalentHours).toBe(0);
  });

  test('未核准請假（PENDING）仍照打卡計工時（尚未定案）', () => {
    const day = {
      date: '2026-07-15',
      reason: 'STATUS_LEAVE_PENDING',
      punchInTime: '09:00',
      punchOutTime: '18:00',
      record: [
        { time: '09:00', type: '上班' },
        { time: '18:00', type: '下班' },
      ],
    };
    const { laborStats } = enrichDayWithLaborStats(day, breakTimes);
    expect(laborStats.net).toBeGreaterThan(0);
  });
});

describe('推估應到班時間 - 無條件進位到 30 分刻度', () => {
  test('業主指定的三個案例', () => {
    expect(estimateShiftStart('07:55')).toBe('08:00');
    expect(estimateShiftStart('06:45')).toBe('07:00');
    expect(estimateShiftStart('05:15')).toBe('05:30');
  });
  test('已在刻度上不動（避免準時上班反被往後推）', () => {
    expect(estimateShiftStart('08:00')).toBe('08:00');
    expect(estimateShiftStart('08:30')).toBe('08:30');
  });
  test('剛過刻度 1 分鐘 → 進到下一個刻度', () => {
    expect(estimateShiftStart('08:01')).toBe('08:30');
    expect(estimateShiftStart('08:31')).toBe('09:00');
  });
  test('跨日邊界回 24:00 而非 00:00（否則工時暴增一整天）', () => {
    expect(estimateShiftStart('23:45')).toBe('24:00');
    expect(estimateShiftStart('23:30')).toBe('23:30');
  });
  test('格式不正確回 null', () => {
    expect(estimateShiftStart('')).toBeNull();
    expect(estimateShiftStart(null)).toBeNull();
    expect(estimateShiftStart('abc')).toBeNull();
  });
});

describe('推估應下班時間 - 四捨五入到 30 分刻度', () => {
  test('業主指定的加班認定門檻', () => {
    expect(estimateShiftEnd('17:14')).toBe('17:00');   // 未滿 15 分 → 不算加班
    expect(estimateShiftEnd('17:15')).toBe('17:30');   // 滿 15 分 → 0.5 小時
    expect(estimateShiftEnd('17:44')).toBe('17:30');
    expect(estimateShiftEnd('17:45')).toBe('18:00');   // → 1 小時
    expect(estimateShiftEnd('18:14')).toBe('18:00');
    expect(estimateShiftEnd('18:15')).toBe('18:30');   // → 1.5 小時
  });
  test('準點下班不動', () => {
    expect(estimateShiftEnd('17:00')).toBe('17:00');
    expect(estimateShiftEnd('17:30')).toBe('17:30');
  });
  test('格式不正確回 null', () => {
    expect(estimateShiftEnd('')).toBeNull();
    expect(estimateShiftEnd('abc')).toBeNull();
  });
});

describe('推估時間套用到計薪工時（8~17 班、午休 1 小時）', () => {
  // 驗證 net 而非 ot1：net 不依賴日期類型判定，加班時數 = net - 8
  const bt = [{ name: '午休', start: '12:00', end: '13:00' }];
  const net = (inT, outT) => enrichDayWithLaborStats({
    date: '2026-07-15',
    record: [{ time: inT, type: '上班' }, { time: outT, type: '下班' }],
  }, bt).laborStats.net;

  test('17:14 下班 → 8 小時，不算加班', () => {
    expect(net('08:00', '17:14')).toBe(8);
  });
  test('17:15~17:44 下班 → 8.5 小時，加班 0.5', () => {
    expect(net('08:00', '17:15')).toBe(8.5);
    expect(net('08:00', '17:44')).toBe(8.5);
  });
  test('17:45~18:14 下班 → 9 小時，加班 1', () => {
    expect(net('08:00', '17:45')).toBe(9);
    expect(net('08:00', '18:14')).toBe(9);
  });
  test('18:15 下班 → 9.5 小時，加班 1.5', () => {
    expect(net('08:00', '18:15')).toBe(9.5);
  });
  test('早到不多算工時：07:55 進場與 08:00 進場同工時', () => {
    expect(net('07:55', '17:00')).toBe(8);
    expect(net('08:00', '17:00')).toBe(8);
  });
  test('同班別的零頭差異被消除：07:55/17:05 與 08:00/17:00 結果相同', () => {
    expect(net('07:55', '17:05')).toBe(net('08:00', '17:00'));
  });
});

describe('薪資倒扣 - 缺勤/請假扣薪日數（月薪制，日薪=月薪/30）', () => {
  const workday = (record) => ({ date: '2026-07-15', laborStats: { kind: 'workday' }, record });
  const leave = (grp, type, audit = 'v') =>
    ({ adjustmentType: '系統請假記錄', type: grp, location: type, audit });

  test('平日無故缺勤（無出勤、無核准假）→ 扣 1 天', () => {
    expect(leaveDeductionUnits(workday([]))).toBe(1);
  });
  test('已核准病假 → 扣 0.5 天', () => {
    expect(leaveDeductionUnits(workday([leave('請假', '病假')]))).toBe(0.5);
  });
  test('已核准事假 → 扣 1 天', () => {
    expect(leaveDeductionUnits(workday([leave('請假', '事假')]))).toBe(1);
  });
  test('已核准其他請假 → 扣 1 天', () => {
    expect(leaveDeductionUnits(workday([leave('請假', '其他')]))).toBe(1);
  });
  test('已核准年假/特休/補休 → 不扣', () => {
    expect(leaveDeductionUnits(workday([leave('休假', '年假')]))).toBe(0);
    expect(leaveDeductionUnits(workday([leave('休假', '特休')]))).toBe(0);
    expect(leaveDeductionUnits(workday([leave('休假', '補休')]))).toBe(0);
  });
  test('颱風假（天災停班）→ 不扣，填在請假組也不扣', () => {
    expect(leaveDeductionUnits(workday([leave('休假', '颱風假')]))).toBe(0);
    expect(leaveDeductionUnits(workday([leave('請假', '颱風假')]))).toBe(0);
  });
  test('休假組非中文假別（多語系介面提交）→ 仍不扣', () => {
    // option value 取 i18n 翻譯，故日文介面存入的是「台風休暇」而非「颱風假」；
    // 群組欄位由 submitLeave 寫死中文「休假」，扣薪判斷才不受介面語言影響
    expect(leaveDeductionUnits(workday([leave('休假', '台風休暇')]))).toBe(0);
    expect(leaveDeductionUnits(workday([leave('休假', 'Annual Leave')]))).toBe(0);
  });
  test('未核准病假（PENDING）不算已核准 → 視同曠職扣 1 天', () => {
    expect(leaveDeductionUnits(workday([leave('請假', '病假', '?')]))).toBe(1);
  });
  test('有實際出勤 → 不扣', () => {
    expect(leaveDeductionUnits(workday([
      { time: '09:00', type: '上班' }, { time: '18:00', type: '下班' },
    ]))).toBe(0);
  });
  test('未核准補卡不算出勤 → 仍扣 1 天', () => {
    expect(leaveDeductionUnits(workday([
      { time: '09:00', type: '上班', adjustmentType: '補打卡', audit: '?' },
    ]))).toBe(1);
  });
  test('休息日/例假日/國定假日不上班 → 不扣（非應上班日）', () => {
    expect(leaveDeductionUnits({ laborStats: { kind: 'rest' }, record: [] })).toBe(0);
    expect(leaveDeductionUnits({ laborStats: { kind: 'regular' }, record: [] })).toBe(0);
    expect(leaveDeductionUnits({ laborStats: { kind: 'public' }, record: [] })).toBe(0);
  });
});

// ============================================================================
// 以下為 2026-09-09 補上的薪資核心函式測試（金錢路徑）
//
// 寫法約定 —— 一律「行為測試」：只給輸入、驗輸出，不碰內部常數名稱與實作細節。
//   - 倍率（1.34 / 1.67 / 2.67）透過 equivalentHours 的結果間接鎖定，
//     不 import 常數物件，因此把常數重構成具名物件不會影響本檔。
//   - 級距表、費率同理，只驗 inferGradeFromSalary / calcEmployeeDeductions 的回傳值。
//   - _toMinutes 與 _overlapMinutes 未 export，改由 calcWorkHours 的可觀察行為覆蓋
//     （時間字串解析、休息時段重疊扣除），見對應 describe。
// ============================================================================

/** 固定日別，避免測試結果隨「這個日期今年是星期幾」漂移 */
const withDayKind = (kind) => {
  beforeEach(() => { window.getDayKind = () => ({ kind }); });
  afterEach(() => { delete window.getDayKind; });
};

const BREAK_1H = [{ name: '午休', start: '12:00', end: '13:00' }];
const shift = (date, inT, outT) => ({
  date,
  punchInTime: inT,
  punchOutTime: outT,
  record: [{ time: inT, type: '上班' }, { time: outT, type: '下班' }],
});
const statsOf = (date, inT, outT, breaks = BREAK_1H) =>
  enrichDayWithLaborStats(shift(date, inT, outT), breaks).laborStats;

describe('calcWorkHours - 總工時 / 淨工時', () => {
  test('平日正常班 08:00–17:00 扣 1 小時午休 → 總 9 淨 8', () => {
    expect(calcWorkHours('08:00', '17:00', BREAK_1H)).toEqual({ gross: 9, net: 8 });
  });

  test('沒有休息時段時淨工時等於總工時', () => {
    expect(calcWorkHours('08:00', '17:00', [])).toEqual({ gross: 9, net: 9 });
    expect(calcWorkHours('08:00', '17:00', undefined)).toEqual({ gross: 9, net: 9 });
  });

  test('下班不晚於上班（含跨日班）一律回 0 —— 目前不支援跨午夜', () => {
    // 已知限制：22:00 上班、隔天 06:00 下班會被判成 outMin <= inMin。
    // 若日後支援跨日班，這條預期要一起改。
    expect(calcWorkHours('22:00', '06:00', BREAK_1H)).toEqual({ gross: 0, net: 0 });
    expect(calcWorkHours('08:00', '08:00', BREAK_1H)).toEqual({ gross: 0, net: 0 });
  });

  test('休息時段扣光整段班時淨工時為 0，不會變負數', () => {
    expect(calcWorkHours('12:00', '13:00', BREAK_1H)).toEqual({ gross: 1, net: 0 });
  });
});

describe('calcWorkHours - 時間字串解析（涵蓋 _toMinutes）', () => {
  test('無法解析的時間回 0 工時', () => {
    expect(calcWorkHours('abc', '17:00', [])).toEqual({ gross: 0, net: 0 });
    expect(calcWorkHours('08:00', 'abc', [])).toEqual({ gross: 0, net: 0 });
    expect(calcWorkHours(null, null, [])).toEqual({ gross: 0, net: 0 });
    expect(calcWorkHours('', '', [])).toEqual({ gross: 0, net: 0 });
  });

  test('容忍帶秒數的時間字串（只取到分）', () => {
    expect(calcWorkHours('08:00:30', '17:00:45', [])).toEqual(calcWorkHours('08:00', '17:00', []));
  });

  test('容忍單位數小時 8:00', () => {
    expect(calcWorkHours('8:00', '17:00', [])).toEqual(calcWorkHours('08:00', '17:00', []));
  });

  test('休息時段的時間字串同樣容忍帶秒', () => {
    expect(calcWorkHours('08:00', '17:00', [{ start: '12:00:00', end: '13:00:00' }]).net).toBe(8);
  });

  test('休息時段欄位缺漏或格式壞 → 跳過該段，不扣工時', () => {
    expect(calcWorkHours('08:00', '17:00', [{ start: null, end: '13:00' }]).net).toBe(9);
    expect(calcWorkHours('08:00', '17:00', [{ start: '12:00', end: undefined }]).net).toBe(9);
    expect(calcWorkHours('08:00', '17:00', [{ start: 'abc', end: '13:00' }]).net).toBe(9);
  });
});

describe('calcWorkHours - 休息時段重疊扣除（涵蓋 _overlapMinutes）', () => {
  test('休息時段完全落在班次外 → 不扣', () => {
    expect(calcWorkHours('08:00', '11:00', BREAK_1H).net).toBe(3);   // 班次早於午休
    expect(calcWorkHours('13:00', '17:00', BREAK_1H).net).toBe(4);   // 班次晚於午休
  });

  test('邊界相接不算重疊：08:00–12:00 遇 12:00–13:00 午休 → 不扣', () => {
    expect(calcWorkHours('08:00', '12:00', BREAK_1H).net).toBe(4);
  });

  test('只扣重疊到的部分：08:00–12:30 遇 12:00–13:00 午休 → 只扣 30 分', () => {
    expect(calcWorkHours('08:00', '12:30', BREAK_1H)).toEqual({ gross: 4.5, net: 4 });
  });

  test('多段休息時段累加扣除', () => {
    const breaks = [
      { name: '午休', start: '12:00', end: '13:00' },
      { name: '下午茶', start: '15:00', end: '15:30' },
    ];
    expect(calcWorkHours('08:00', '18:00', breaks)).toEqual({ gross: 10, net: 8.5 });
  });

  test('起訖顛倒的休息時段被忽略（不會加回工時）', () => {
    expect(calcWorkHours('08:00', '17:00', [{ start: '13:00', end: '12:00' }]).net).toBe(9);
  });
});

describe('calcWorkHoursFromShifts - 逐班計算（雙班日不把班距算成工時）', () => {
  const rec = (...pairs) => pairs.flatMap(([i, o]) => (
    [{ time: i, type: '上班' }, { time: o, type: '下班' }]
  ));

  test('雙班 08–12 / 13–17 → 8 小時，班距 1 小時不計', () => {
    expect(calcWorkHoursFromShifts(rec(['08:00', '12:00'], ['13:00', '17:00']), []))
      .toEqual({ gross: 8, net: 8, shiftCount: 2 });
  });

  test('同一份紀錄用整段法會多算班距 → 兩者刻意不同', () => {
    const byShift = calcWorkHoursFromShifts(rec(['08:00', '12:00'], ['13:00', '17:00']), []);
    const wholeSpan = calcWorkHours('08:00', '17:00', []);
    expect(byShift.net).toBe(8);
    expect(wholeSpan.net).toBe(9);
  });

  test('公司休息時段只扣「落在班次內」的部分', () => {
    // 10:00–14:00 的休息時段：第一班重疊 1h（10–11），第二班重疊 1h（13–14）
    const r = calcWorkHoursFromShifts(
      rec(['08:00', '11:00'], ['13:00', '15:00']), [{ start: '10:00', end: '14:00' }]);
    expect(r).toEqual({ gross: 5, net: 3, shiftCount: 2 });
  });

  test('三班日照樣逐班加總', () => {
    expect(calcWorkHoursFromShifts(
      rec(['08:00', '11:00'], ['13:00', '15:00'], ['19:00', '21:00']), []))
      .toEqual({ gross: 7, net: 7, shiftCount: 3 });
  });

  test('英文 IN / OUT 也能配對', () => {
    expect(calcWorkHoursFromShifts(
      [{ time: '09:00', type: 'IN' }, { time: '18:00', type: 'OUT' }], []))
      .toEqual({ gross: 9, net: 9, shiftCount: 1 });
  });

  test('配不出完整班次時回 null（呼叫端據此 fallback 回整段法）', () => {
    expect(calcWorkHoursFromShifts([{ time: '08:00', type: '上班' }], [])).toBeNull();
    expect(calcWorkHoursFromShifts([], [])).toBeNull();
  });
});

describe('分段工時 - 平日（normal / ot1 1.34 倍 / ot2 1.67 倍）', () => {
  withDayKind('workday');

  test('正常 8 小時：全記 normal，無加班', () => {
    const s = statsOf('2026-07-15', '08:00', '17:00');
    expect(s.kind).toBe('workday');
    expect(s.net).toBe(8);
    expect({ normal: s.normal, ot1: s.ot1, ot2: s.ot2 }).toEqual({ normal: 8, ot1: 0, ot2: 0 });
    expect(s.equivalentHours).toBe(8);
    expect(s.illegalHours).toBe(0);
  });

  test('加班 1 小時：ot1 吃 1 小時 → 等價 8 + 1×1.34 = 9.34', () => {
    const s = statsOf('2026-07-15', '08:00', '18:00');
    expect(s.net).toBe(9);
    expect({ normal: s.normal, ot1: s.ot1, ot2: s.ot2 }).toEqual({ normal: 8, ot1: 1, ot2: 0 });
    expect(s.equivalentHours).toBe(9.34);
  });

  test('加班 3 小時：ot1 封頂 2 小時、其餘進 ot2 → 8 + 2×1.34 + 1×1.67 = 12.35', () => {
    const s = statsOf('2026-07-15', '08:00', '20:00');
    expect(s.net).toBe(11);
    expect({ normal: s.normal, ot1: s.ot1, ot2: s.ot2 }).toEqual({ normal: 8, ot1: 2, ot2: 1 });
    expect(s.equivalentHours).toBe(12.35);
  });

  test('淨工時超過 12 小時 → illegalHours 記超出部分（不影響計薪）', () => {
    const s = statsOf('2026-07-15', '08:00', '22:00');
    expect(s.net).toBe(13);
    expect(s.illegalHours).toBe(1);
    expect({ normal: s.normal, ot1: s.ot1, ot2: s.ot2 }).toEqual({ normal: 8, ot1: 2, ot2: 3 });
  });

  test('平日沒打卡 → 所有段數皆 0', () => {
    const s = enrichDayWithLaborStats({ date: '2026-07-15', record: [] }, BREAK_1H).laborStats;
    expect(s.net).toBe(0);
    expect(s.normal).toBe(0);
    expect(s.equivalentHours).toBe(0);
  });
});

describe('分段工時 - 休息日三段（1.34 / 1.67 / 2.67 倍）', () => {
  withDayKind('rest');

  test('11 小時：前 2 + 中 6 + 後 3 → 2×1.34 + 6×1.67 + 3×2.67 = 20.71', () => {
    const s = statsOf('2026-07-18', '08:00', '20:00');
    expect(s.kind).toBe('rest');
    expect(s.net).toBe(11);
    expect({ a: s.rest_ot1, b: s.rest_ot2, c: s.rest_ot3 }).toEqual({ a: 2, b: 6, c: 3 });
    expect(s.equivalentHours).toBe(20.71);
    expect(s.normal).toBe(0);   // 休息日全部視為加班，不進 normal
  });

  test('短班 3 小時：只填到第二段 → 2×1.34 + 1×1.67 = 4.35', () => {
    const s = statsOf('2026-07-18', '08:00', '11:00');
    expect(s.net).toBe(3);
    expect({ a: s.rest_ot1, b: s.rest_ot2, c: s.rest_ot3 }).toEqual({ a: 2, b: 1, c: 0 });
    expect(s.equivalentHours).toBe(4.35);
  });
});

describe('分段工時 - 國定假日（出勤保證 8 小時）', () => {
  withDayKind('public');

  test('出勤 8 小時 → public_base 8，無加班', () => {
    const s = statsOf('2026-07-15', '08:00', '17:00');
    expect(s.kind).toBe('public');
    expect({ base: s.public_base, ot1: s.public_ot1, ot2: s.public_ot2 })
      .toEqual({ base: 8, ot1: 0, ot2: 0 });
    expect(s.equivalentHours).toBe(8);
  });

  test('出勤 11 小時 → 8 保證 + ot1 2 + ot2 1 = 8 + 2×1.34 + 1×1.67 = 12.35', () => {
    const s = statsOf('2026-07-15', '08:00', '20:00');
    expect({ base: s.public_base, ot1: s.public_ot1, ot2: s.public_ot2 })
      .toEqual({ base: 8, ot1: 2, ot2: 1 });
    expect(s.equivalentHours).toBe(12.35);
  });

  test('國定假日沒出勤 → 不給 8 小時保證', () => {
    const s = enrichDayWithLaborStats({ date: '2026-07-15', record: [] }, BREAK_1H).laborStats;
    expect(s.public_base).toBe(0);
    expect(s.equivalentHours).toBe(0);
  });
});

describe('分段工時 - 例假日（1 日工資 + 補休折現，出勤即違法）', () => {
  withDayKind('regular');

  test('出勤 11 小時 → base 8 + comp 8 + ot 3（實際時數）→ 8 + 8 + 3×2 = 22', () => {
    const s = statsOf('2026-07-19', '08:00', '20:00');
    expect(s.kind).toBe('regular');
    expect({ base: s.regular_base, comp: s.regular_comp, ot: s.regular_ot })
      .toEqual({ base: 8, comp: 8, ot: 3 });
    expect(s.equivalentHours).toBe(22);
  });

  test('例假日只要有出勤，全部淨工時都算違法工時', () => {
    expect(statsOf('2026-07-19', '08:00', '20:00').illegalHours).toBe(11);
  });

  test('例假日沒出勤 → 不給也不違法', () => {
    const s = enrichDayWithLaborStats({ date: '2026-07-19', record: [] }, BREAK_1H).laborStats;
    expect(s.regular_base).toBe(0);
    expect(s.illegalHours).toBe(0);
  });
});

describe('分段工時 - 無 getDayKind 時依星期退路判別', () => {
  // 不 stub window.getDayKind，走 labor-hours.js 內建的星期退路
  test('週六視為休息日、週日視為例假日、平日視為 workday', () => {
    expect(statsOf('2026-07-18', '08:00', '17:00').kind).toBe('rest');     // 2026-07-18 週六
    expect(statsOf('2026-07-19', '08:00', '17:00').kind).toBe('regular');  // 2026-07-19 週日
    expect(statsOf('2026-07-15', '08:00', '17:00').kind).toBe('workday');  // 2026-07-15 週三
  });
});

describe('分段工時 - 跨日班（已知限制）', () => {
  withDayKind('workday');

  test('22:00 上班、06:00 下班目前算不出工時', () => {
    // 現行行為：同一天的 record 依時間字串排序後配不成班，
    // fallback 的整段法也因 out <= in 回 0。日後支援跨日班時要一併改這條。
    const s = statsOf('2026-07-15', '22:00', '06:00');
    expect(s.net).toBe(0);
    expect(s.equivalentHours).toBe(0);
  });
});

describe('aggregateMonthLaborStats - 月度加總', () => {
  withDayKind('workday');

  test('多日各段分別加總，等價時數一併累計', () => {
    const days = [
      enrichDayWithLaborStats(shift('2026-07-15', '08:00', '17:00'), BREAK_1H), // net 8
      enrichDayWithLaborStats(shift('2026-07-16', '08:00', '20:00'), BREAK_1H), // net 11
    ];
    const sum = aggregateMonthLaborStats(days);
    expect(sum.net).toBe(19);
    expect(sum.gross).toBe(21);
    expect(sum.normal).toBe(16);
    expect(sum.ot1).toBe(2);
    expect(sum.ot2).toBe(1);
    expect(sum.equivalentHours).toBe(20.35);   // 8 + 12.35
  });

  test('違法日數以「天」計，不隨時數放大', () => {
    const days = [
      enrichDayWithLaborStats(shift('2026-07-15', '08:00', '17:00'), BREAK_1H), // 合法
      enrichDayWithLaborStats(shift('2026-07-16', '08:00', '23:00'), BREAK_1H), // net 14 → 超 2h
    ];
    const sum = aggregateMonthLaborStats(days);
    expect(sum.illegalHours).toBe(2);
    expect(sum.illegalDays).toBe(1);
  });

  test('空陣列 / null / 沒有 laborStats 的日子都不會炸，且不影響加總', () => {
    expect(aggregateMonthLaborStats([]).net).toBe(0);
    expect(aggregateMonthLaborStats(null).net).toBe(0);
    const oneDay = enrichDayWithLaborStats(shift('2026-07-15', '08:00', '17:00'), BREAK_1H);
    const sum = aggregateMonthLaborStats([oneDay, { date: '2026-07-16' }, null]);
    expect(sum.net).toBe(8);
    expect(sum.normal).toBe(8);
  });
});

describe('monthlyToHourly - 月薪換時薪（÷ 30 ÷ 8 = ÷ 240）', () => {
  test('整除案例', () => {
    expect(monthlyToHourly(36000)).toBe(150);   // 36000 / 240
    expect(monthlyToHourly(24000)).toBe(100);
  });

  test('非整除四捨五入到元', () => {
    expect(monthlyToHourly(29500)).toBe(123);   // 122.92 → 123
    expect(monthlyToHourly(28590)).toBe(119);   // 119.125 → 119
  });

  test('非數字 / 空值 / 負值一律回 0 或負值不另外處理', () => {
    expect(monthlyToHourly(0)).toBe(0);
    expect(monthlyToHourly(null)).toBe(0);
    expect(monthlyToHourly(undefined)).toBe(0);
    expect(monthlyToHourly('abc')).toBe(0);
  });

  test('數字字串可被接受', () => {
    expect(monthlyToHourly('36000')).toBe(150);
  });
});

describe('inferGradeFromSalary - 勞保投保級距推算', () => {
  test('落在某一級距內 → 取「大於等於月薪」的最低那一級', () => {
    expect(inferGradeFromSalary(29500)).toEqual({ grade: 1, salary: 29500 });
    expect(inferGradeFromSalary(29501)).toEqual({ grade: 2, salary: 30300 });
    expect(inferGradeFromSalary(30300)).toEqual({ grade: 2, salary: 30300 });
    expect(inferGradeFromSalary(31000)).toEqual({ grade: 3, salary: 31800 });
  });

  test('低於或等於最低級（基本工資）→ 一律第 1 級', () => {
    expect(inferGradeFromSalary(25000)).toEqual({ grade: 1, salary: 29500 });
    expect(inferGradeFromSalary(0)).toEqual({ grade: 1, salary: 29500 });
    expect(inferGradeFromSalary(-5)).toEqual({ grade: 1, salary: 29500 });
    expect(inferGradeFromSalary(null)).toEqual({ grade: 1, salary: 29500 });
  });

  test('高於最高級 → 封頂在最高級', () => {
    expect(inferGradeFromSalary(45800)).toEqual({ grade: 11, salary: 45800 });
    expect(inferGradeFromSalary(50000)).toEqual({ grade: 11, salary: 45800 });
    expect(inferGradeFromSalary(999999)).toEqual({ grade: 11, salary: 45800 });
  });

  test('回傳的級距薪資單調遞增且涵蓋 11 級', () => {
    const salaries = [0, 30000, 31000, 32000, 34000, 35000, 37000, 39000, 41000, 43000, 45000, 99999]
      .map((s) => inferGradeFromSalary(s));
    const grades = [...new Set(salaries.map((g) => g.grade))];
    expect(grades).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    salaries.forEach((g) => expect(g.salary).toBeGreaterThanOrEqual(29500));
  });
});

describe('calcEmployeeDeductions - 員工自付勞健保與勞退', () => {
  test('本國籍、投保 29,500、未自提勞退', () => {
    // 勞保 11.5% + 就保 1% = 12.5%，員工自付 20% → 2.5%
    // 健保 5.17% × 30% = 1.551%（與官方負擔金額表一致）
    expect(calcEmployeeDeductions(29500, 0))
      .toEqual({ labor: 738, health: 458, pension: 0, total: 1196 });
  });

  test('外籍員工不適用就業保險 → 勞保自付較低，健保相同', () => {
    const tw = calcEmployeeDeductions(29500, 0);
    const fg = calcEmployeeDeductions(29500, 0, { nationality: 'foreign' });
    expect(fg).toEqual({ labor: 679, health: 458, pension: 0, total: 1137 });
    expect(fg.labor).toBeLessThan(tw.labor);
    expect(fg.health).toBe(tw.health);      // 健保不分國籍
  });

  test('勞退自提率照百分比計算並計入合計', () => {
    expect(calcEmployeeDeductions(29500, 6))
      .toEqual({ labor: 738, health: 458, pension: 1770, total: 2966 });
    expect(calcEmployeeDeductions(45800, 3))
      .toEqual({ labor: 1145, health: 710, pension: 1374, total: 3229 });
  });

  test('自提率超出 0–6% 一律夾在範圍內', () => {
    expect(calcEmployeeDeductions(29500, 99)).toEqual(calcEmployeeDeductions(29500, 6));
    expect(calcEmployeeDeductions(29500, -5)).toEqual(calcEmployeeDeductions(29500, 0));
  });

  test('投保薪資為 0 或無效 → 全部 0', () => {
    expect(calcEmployeeDeductions(0, 0)).toEqual({ labor: 0, health: 0, pension: 0, total: 0 });
    expect(calcEmployeeDeductions(null, 3)).toEqual({ labor: 0, health: 0, pension: 0, total: 0 });
  });

  test('未指定國籍時視為本國籍；亂填的國籍同樣走本國籍', () => {
    const base = calcEmployeeDeductions(36300, 0);
    expect(base).toEqual({ labor: 908, health: 563, pension: 0, total: 1471 });
    expect(calcEmployeeDeductions(36300, 0, {})).toEqual(base);
    expect(calcEmployeeDeductions(36300, 0, { nationality: 'martian' })).toEqual(base);
  });

  test('total 永遠等於三項相加', () => {
    [[29500, 0], [45800, 6], [33300, 2], [0, 0]].forEach(([s, p]) => {
      const d = calcEmployeeDeductions(s, p);
      expect(d.total).toBe(d.labor + d.health + d.pension);
    });
  });
});
