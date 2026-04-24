/**
 * 國際化模塊（i18n）
 * 集中管理翻譯加載、翻譯函數、DOM 翻譯
 *
 * P2-1 優化：支持翻譯預加載，減少語言切換延遲
 */

// ===================================
// 預加載快取 (P2-1 優化)
// ===================================
const preloadedTranslations = {}; // {lang: {key: value}}

/**
 * 預加載指定語言的翻譯文件到內存
 * 不阻塞主流程，異步執行
 * @param {string[]} langs - 語言代碼數組 (e.g., ['en-US', 'ja'])
 */
async function preloadTranslations(langs = ['en-US', 'ja']) {
  for (const lang of langs) {
    if (preloadedTranslations[lang]) {
      console.log(`⏭️ 語言 ${lang} 已預加載，跳過`);
      continue;
    }

    try {
      console.log(`⏳ 正在預加載語言 ${lang}...`);
      const res = await fetch(`https://wenhuistage-ops.github.io/i18n/${lang}.json`);
      if (!res.ok) {
        throw new Error(`HTTP 錯誤: ${res.status}`);
      }

      const translationData = await res.json();
      preloadedTranslations[lang] = translationData;
      console.log(`✅ 語言 ${lang} 已預加載（${Object.keys(translationData).length} 個鍵值）`);
    } catch (err) {
      console.warn(`⚠️ 預加載語言 ${lang} 失敗:`, err.message);
    }
  }
}

/**
 * 加載指定語言的翻譯
 * 優先使用預加載的快取，否則從網路 fetch
 * @param {string} lang - 語言代碼（e.g., 'zh-TW', 'en-US'）
 */
async function loadTranslations(lang) {
  try {
    let translationData;

    // 📊 優先檢查預加載快取
    if (preloadedTranslations[lang]) {
      console.log(`⚡ 使用預加載的快取語言 ${lang}`);
      translationData = preloadedTranslations[lang];
    } else {
      // 從網路 fetch
      console.log(`🌐 從網路加載語言 ${lang}...`);
      const res = await fetch(`https://wenhuistage-ops.github.io/i18n/${lang}.json`);
      if (!res.ok) {
        throw new Error(`HTTP 錯誤: ${res.status}`);
      }

      translationData = await res.json();

      // 加載後自動存入快取，供後續使用
      preloadedTranslations[lang] = translationData;
    }

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
  // 向後相容：舊版 GAS（DbOperations.gs）會把參數塞進 code 字串：
  // ERR_OUT_OF_RANGE_DISTANCE:150m_LOCATION:辦公室_RADIUS:100m
  // 此處解析後改用乾淨的 ERR_OUT_OF_RANGE_WITH_DISTANCE + params。
  // GAS 重新部署後可移除此 fallback。
  if (typeof code === 'string' && code.startsWith('ERR_OUT_OF_RANGE_DISTANCE:')) {
    const m = code.match(/^ERR_OUT_OF_RANGE_DISTANCE:(\d+)m_LOCATION:(.+?)_RADIUS:(\d+)m$/);
    if (m) {
      return t('ERR_OUT_OF_RANGE_WITH_DISTANCE', {
        distance: m[1],
        location: m[2],
        radius: m[3],
      });
    }
  }

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

// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { t, loadTranslations, switchLanguage, preloadTranslations };
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

console.log('✓ i18n 模塊已加載 (P2-1: 支持翻譯預加載)');
