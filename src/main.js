/**
 * 應用主入口點
 * 確保所有模塊在同一作用域中加載
 */

// 按順序導入所有模塊
import '../js/config.js';
import '../js/state.js';
import '../js/core.js';
import '../js/app.js';
import '../js/punch.js';
import '../js/ui.js';
import '../js/location.js';
import '../js/admin.js';

console.log('✓ 應用主入口點已加載');
