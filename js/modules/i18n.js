/**
 * 國際化模塊（i18n）
 * 集中管理翻譯加載、翻譯函數、DOM 翻譯
 */

/**
 * 加載指定語言的翻譯
 * @param {string} lang - 語言代碼（e.g., 'zh-TW', 'en-US'）
 */
async function loadTranslations(lang) {
  try {
    const res = await fetch(`https://wenhuistage-ops.github.io/i18n/${lang}.json`);
    if (!res.ok) {
      throw new Error(`HTTP 錯誤: ${res.status}`);
    }

    const translationData = await res.json();

    // 使用全局變量保存（向後兼容）
    translations = translationData;
    currentLang = lang;
    localStorage.setItem("lang", lang);

    // 檢查翻譯完整性
    checkTranslationCompleteness(lang);

    // 更新頁面翻譯
    renderTranslations();

    console.log(`✅ 語言 ${lang} 已加載`);
  } catch (err) {
    console.error("載入語系失敗:", err);
  }
}

/**
 * 檢查翻譯的完整性，找出缺失的鍵值
 * @param {string} lang - 語言代碼
 */
function checkTranslationCompleteness(lang) {
  // 定義必須的核心翻譯鍵值
  const coreTranslationKeys = [
    'APP_TITLE', 'SUBTITLE_LOGIN', 'LOGIN_INFO', 'BTN_LOGOIN',
    'BTN_LOGOUT', 'BTN_CANCEL', 'BTN_CONFIRM',
    'PUNCH_SECTION_TITLE', 'PUNCH_SECTION_DESCRIPTION',
    'PUNCH_IN_LABEL', 'PUNCH_OUT_LABEL',
    'TAB_DASHBOARD', 'TAB_MONTHLY', 'TAB_LOCATION', 'TAB_ADMIN'
  ];

  const missingKeys = [];
  coreTranslationKeys.forEach(key => {
    if (!translations[key]) {
      missingKeys.push(key);
    }
  });

  if (missingKeys.length > 0) {
    console.warn(`⚠️ 語言 ${lang} 缺少以下翻譯鍵值:`, missingKeys);
    console.warn(`建議檢查 i18n/${lang}.json 文件`);
  } else {
    console.log(`✅ 語言 ${lang} 的核心翻譯鍵值完整`);
  }

  // 記錄翻譯統計資訊
  const totalKeys = Object.keys(translations).length;
  console.log(`語言 ${lang} 共有 ${totalKeys} 個翻譯鍵值`);
}

/**
 * 翻譯函式 - 獲取指定鍵值的翻譯文本
 * @param {string} code - 翻譯鍵值
 * @param {object} params - 參數替換（e.g., {name: 'Alice'}）
 * @returns {string} - 翻譯後的文本
 */
function t(code, params = {}) {
  let text = translations[code] || code;

  // 檢查並替換參數中的變數
  for (const key in params) {
    // 在替換之前，先翻譯參數的值
    let paramValue = params[key];
    if (paramValue in translations) {
      paramValue = translations[paramValue];
    }

    text = text.replace(`{${key}}`, paramValue);
  }

  return text;
}

/**
 * 在 DOM 中渲染翻譯
 * 支持兩種方式：
 * 1. [data-i18n="KEY"] - 靜態翻譯
 * 2. [data-i18n-key="KEY"] - 動態翻譯
 * @param {HTMLElement} container - 容器元素，默認為 document
 */
function renderTranslations(container = document) {
  // 翻譯網頁標題（只在整頁翻譯時執行）
  if (container === document) {
    document.title = t("APP_TITLE");
  }

  // 處理靜態內容：[data-i18n]
  const elementsToTranslate = container.querySelectorAll('[data-i18n]');
  elementsToTranslate.forEach(element => {
    const key = element.getAttribute('data-i18n');
    const translatedText = t(key);

    // 檢查翻譯結果是否為空字串，或是否回傳了原始鍵值
    if (translatedText !== key) {
      if (element.tagName === 'INPUT') {
        element.placeholder = translatedText;
      } else {
        element.textContent = translatedText;
      }
    }
  });

  // 處理動態內容：[data-i18n-key]
  const dynamicElements = container.querySelectorAll('[data-i18n-key]');
  dynamicElements.forEach(element => {
    const key = element.getAttribute('data-i18n-key');
    if (key) {
      const translatedText = t(key);

      // 只有當翻譯結果不是原始鍵值時才進行更新
      if (translatedText !== key) {
        element.textContent = translatedText;
      }
    }
  });
}

/**
 * 切換語言
 * @param {string} lang - 目標語言代碼
 */
async function switchLanguage(lang) {
  if (lang !== currentLang) {
    await loadTranslations(lang);
  }
}

// 導出
export {
  loadTranslations,
  checkTranslationCompleteness,
  t,
  renderTranslations,
  switchLanguage
};

console.log('✓ i18n 模塊已加載');
