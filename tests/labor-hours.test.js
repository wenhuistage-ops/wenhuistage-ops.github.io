/**
 * 工時計算 — 補打卡審核狀態過濾（薪資金錢路徑）
 *
 * 鎖住修復：未核准（audit='?'）或已拒絕（audit='x'）的補打卡不得灌入工時，
 * 只有已核准（'v'，含 admin 代補）與一般即時打卡/系統虛擬卡才計入。
 * 對應 js/labor-hours.js _pairShiftRanges 與 firebase-functions .../_attendance.js。
 */

const { _pairShiftRanges } = require('../js/labor-hours.js');

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
