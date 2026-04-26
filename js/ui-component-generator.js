/**
 * UI Component Generator - 動態生成常見 UI 元素
 * 用於 P2-3 HTML 結構優化
 */

const UIComponentGenerator = (() => {
  /**
   * 生成 Info Item 卡片（員工信息用）
   * @param {Object} config - 配置對象
   * @param {string} config.icon - Font Awesome 圖標 (e.g., "fa-crown")
   * @param {string} config.label - 標籤文本或 i18n 鍵
   * @param {string} config.value - 顯示值
   * @param {string} config.colorScheme - 顏色方案 (yellow|blue|indigo|green|red)
   * @returns {HTMLElement} Info Item 元素
   */
  function createInfoItem(config) {
    const {
      icon = 'fa-info-circle',
      label = 'Label',
      value = 'N/A',
      colorScheme = 'yellow',
      i18nKey = null
    } = config;

    const colors = {
      yellow: {
        bg: 'from-yellow-50 to-yellow-100 dark:from-gray-800 dark:to-gray-700',
        border: 'border-yellow-500',
        label: 'text-yellow-800 dark:text-yellow-300',
        icon: 'text-yellow-600 dark:text-yellow-400',
        value: 'text-yellow-700 dark:text-yellow-200'
      },
      blue: {
        bg: 'from-blue-50 to-blue-100 dark:from-gray-800 dark:to-gray-700',
        border: 'border-blue-500',
        label: 'text-blue-800 dark:text-blue-300',
        icon: 'text-blue-600 dark:text-blue-400',
        value: 'text-blue-700 dark:text-blue-200'
      },
      indigo: {
        bg: 'from-indigo-50 to-indigo-100 dark:from-gray-800 dark:to-gray-700',
        border: 'border-indigo-500',
        label: 'text-indigo-800 dark:text-indigo-300',
        icon: 'text-indigo-600 dark:text-indigo-400',
        value: 'text-indigo-700 dark:text-indigo-200'
      },
      green: {
        bg: 'from-green-50 to-green-100 dark:from-gray-800 dark:to-gray-700',
        border: 'border-green-500',
        label: 'text-green-800 dark:text-green-300',
        icon: 'text-green-600 dark:text-green-400',
        value: 'text-green-700 dark:text-green-200'
      },
      red: {
        bg: 'from-red-50 to-red-100 dark:from-gray-800 dark:to-gray-700',
        border: 'border-red-500',
        label: 'text-red-800 dark:text-red-300',
        icon: 'text-red-600 dark:text-red-400',
        value: 'text-red-700 dark:text-red-200'
      }
    };

    const scheme = colors[colorScheme] || colors.yellow;
    const div = document.createElement('div');
    // 輕量化：取消大 shadow / 漸層，僅保留左側色條 + 淡背景，與其他卡片風格一致
    div.className = `info-item ${scheme.bg.replace(/from-\S+\s+to-\S+/, '').trim()} bg-gray-50 dark:bg-gray-800 p-3 rounded-lg border-l-4 ${scheme.border}`;

    // label：icon + 文字 拆兩個 <span>，data-i18n 只作用在文字 span，
    // 避免 renderTranslations 把整個 <i>...</i> 也覆蓋掉
    const labelEl = document.createElement('p');
    labelEl.className = `text-xs font-medium ${scheme.label} flex items-center`;
    const iconEl = document.createElement('i');
    iconEl.className = `fas ${icon} mr-2 ${scheme.icon}`;
    const labelTextEl = document.createElement('span');
    if (i18nKey) labelTextEl.setAttribute('data-i18n', i18nKey);
    labelTextEl.textContent = label;
    labelEl.appendChild(iconEl);
    labelEl.appendChild(labelTextEl);

    const valueEl = document.createElement('p');
    valueEl.className = `text-base sm:text-lg font-bold ${scheme.value} mt-1`;
    valueEl.textContent = value;

    div.appendChild(labelEl);
    div.appendChild(valueEl);

    return div;
  }

  /**
   * 生成 Toggle 設置項
   * @param {Object} config - 配置對象
   * @param {string} config.id - 輸入框 ID
   * @param {string} config.label - 標籤文本或 i18n 鍵
   * @param {boolean} config.checked - 初始狀態
   * @param {string} config.colorScheme - 顏色方案 (yellow|green|blue)
   * @param {Function} config.onchange - 變更回調
   * @returns {HTMLElement} Toggle 設置項元素
   */
  function createToggleSetting(config) {
    const {
      id = 'toggle',
      label = 'Setting',
      checked = false,
      colorScheme = 'yellow',
      statusText = { on: '開啟', off: '關閉' },
      i18nKey = null,
      onchange = null
    } = config;

    const colors = {
      yellow: {
        bg: 'from-yellow-50 to-yellow-100 dark:from-gray-800 dark:to-gray-700',
        label: 'text-yellow-800 dark:text-yellow-300',
        checked: 'peer-checked:bg-yellow-600',
        ring: 'peer-focus:ring-yellow-300 dark:peer-focus:ring-yellow-800'
      },
      green: {
        bg: 'from-green-50 to-green-100 dark:from-gray-800 dark:to-gray-700',
        label: 'text-green-800 dark:text-green-300',
        checked: 'peer-checked:bg-green-600',
        ring: 'peer-focus:ring-green-300 dark:peer-focus:ring-green-800'
      },
      blue: {
        bg: 'from-blue-50 to-blue-100 dark:from-gray-800 dark:to-gray-700',
        label: 'text-blue-800 dark:text-blue-300',
        checked: 'peer-checked:bg-blue-600',
        ring: 'peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800'
      }
    };

    const scheme = colors[colorScheme] || colors.yellow;

    const wrapper = document.createElement('div');
    wrapper.className = `flex justify-between items-center p-4 rounded-xl bg-gradient-to-br ${scheme.bg} shadow-md`;

    const labelDiv = document.createElement('label');
    labelDiv.className = `setting-label text-base font-semibold ${scheme.label}`;
    if (i18nKey) {
      labelDiv.setAttribute('data-i18n', i18nKey);
    }
    labelDiv.innerHTML = `${label}:`;

    const toggleWrapper = document.createElement('label');
    toggleWrapper.className = 'relative inline-flex items-center cursor-pointer';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.className = 'sr-only peer';
    checkbox.checked = checked;
    if (onchange) {
      checkbox.addEventListener('change', onchange);
    }

    const toggleDiv = document.createElement('div');
    toggleDiv.className = `w-11 h-6 bg-gray-200 ${scheme.ring} rounded-full peer dark:bg-gray-700 ${scheme.checked} peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600`;

    const statusSpan = document.createElement('span');
    statusSpan.className = 'ms-3 text-sm font-medium text-gray-900 dark:text-gray-300';
    statusSpan.textContent = checked ? statusText.on : statusText.off;
    statusSpan.id = `${id}-status`;

    // 更新狀態文本
    checkbox.addEventListener('change', (e) => {
      statusSpan.textContent = e.target.checked ? statusText.on : statusText.off;
    });

    toggleWrapper.appendChild(checkbox);
    toggleWrapper.appendChild(toggleDiv);
    toggleWrapper.appendChild(statusSpan);

    wrapper.appendChild(labelDiv);
    wrapper.appendChild(toggleWrapper);

    return wrapper;
  }

  /**
   * 生成 Form 輸入組
   * @param {Object} config - 配置對象
   * @param {string} config.id - 輸入框 ID
   * @param {string} config.label - 標籤文本
   * @param {string} config.type - 輸入類型 (text|email|number|range等)
   * @param {string} config.placeholder - 佔位符
   * @param {string} config.value - 初始值
   * @returns {HTMLElement} Form 輸入組元素
   */
  function createFormInput(config) {
    const {
      id = 'input',
      label = 'Label',
      type = 'text',
      placeholder = '',
      value = '',
      i18nKey = null,
      disabled = false,
      required = false
    } = config;

    const wrapper = document.createElement('div');

    const labelEl = document.createElement('label');
    labelEl.htmlFor = id;
    labelEl.className = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';
    if (i18nKey) {
      labelEl.setAttribute('data-i18n', i18nKey);
    }
    labelEl.textContent = label;

    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.className = 'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white';
    if (placeholder) input.placeholder = placeholder;
    if (value) input.value = value;
    if (disabled) input.disabled = true;
    if (required) input.required = true;

    wrapper.appendChild(labelEl);
    wrapper.appendChild(input);

    return wrapper;
  }

  // 公開 API
  return {
    createInfoItem,
    createToggleSetting,
    createFormInput
  };
})();
