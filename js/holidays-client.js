/**
 * 台灣國定假日 client
 *
 * 對應原 GS 的「假日表」+ fetchTaiwanHolidaysWithWeek()，
 * 從 https://api.pin-yi.me/taiwan-calendar/{year}/ 抓資料
 * 並 cache 在 localStorage（一年內不再 refetch）。
 *
 * 對外：
 *   await ensureHolidaysLoaded(year)   // 確保該年資料已就緒
 *   isHoliday(dateKey)                  // 同步查詢，'YYYY-MM-DD'
 *   getHolidayName(dateKey)             // 假日名稱（如「開國紀念日」）
 *
 * 設計：
 * - cache key: holidays:{year}    存 fetch 過的原始陣列
 * - cache key: holidays:fetchedAt:{year}  抓取時間戳（毫秒）
 * - 自動 refresh 條件：超過 30 天未更新（涵蓋年中政府公告補假調整）
 * - 失敗 fallback：cache 不在 → 視為「無假日」（月曆仍正常顯示，只是不標紅）
 */

const HOLIDAY_API = (year) => `https://api.pin-yi.me/taiwan-calendar/${year}/`;
const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

// 內存索引：{year: {dateKey: {isHoliday, name}}}
const _index = {};
// 進行中的 fetch promise（避免重複 fetch 同一年）
const _inflight = {};

function _normalize(dateFormat) {
    // '2026/01/01' -> '2026-01-01'
    return String(dateFormat || '').replace(/\//g, '-');
}

function _buildIndex(records) {
    const idx = {};
    (records || []).forEach((r) => {
        const key = _normalize(r.date_format);
        if (!key) return;
        idx[key] = {
            isHoliday: !!r.isHoliday,
            name: r.caption || '',
            weekChinese: r.week_chinese || '',
        };
    });
    return idx;
}

async function _fetchYear(year) {
    const url = HOLIDAY_API(year);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Bad payload');
    return data;
}

async function ensureHolidaysLoaded(year) {
    const y = Number(year);
    if (_index[y]) return _index[y];

    // 先試 cache
    try {
        const cached = localStorage.getItem(`holidays:${y}`);
        const fetchedAt = Number(localStorage.getItem(`holidays:fetchedAt:${y}`) || 0);
        if (cached && (Date.now() - fetchedAt) < REFRESH_AFTER_MS) {
            _index[y] = _buildIndex(JSON.parse(cached));
            return _index[y];
        }
    } catch (_) { /* fall through to network */ }

    // 去重 fetch
    if (!_inflight[y]) {
        _inflight[y] = _fetchYear(y).then((data) => {
            try {
                localStorage.setItem(`holidays:${y}`, JSON.stringify(data));
                localStorage.setItem(`holidays:fetchedAt:${y}`, String(Date.now()));
            } catch (_) { /* quota 滿了也不阻塞 */ }
            _index[y] = _buildIndex(data);
            delete _inflight[y];
            return _index[y];
        }).catch((err) => {
            console.warn(`[holidays] 抓取 ${y} 假日失敗，使用 cache 或空索引：`, err.message);
            // 失敗時：用舊 cache（即使過期），完全沒 cache 就空索引
            try {
                const cached = localStorage.getItem(`holidays:${y}`);
                if (cached) _index[y] = _buildIndex(JSON.parse(cached));
                else _index[y] = {};
            } catch (_) { _index[y] = {}; }
            delete _inflight[y];
            return _index[y];
        });
    }
    return _inflight[y];
}

function isHoliday(dateKey) {
    if (!dateKey) return false;
    const year = Number(String(dateKey).slice(0, 4));
    const idx = _index[year];
    if (!idx) return false; // 尚未載入，視為非假日（呼叫端應先 await ensureHolidaysLoaded）
    const rec = idx[dateKey];
    return !!(rec && rec.isHoliday);
}

function getHolidayName(dateKey) {
    if (!dateKey) return '';
    const year = Number(String(dateKey).slice(0, 4));
    const idx = _index[year];
    if (!idx) return '';
    const rec = idx[dateKey];
    return rec ? rec.name : '';
}

// 模組載入時即同步 hydrate 「今年」與「明年」的 cache（如果有），讓首次月曆 render 不需要 await
try {
    const _now = new Date();
    [_now.getFullYear(), _now.getFullYear() + 1].forEach((y) => {
        const cached = localStorage.getItem(`holidays:${y}`);
        if (cached) _index[y] = _buildIndex(JSON.parse(cached));
    });
} catch (_) { /* ignore */ }

// 暴露給瀏覽器全域（避免被 ui.js 內部 local 變數 shadow）
if (typeof window !== 'undefined') {
    window.ensureHolidaysLoaded = ensureHolidaysLoaded;
    window.isHoliday = isHoliday;
    window.getHolidayName = getHolidayName;
}

console.log('✓ holidays-client 模組已加載');

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ensureHolidaysLoaded, isHoliday, getHolidayName };
}
