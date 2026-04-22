/**
 * 日曆模塊（Calendar）
 * 統一管理日曆渲染、導航和快取策略
 */

/**
 * 生成日曆網格
 * @param {number} year - 年份
 * @param {number} month - 月份（0-11）
 * @returns {array} - 日曆網格（2D 陣列）
 */
function generateCalendarGrid(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const grid = [];
  let week = new Array(firstDay).fill(null);

  for (let day = 1; day <= daysInMonth; day++) {
    week.push(day);
    if (week.length === 7) {
      grid.push(week);
      week = [];
    }
  }

  if (week.length > 0) {
    week.push(...new Array(7 - week.length).fill(null));
    grid.push(week);
  }

  return grid;
}

/**
 * 格式化月份鍵值
 * @param {Date} date - 日期對象
 * @returns {string} - 格式化的月份鍵值（YYYY-MM）
 */
function formatMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * 渲染員工日曆
 * @param {number} year - 年份
 * @param {number} month - 月份（0-11）
 * @param {object} records - 日期記錄對象 { '2025-04-01': { status: 'present', ... }, ... }
 * @param {HTMLElement} container - 容器元素
 */
function renderCalendar(year, month, records, container) {
  if (!container) return;

  const grid = generateCalendarGrid(year, month);
  const today = new Date();

  container.replaceChildren();

  const weekDays = [t('SUN'), t('MON'), t('TUE'), t('WED'), t('THU'), t('FRI'), t('SAT')];

  // 渲染週日標頭
  const headerRow = document.createElement('div');
  headerRow.className = 'grid grid-cols-7 gap-1 mb-2 font-semibold';
  weekDays.forEach(day => {
    const dayEl = document.createElement('div');
    dayEl.className = 'text-center text-sm';
    dayEl.textContent = day || '日';
    headerRow.appendChild(dayEl);
  });
  container.appendChild(headerRow);

  // 渲染日期網格
  const calendarGrid = document.createElement('div');
  calendarGrid.className = 'grid grid-cols-7 gap-1';

  grid.forEach(week => {
    week.forEach(day => {
      const dayEl = document.createElement('div');
      dayEl.className = 'aspect-square flex items-center justify-center rounded text-sm font-medium cursor-pointer';

      if (!day) {
        dayEl.className += ' bg-gray-100 dark:bg-gray-800';
      } else {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const record = records && records[dateStr];

        // 確定日期狀態顏色
        let statusClass = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800';

        if (record) {
          if (record.status === 'present') {
            statusClass = 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200';
          } else if (record.status === 'absent') {
            statusClass = 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200';
          } else if (record.status === 'leave') {
            statusClass = 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200';
          } else if (record.status === 'holiday') {
            statusClass = 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200';
          } else if (record.status === 'abnormal') {
            statusClass = 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200';
          }
        }

        // 標記今日
        if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
          statusClass += ' border-2 border-indigo-500';
        }

        dayEl.className += ` ${statusClass}`;
        dayEl.textContent = day;
        dayEl.dataset.date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }

      calendarGrid.appendChild(dayEl);
    });
  });

  container.appendChild(calendarGrid);
}

/**
 * 渲染管理員日曆（員工選擇版本）
 * @param {number} year - 年份
 * @param {number} month - 月份（0-11）
 * @param {object} records - 日期記錄對象
 * @param {HTMLElement} container - 容器元素
 */
function renderAdminCalendar(year, month, records, container) {
  // 使用相同的渲染邏輯，但可以添加管理員特有的功能
  renderCalendar(year, month, records, container);
}

/**
 * 處理日曆導航
 * @param {Date} currentDate - 當前日期
 * @param {number} direction - 方向：1（下一月）或 -1（上一月）
 * @returns {Date} - 新的日期
 */
function handleCalendarNavigation(currentDate, direction) {
  const newDate = new Date(currentDate);
  newDate.setMonth(newDate.getMonth() + direction);
  return newDate;
}

/**
 * 預測未來幾個月的鍵值
 * @param {Date} date - 當前日期
 * @param {number} months - 預測月份數
 * @returns {array} - 月份鍵值陣列
 */
function getPredictedMonthKeys(date, months = 3) {
  const keys = [];
  for (let i = 1; i < months; i++) {
    const predictDate = new Date(date.getFullYear(), date.getMonth() + i, 1);
    keys.push(formatMonthKey(predictDate));
  }
  return keys;
}

/**
 * 生成月份標題
 * @param {number} year - 年份
 * @param {number} month - 月份（0-11）
 * @returns {string} - 月份標題（e.g., "2025 年 4 月"）
 */
function generateMonthTitle(year, month) {
  return `${year} 年 ${month + 1} 月`;
}

/**
 * 快取月份數據
 * @param {string} monthKey - 月份鍵值（YYYY-MM）
 * @param {array} data - 月份數據
 */
function cacheMonthData(monthKey, data) {
  cacheManager.set('month', monthKey, data);
}

/**
 * 獲取快取的月份數據
 * @param {string} monthKey - 月份鍵值
 * @returns {array|undefined} - 快取的數據
 */
function getCachedMonthData(monthKey) {
  return cacheManager.get('month', monthKey);
}

/**
 * 清除月份快取
 * @param {string} monthKey - 月份鍵值
 */
function clearMonthCache(monthKey) {
  cacheManager.delete('month', monthKey);
}

/**
 * 清除所有月份快取
 */
function clearAllMonthCache() {
  cacheManager.clear('month');
}


console.log('✓ calendar 模塊已加載');
