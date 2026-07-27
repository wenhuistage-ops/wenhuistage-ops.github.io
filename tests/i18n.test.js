/**
 * 測試 i18n 模組的真實 t() 函式
 * 涵蓋基本翻譯、參數替換、舊版 GAS 錯誤字串向後相容解析
 */

const { t, renderTranslations } = require('../js/modules/i18n');

describe('i18n - t() 真實函式', () => {
  beforeEach(() => {
    global.translations = {
      WELCOME: '歡迎 {name}',
      ERR_OUT_OF_RANGE_WITH_DISTANCE:
        '❌ 距離「{location}」還有 {distance}m，超出允許範圍 {radius}m',
      ERR_OUT_OF_RANGE: '❌ 不在範圍內',
    };
  });

  describe('基本翻譯', () => {
    it('應替換 {key} 參數', () => {
      expect(t('WELCOME', { name: 'Alice' })).toBe('歡迎 Alice');
    });

    it('找不到鍵時回鍵本身', () => {
      expect(t('UNKNOWN_KEY')).toBe('UNKNOWN_KEY');
    });

    it('無參數時不應變動文字', () => {
      expect(t('ERR_OUT_OF_RANGE')).toBe('❌ 不在範圍內');
    });
  });

  describe('向後相容：舊版 GAS 錯誤字串解析', () => {
    it('應解析 ERR_OUT_OF_RANGE_DISTANCE 完整格式', () => {
      const result = t('ERR_OUT_OF_RANGE_DISTANCE:150m_LOCATION:辦公室_RADIUS:100m');
      expect(result).toBe('❌ 距離「辦公室」還有 150m，超出允許範圍 100m');
    });

    it('應正確替換各參數位置', () => {
      const result = t('ERR_OUT_OF_RANGE_DISTANCE:50m_LOCATION:工地A_RADIUS:30m');
      expect(result).toContain('工地A');
      expect(result).toContain('50m');
      expect(result).toContain('30m');
    });

    it('地點名稱含特殊字元仍可解析（非貪婪匹配）', () => {
      const result = t('ERR_OUT_OF_RANGE_DISTANCE:200m_LOCATION:辦公室 #2_RADIUS:80m');
      expect(result).toContain('辦公室 #2');
      expect(result).toContain('200m');
      expect(result).toContain('80m');
    });

    it('格式不符應回原字串（不誤判）', () => {
      const result = t('ERR_OUT_OF_RANGE_DISTANCE:invalid');
      expect(result).toBe('ERR_OUT_OF_RANGE_DISTANCE:invalid');
    });

    it('純 ERR_OUT_OF_RANGE 不會誤觸發 fallback', () => {
      expect(t('ERR_OUT_OF_RANGE')).toBe('❌ 不在範圍內');
    });
  });

  describe('renderTranslations - DOM 渲染', () => {
    const render = (html) => {
      const box = document.createElement('div');
      box.innerHTML = html;
      renderTranslations(box);
      return box.firstElementChild;
    };

    it('翻譯時應保留元素內的圖示，只換文字', () => {
      global.translations = { TITLE: 'Punch records' };
      const el = render('<h3 data-i18n="TITLE"><i class="fas fa-table"></i>打卡紀錄</h3>');
      expect(el.querySelector('i')).not.toBeNull();
      expect(el.textContent).toContain('Punch records');
      expect(el.textContent).not.toContain('打卡紀錄');
    });

    it('沒有子元素時直接換整段文字', () => {
      global.translations = { BTN: 'Log out' };
      expect(render('<button data-i18n="BTN">登出</button>').textContent).toBe('Log out');
    });

    it('應翻譯 title / aria-label / alt / placeholder 屬性', () => {
      global.translations = { HELP: 'Calculation details', PH: 'Search…' };
      const btn = render('<button data-i18n-title="HELP" data-i18n-aria-label="HELP" title="計算說明" aria-label="計算說明"></button>');
      expect(btn.getAttribute('title')).toBe('Calculation details');
      expect(btn.getAttribute('aria-label')).toBe('Calculation details');
      const input = render('<input data-i18n-placeholder="PH" placeholder="搜尋">');
      expect(input.getAttribute('placeholder')).toBe('Search…');
    });

    it('找不到鍵時不應改動原本的內容與屬性', () => {
      global.translations = {};
      const btn = render('<button data-i18n="NOPE" data-i18n-title="NOPE2" title="計算說明">登出</button>');
      expect(btn.textContent).toBe('登出');
      expect(btn.getAttribute('title')).toBe('計算說明');
    });
  });

  describe('新格式直接走 i18n 字典', () => {
    it('應接受後端分離的 code + params', () => {
      const result = t('ERR_OUT_OF_RANGE_WITH_DISTANCE', {
        location: '倉庫',
        distance: 75,
        radius: 50,
      });
      expect(result).toBe('❌ 距離「倉庫」還有 75m，超出允許範圍 50m');
    });
  });
});
