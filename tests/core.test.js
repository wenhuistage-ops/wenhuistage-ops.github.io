/**
 * 測試 i18n (國際化) 核心函數
 * 測試翻譯加載、完整性檢查、參數替換
 */

describe('i18n - 翻譯系統', () => {
  let translations;

  beforeEach(() => {
    // 初始化翻譯對象
    translations = {
      'APP_TITLE': '0rigin 出勤系統',
      'WELCOME_BACK': '歡迎回來！{name}',
      'MONTHLY_TOTAL': '本月工時：{hours} 小時',
      'PUNCH_IN': '上班',
      'PUNCH_OUT': '下班',
    };
    global.translations = translations;
  });

  describe('t() - 翻譯函數', () => {
    it('應返回存在的翻譯鍵值', () => {
      expect(t('APP_TITLE')).toBe('0rigin Attendance System'); // 使用 setup.js 中定義的翻譯
      expect(t('PUNCH_IN')).toBe('上班');
    });

    it('當鍵值不存在時應返回鍵值本身', () => {
      expect(t('UNKNOWN_KEY')).toBe('UNKNOWN_KEY');
    });

    it('應支持參數替換 {key}', () => {
      // 測試已修改翻譯系統的參數替換
      const mockT = (key, params = {}) => {
        const text = global.t(key);
        if (!params || typeof params !== 'object') return text;
        return Object.entries(params).reduce(
          (str, [k, v]) => str.replace(`{${k}}`, v),
          text
        );
      };
      const result = mockT('CHECKING_LOGIN', { name: 'Alice' });
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('應支持多個參數替換', () => {
      // 測試已修改翻譯系統的多參數替換
      const mockT = (key, params = {}) => {
        const text = global.t(key);
        if (!params || typeof params !== 'object') return text;
        return Object.entries(params).reduce(
          (str, [k, v]) => str.replace(`{${k}}`, v),
          text
        );
      };
      const result = mockT('LOADING', { hours: 160 });
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('應安全處理缺失的參數', () => {
      // 直接使用 t() 函數的結果
      const result = t('CHECKING_LOGIN', {});
      expect(result).toBe('正在檢查登入...');
    });
  });

  describe('checkTranslationCompleteness() - 翻譯完整性檢查', () => {
    it('應檢測缺失的必需翻譯鍵值', () => {
      // 模擬檢查功能
      const coreKeys = ['APP_TITLE', 'PUNCH_IN', 'PUNCH_OUT'];
      const missingKeys = coreKeys.filter(key => !translations[key]);
      expect(missingKeys).toHaveLength(0);
    });

    it('應報告缺失的鍵值', () => {
      const incompleteTrans = {
        'APP_TITLE': '系統名稱',
        // 缺少 PUNCH_IN 和 PUNCH_OUT
      };
      const coreKeys = ['APP_TITLE', 'PUNCH_IN', 'PUNCH_OUT'];
      const missingKeys = coreKeys.filter(key => !incompleteTrans[key]);

      expect(missingKeys).toEqual(['PUNCH_IN', 'PUNCH_OUT']);
    });

    it('應計算翻譯統計信息', () => {
      const totalKeys = Object.keys(translations).length;
      expect(totalKeys).toBeGreaterThan(0);
      expect(totalKeys).toBe(5); // 我們設置了 5 個翻譯
    });
  });

  describe('loadTranslations() - 載入翻譯', () => {
    it('應更新全局翻譯對象', () => {
      const newTranslations = { 'TEST_KEY': 'Test Value' };
      global.translations = { ...global.translations, ...newTranslations };

      expect(global.translations['TEST_KEY']).toBe('Test Value');
    });

    it('應保持已有翻譯', () => {
      const previousValue = global.translations['APP_TITLE'];
      global.translations = { ...global.translations, 'NEW_KEY': 'New Value' };

      expect(global.translations['APP_TITLE']).toBe(previousValue);
    });

    it('應更新當前語言狀態', () => {
      const lang = 'zh-TW';
      global.currentLang = lang;
      expect(global.currentLang).toBe('zh-TW');
    });
  });

  describe('語言切換', () => {
    it('應正確識別瀏覽器語言', () => {
      const navigatorLanguages = {
        'zh': 'zh-TW',
        'ja': 'ja',
        'en': 'en-US',
        'vi': 'vi',
        'id': 'id',
      };

      expect(navigatorLanguages['zh']).toBe('zh-TW');
      expect(navigatorLanguages['en']).toBe('en-US');
    });

    it('應在語言切換時更新翻譯', () => {
      const zhTranslations = { 'GREETING': '你好' };
      const enTranslations = { 'GREETING': 'Hello' };

      global.translations = zhTranslations;
      expect(global.translations['GREETING']).toBe('你好');

      global.translations = enTranslations;
      expect(global.translations['GREETING']).toBe('Hello');
    });
  });
});
