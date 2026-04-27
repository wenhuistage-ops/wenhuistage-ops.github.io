/**
 * 週工時長條圖
 *
 * 依「點擊的日期」推算所在週（週日 ~ 週六），
 * 畫出 7 天的工時長條圖，並標示選中那一天。
 *
 * 使用：
 *   renderWeeklyChart(container, records, selectedDateKey, mode);
 *
 * 參數：
 *   container        — 卡片容器 element（會被覆寫）
 *   records          — 已排好的 dailyStatus 陣列：
 *                      [{ date: 'YYYY-MM-DD', hours, punchInTime, punchOutTime, ... }]
 *   selectedDateKey  — 'YYYY-MM-DD'，決定所屬週與高亮色
 *   mode             — 'normal' | 'overtime' | 'rest' | 'total'
 *                      | 'plain_ot' | 'rest_total' | 'public_total' | 'regular_total'
 *
 * 模式換算（標準工時 8 小時）：
 *   total          = hours
 *   normal         = min(hours, 8)
 *   overtime       = max(hours - 8, 0)
 *   rest           = punchOutTime - punchInTime - hours （以分鐘為單位估算，缺值回 0）
 *
 * Phase L6：勞基法分段（依賴 enriched dailyStatus 的 laborStats，由 admin.js
 * 呼叫 loadEnrichedMonthData 產生；個人 view 仍是 raw → 這 4 個 mode 顯示 0）
 *   plain_ot       = laborStats.ot1 + ot2                 （平日加班）
 *   rest_total     = rest_ot1 + rest_ot2 + rest_ot3        （休息日總工時）
 *   public_total   = public_base + public_ot1 + public_ot2 （國定假日總工時）
 *   regular_total  = regular_base + regular_comp + regular_ot * 2 （例假日工資 + 補休 + 逾 8h × 2 倍）
 */

// STANDARD_HOURS 由先載入的 labor-hours.js 宣告於全域，這裡直接使用。

function _toDate(key) {
    // 'YYYY-MM-DD' → 當地 Date
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function _formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function _weekOf(dateKey) {
    // 回傳該週的 7 個 dateKey（週日為起始）
    const d = _toDate(dateKey);
    const dow = d.getDay(); // 0=Sun
    const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
    const days = [];
    for (let i = 0; i < 7; i++) {
        const dt = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
        days.push(_formatDateKey(dt));
    }
    return days;
}

function _restHours(rec) {
    // 修復：原邏輯用 rec.hours（=後端 punchOut-punchIn，不扣休息）→ span - hours = 0 永遠
    // 改用 enriched laborStats: rest = gross - net（扣掉的休息分鐘）
    if (!rec) return 0;
    const s = rec.laborStats;
    if (s && typeof s.gross === 'number' && typeof s.net === 'number') {
        return Math.max(0, Math.round((s.gross - s.net) * 100) / 100);
    }
    // Fallback：沒 enriched 時用「公司休息時段重疊」自算
    if (!rec.punchInTime || !rec.punchOutTime) return 0;
    const toMin = (str) => {
        const m = String(str).match(/^(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return Number(m[1]) * 60 + Number(m[2]);
    };
    const inM = toMin(rec.punchInTime);
    const outM = toMin(rec.punchOutTime);
    if (inM == null || outM == null || outM <= inM) return 0;
    const breaks = (typeof window !== 'undefined' && typeof window.getCachedBreakTimes === 'function')
        ? window.getCachedBreakTimes() : [];
    let total = 0;
    for (const b of (breaks || [])) {
        const bs = toMin(b.start);
        const be = toMin(b.end);
        if (bs == null || be == null || be <= bs) continue;
        total += Math.max(0, Math.min(outM, be) - Math.max(inM, bs));
    }
    return Math.round((total / 60) * 100) / 100;
}

function _hoursForMode(rec, mode) {
    const h = Number((rec && rec.hours) || 0);
    // Phase L6：勞基法分段（依賴 enriched dailyStatus 的 laborStats）
    const s = rec && rec.laborStats;
    const net = s ? Number(s.net || 0) : h;  // 淨工時（已扣休息）

    // 設計原則（2026-04-27）：所有 mode 統一顯示「實際工時」（淨工時 / 各段
    // 實際時數），唯一例外是 'equivalent' mode 顯示「等價工時」（依倍率折算，
    // 用於工資計算對應的時數）並在 tip 明確標示。
    switch (mode) {
        case 'overtime': return Math.max(0, h - STANDARD_HOURS);
        case 'normal':   return Math.min(h, STANDARD_HOURS);
        case 'rest':     return _restHours(rec);
        // 平日加班：當日淨工時逾 8h 部分（實際時數，等同 ot1 + ot2）
        case 'plain_ot':
            return s ? Number(s.ot1 || 0) + Number(s.ot2 || 0) : 0;
        // 休息日 / 國定假日 / 例假日：篩出該類日子當天「實際淨工時」
        case 'rest_total':
            return (s && s.kind === 'rest') ? net : 0;
        case 'public_total':
            return (s && s.kind === 'public') ? net : 0;
        case 'regular_total':
            return (s && s.kind === 'regular') ? net : 0;
        // 等價工時：依倍率折算後對應工資的時數（≠ 實際工時，僅供工資估算）
        case 'equivalent':
            return s ? Number(s.equivalentHours || 0) : net;
        case 'total':
        default:         return h;
    }
}

function _modeKey(mode) {
    switch (mode) {
        case 'overtime':      return 'CHART_MODE_OVERTIME';
        case 'rest':          return 'CHART_MODE_REST';
        case 'total':         return 'CHART_MODE_TOTAL';
        case 'plain_ot':      return 'CHART_MODE_PLAIN_OT';
        case 'rest_total':    return 'CHART_MODE_REST_DAY';
        case 'public_total':  return 'CHART_MODE_PUBLIC';
        case 'regular_total': return 'CHART_MODE_REGULAR';
        case 'equivalent':    return 'CHART_MODE_EQUIVALENT';
        case 'normal':
        default:              return 'CHART_MODE_NORMAL';
    }
}

const _WEEK_KEYS = ['WEEK_SUNDAY','WEEK_MONDAY','WEEK_TUESDAY','WEEK_WEDNESDAY','WEEK_THURSDAY','WEEK_FRIDAY','WEEK_SATURDAY'];

function renderWeeklyChart(container, records, selectedDateKey, mode = 'total') {
    if (!container) return;
    const tt = (typeof t === 'function') ? t : (k) => k;

    if (!selectedDateKey) {
        container.innerHTML = `
            <div class="text-center py-8 text-gray-500 dark:text-gray-400">
                <i class="fas fa-mouse-pointer text-2xl mb-2 block"></i>
                <span data-i18n="CHART_HINT">${tt('CHART_HINT')}</span>
            </div>`;
        return;
    }

    // Phase L6：若 records 還沒 enriched，lazy 補 laborStats（用 cache 的 breakTimes）
    // 不破壞原 records，建立 by-date map 時順帶 enrich
    const breakTimes = (typeof window !== 'undefined' && typeof window.getCachedBreakTimes === 'function')
        ? window.getCachedBreakTimes()
        : [];
    const enrichFn = (typeof window !== 'undefined' && typeof window.enrichDayWithLaborStats === 'function')
        ? window.enrichDayWithLaborStats
        : null;

    // 建立 dateKey → record 索引（含 laborStats）
    const byDate = {};
    (records || []).forEach((r) => {
        if (!r || !r.date) return;
        if (!r.laborStats && enrichFn) {
            byDate[r.date] = enrichFn(r, breakTimes);
        } else {
            byDate[r.date] = r;
        }
    });

    const week = _weekOf(selectedDateKey);
    const values = week.map((k) => ({
        date: k,
        hours: _hoursForMode(byDate[k], mode),
        hasData: !!byDate[k],
        weekday: _toDate(k).getDay(),
    }));

    const maxRaw = Math.max(0, ...values.map((v) => v.hours));
    // 軸上限：純加班 / 休息至少 4；其他（含 rest_total / public_total /
    // regular_total 改為「該日淨工時」可達 12h，equivalent 也可能高）至少 10
    const SMALL_TOP_MODES = new Set(['overtime', 'rest', 'plain_ot']);
    const minTop = SMALL_TOP_MODES.has(mode) ? 4 : 10;
    const top = Math.max(minTop, Math.ceil(maxRaw + 0.5));

    // mode 切換用下拉選單（取代原本 8 顆 pill）+ optgroup 分三組：
    // 1. 淨工時組：實際工時相關（總/正常/加班/休息）
    // 2. 勞基法分段組：各類日子的「實際淨工時」（不再有等價折算）
    // 3. 等價工時組：唯一一個 mode，明確標示為「依倍率折算」
    //
    // 設計原則：UI 預設顯示「實際工時」，等價工時必須使用者主動切換進去
    // 才會看到，並在 tip 明確說明計算規則。
    const NET_MODES = [
        { id: 'total',          key: 'CHART_MODE_TOTAL',         tipKey: 'CHART_TIP_NET' },
        { id: 'normal',         key: 'CHART_MODE_NORMAL',        tipKey: 'CHART_TIP_NET' },
        { id: 'overtime',       key: 'CHART_MODE_OVERTIME',      tipKey: 'CHART_TIP_NET' },
        { id: 'rest',           key: 'CHART_MODE_REST',          tipKey: 'CHART_TIP_BREAK' },
    ];
    const LABOR_MODES = [
        { id: 'plain_ot',       key: 'CHART_MODE_PLAIN_OT',      tipKey: 'CHART_TIP_ACTUAL' },
        { id: 'rest_total',     key: 'CHART_MODE_REST_DAY',      tipKey: 'CHART_TIP_ACTUAL' },
        { id: 'public_total',   key: 'CHART_MODE_PUBLIC',        tipKey: 'CHART_TIP_ACTUAL' },
        { id: 'regular_total',  key: 'CHART_MODE_REGULAR',       tipKey: 'CHART_TIP_ACTUAL' },
    ];
    const EQUIV_MODES = [
        { id: 'equivalent',     key: 'CHART_MODE_EQUIVALENT',    tipKey: 'CHART_TIP_EQUIV_RULE' },
    ];
    const allModes = [...NET_MODES, ...LABOR_MODES, ...EQUIV_MODES];
    const currentMode = allModes.find((m) => m.id === mode) || allModes[0];
    const isEquiv = currentMode.id === 'equivalent';

    const buildOption = (m) => `<option value="${m.id}"${m.id === mode ? ' selected' : ''}>${tt(m.key)}</option>`;
    const tabsHtml = `
        <div class="flex items-center gap-2 flex-wrap">
            <select class="weekly-chart-mode-select px-2 py-1 text-xs font-semibold rounded-md
                          border border-gray-300 dark:border-gray-600
                          bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200
                          focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <optgroup label="${tt('CHART_GROUP_NET')}">
                    ${NET_MODES.map(buildOption).join('')}
                </optgroup>
                <optgroup label="${tt('CHART_GROUP_LABOR')}">
                    ${LABOR_MODES.map(buildOption).join('')}
                </optgroup>
                <optgroup label="${tt('CHART_GROUP_EQUIV')}">
                    ${EQUIV_MODES.map(buildOption).join('')}
                </optgroup>
            </select>
            <span class="text-[11px] weekly-chart-mode-tip ${isEquiv ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-gray-500 dark:text-gray-400'}">
                ${isEquiv ? '⚠️ ' : ''}${tt(currentMode.tipKey)}
            </span>
        </div>
    `;

    // bars
    const barsHtml = values.map((v) => {
        const ratio = top > 0 ? v.hours / top : 0;
        const heightPct = Math.max(0, Math.min(100, ratio * 100));
        const isSel = v.date === selectedDateKey;
        const dayLabel = tt(_WEEK_KEYS[v.weekday]);
        const showVal = v.hours > 0;
        const valLabel = showVal ? `${v.hours.toFixed(1)}h` : (v.hasData ? '0' : '–');
        const dayNum = Number(v.date.slice(-2));
        const barColor = isSel ? '#6366f1' : 'rgba(156, 163, 175, 0.5)';
        const valColor = isSel ? '#6366f1' : '#9ca3af';
        const dayColor = isSel ? '#6366f1' : '#9ca3af';
        const dayWeight = isSel ? '700' : '400';
        // value label 跟著 bar 頂端走（用 absolute + bottom 計算位置）
        // 為了讓 0h 也看得見，給最小 2% 高度的 ghost bar
        const visibleHeight = v.hasData ? Math.max(2, heightPct) : 0;
        return `
        <div class="weekly-chart-col" data-date="${v.date}"
             style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;width:100%;">
            <div class="weekly-chart-bar-wrap" style="position:relative;width:70%;max-width:28px;height:160px;">
                <div style="position:absolute;left:0;right:0;text-align:center;font-size:11px;font-weight:600;color:${valColor};bottom:calc(${visibleHeight}% + 4px);white-space:nowrap;">${valLabel}</div>
                <div style="position:absolute;bottom:0;left:0;right:0;border-top-left-radius:6px;border-top-right-radius:6px;background:${barColor};height:${visibleHeight}%;transition:height .3s ease;${isSel ? 'box-shadow:0 4px 12px rgba(99,102,241,0.35);' : ''}"></div>
            </div>
            <div style="font-size:11px;margin-top:6px;font-weight:${dayWeight};color:${dayColor};">${dayLabel}</div>
            <div style="font-size:11px;font-weight:${dayWeight};color:${dayColor};">${dayNum}</div>
        </div>`;
    }).join('');

    const unit = tt('CHART_HOURS_UNIT') || 'h';
    const titleText = `${tt('WEEKLY_CHART_TITLE')} (${unit})`;
    const periodLabel = `${week[0]} ~ ${week[6]}`;

    container.innerHTML = `
        <div class="flex items-baseline justify-between mb-3">
            <h3 class="text-base font-bold text-gray-800 dark:text-white">
                <span data-i18n="WEEKLY_CHART_TITLE">${tt('WEEKLY_CHART_TITLE')}</span>
                <span class="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1">(${unit})</span>
            </h3>
            <span class="text-xs text-gray-500 dark:text-gray-400">${periodLabel}</span>
        </div>
        <div class="flex flex-wrap gap-1 mb-3">${tabsHtml}</div>
        <div class="weekly-chart-grid grid grid-cols-7 gap-1 sm:gap-2 items-end">${barsHtml}</div>
    `;

    // 模式切換：select change 重新渲染
    const modeSelect = container.querySelector('.weekly-chart-mode-select');
    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            renderWeeklyChart(container, records, selectedDateKey, modeSelect.value);
        });
    }

    // 點 column 也可以切到該日（同週內任一天）
    container.querySelectorAll('.weekly-chart-col').forEach((col) => {
        col.addEventListener('click', () => {
            const newDate = col.dataset.date;
            if (!newDate) return;
            // 切換選中日（同週內任一天）。若同一天則只觸發 event 給外部監聽
            if (newDate !== selectedDateKey) {
                renderWeeklyChart(container, records, newDate, mode);
            }
            // 通知外部（ui.js）同步切換打卡紀錄
            container.dispatchEvent(new CustomEvent('weeklyChart:select', {
                bubbles: true,
                detail: { date: newDate, mode },
            }));
        });
        col.style.cursor = 'pointer';
    });
}

console.log('✓ weekly-chart 模組已加載');

// 顯式暴露到 window 全域（Vite dev mode 下 const 不會自動掛 global）
if (typeof window !== 'undefined') {
    window.renderWeeklyChart = renderWeeklyChart;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderWeeklyChart };
}
