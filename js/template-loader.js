/**
 * Template Loader - 處理 HTML 模板克隆和填充
 * 用於減少 HTML 重複，提高可維護性
 */

const TemplateLoader = (() => {
  /**
   * 獲取模板並克隆
   * @param {string} templateId - 模板 ID
   * @returns {DocumentFragment} 克隆的模板片段
   */
  function getTemplate(templateId) {
    const template = document.getElementById(templateId);
    if (!template) {
      console.error(`Template not found: ${templateId}`);
      return null;
    }
    return template.content.cloneNode(true);
  }

  /**
   * 填充模板中的屬性
   * @param {Element} element - DOM 元素
   * @param {Object} data - 填充數據
   * @example
   * fillTemplate(element, {
   *   'id-suffix': 'admin',
   *   'i18n-key': 'TAB_ADMIN',
   *   'text': '管理員',
   *   'class': 'text-white bg-indigo-600'
   * })
   */
  function fillTemplate(element, data) {
    if (!element) return;

    Object.entries(data).forEach(([key, value]) => {
      if (key === 'id-suffix') {
        // 更新所有帶有 data-id-suffix 的元素
        element.querySelectorAll('[data-id-suffix]').forEach(el => {
          const baseId = el.getAttribute('data-id-suffix');
          el.id = `${baseId}-${value}`;
          el.removeAttribute('data-id-suffix');
        });
      } else if (key === 'i18n-key') {
        // 更新國際化屬性
        element.querySelectorAll('[data-i18n]').forEach(el => {
          el.setAttribute('data-i18n', value);
        });
      } else if (key === 'text') {
        // 設定文本內容
        const textElement = element.querySelector('[data-text]');
        if (textElement) {
          textElement.textContent = value;
          textElement.removeAttribute('data-text');
        }
      } else if (key === 'class') {
        // 添加 CSS 類
        const classElement = element.querySelector('[data-class]');
        if (classElement) {
          classElement.setAttribute('class', value);
          classElement.removeAttribute('data-class');
        }
      } else if (key === 'style') {
        // 設定樣式
        const styleElement = element.querySelector('[data-style]');
        if (styleElement) {
          Object.assign(styleElement.style, value);
          styleElement.removeAttribute('data-style');
        }
      } else if (key === 'html') {
        // 設定 HTML 內容（注意 XSS 風險）
        const htmlElement = element.querySelector('[data-html]');
        if (htmlElement) {
          htmlElement.innerHTML = value;
          htmlElement.removeAttribute('data-html');
        }
      } else if (key.startsWith('attr-')) {
        // 設定任意屬性 (attr-name="value")
        const attrName = key.substring(5);
        const attrElement = element.querySelector(`[data-attr-${attrName}]`);
        if (attrElement) {
          attrElement.setAttribute(attrName, value);
          attrElement.removeAttribute(`data-attr-${attrName}`);
        }
      }
    });
  }

  /**
   * 克隆並填充模板
   * @param {string} templateId - 模板 ID
   * @param {Object} data - 填充數據
   * @returns {DocumentFragment} 填充後的模板
   */
  function cloneAndFill(templateId, data = {}) {
    const template = getTemplate(templateId);
    if (!template) return null;

    const fragment = document.importNode(template, true);
    const wrapper = document.createElement('div');
    wrapper.appendChild(fragment);

    fillTemplate(wrapper, data);
    return wrapper.firstElementChild || wrapper;
  }

  /**
   * 批量克隆並填充模板
   * @param {string} templateId - 模板 ID
   * @param {Array} dataArray - 填充數據陣列
   * @returns {Array} 填充後的模板陣列
   */
  function cloneAndFillBatch(templateId, dataArray = []) {
    return dataArray.map(data => cloneAndFill(templateId, data));
  }

  // 公開 API
  return {
    getTemplate,
    fillTemplate,
    cloneAndFill,
    cloneAndFillBatch
  };
})();
