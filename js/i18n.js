let currentLang = localStorage.getItem("lang");
let translations = {};

// 初始化語言：localStorage > 瀏覽器 > 預設
if (!currentLang) {
  const browserLang = navigator.language || navigator.userLanguage;
  if (browserLang.startsWith("zh")) {
    currentLang = "zh-TW";
  } else if (browserLang.startsWith("ja")) {
    currentLang = "ja-JP";
  }
  else if (browserLang.startsWith("vi")) {
    currentLang = "vi";
  }
  else if (browserLang.startsWith("id")) {
    currentLang = "id";
  }
  else {
    currentLang = "en-US"; // 預設英文
  }
  localStorage.setItem("lang", currentLang);
}

console.log("初始語言:", currentLang);

/**
 * 載入語系 JSON
 */
async function loadTranslations(lang = currentLang) {
  console.log("開始載入語系:", lang);
  try {
    const res = await fetch(`/i18n/${lang}.json`);
    if (!res.ok) throw new Error(`HTTP 錯誤: ${res.status}`);
    translations = await res.json();
    currentLang = lang;
    localStorage.setItem("lang", lang);
    console.log("語系載入成功:", lang);
  } catch (err) {
    console.error("載入語系失敗:", err);
  }
}

/**
 * 翻譯函式
 * @param {string} code - 翻譯 key
 * @param {object} params - 參數 (可選)
 */
function t(code, params = {}) {
  let text = translations[code] || code;
  for (const key in params) {
    text = text.replace(`{${key}}`, params[key]);
  }
  return text;
}
