/**
 * 工時計算 — 補打卡審核狀態過濾（薪資金錢路徑）
 *
 * 鎖住修復：未核准（audit='?'）或已拒絕（audit='x'）的補打卡不得灌入工時，
 * 只有已核准（'v'，含 admin 代補）與一般即時打卡/系統虛擬卡才計入。
 * 對應 js/labor-hours.js _pairShiftRanges 與 firebase-functions .../_attendance.js。
 */

const { _pairShiftRanges, enrichDayWithLaborStats, leaveDeductionUnits } = require('../js/labor-hours.js');

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
