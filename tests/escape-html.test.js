/**
 * escapeHtml：使用者可控文字拼進 innerHTML 前的轉義（js/core.js）
 * 直接從原始檔抽出函式本體測，確保測的是真正上線的那份。
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../js/core.js'), 'utf8');
const fnSrc = src.match(/function escapeHtml\(value\) \{[\s\S]*?\n\}/)[0];
const escapeHtml = new Function(`${fnSrc}; return escapeHtml;`)();

describe('escapeHtml', () => {
  it('轉義 & < > " \' 五個字元', () => {
    expect(escapeHtml(`<b a="x" b='y'>&`)).toBe('&lt;b a=&quot;x&quot; b=&#39;y&#39;&gt;&amp;');
  });

  it('備註裡的假按鈕變成純文字，不會產生真的 button 元素', () => {
    const evil = '<button class="admin-delete-record-btn" data-doc-id="victim">刪除</button>';
    document.body.innerHTML = `<p class="note">${escapeHtml(evil)}</p>`;
    expect(document.querySelector('button')).toBeNull();
    expect(document.querySelector('.note').textContent).toBe(evil);
  });

  it('請假原因裡的 <style>/<a> 不會被當成標籤', () => {
    document.body.innerHTML = `<span>${escapeHtml('<style>body{display:none}</style><a href="https://evil">x</a>')}</span>`;
    expect(document.querySelector('style, a')).toBeNull();
  });

  it('null / undefined 變空字串，數字與一般文字原樣', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml('病假（發燒）')).toBe('病假（發燒）');
  });
});
