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

/**
 * 判斷某日的「假日類型」（對應勞基法分類）
 * @returns {{ kind: 'public'|'regular'|'rest'|'workday', name: string, color: string }}
 *   public  = 國定假日（出勤：1 倍 base + 加班 1.34/1.67）
 *   regular = 例假日（出勤：2 倍 + 補休折現）
 *   rest    = 休息日（出勤：1.34/1.67/2.67）
 *   workday = 一般工作日（normal + 1.34/1.67）
 *
 * 法源：勞基法 §36 §37 §39 + 施行細則 §23
 *
 * ⭐ 關鍵規則：「國定假日落在週末」要回歸原本性質（rest/regular），
 *   國定假日的休假權「遞延」到別的工作日（即「補假日」）
 *
 *   範例（2026/04 連假四天）：
 *   4/3 (五) caption=「補假」      → public（取代 4/4 兒童節）
 *   4/4 (六) caption=「兒童節」    → rest（兒童節已補假到 4/3，此日回歸休息日）
 *   4/5 (日) caption=「清明節」    → regular（清明節已補假到 4/6，此日回歸例假日）
 *   4/6 (一) caption=「補假」      → public（取代 4/5 清明節）
 *
 *   若用「caption 有值就 public」（舊邏輯），4/4 出勤 12h 會少算約 9.34
 *   等價時數的加班費，雇主可能被勞檢罰款。
 *
 * ⚠️ 補班週六（caption='', isHoliday=false, dow=6）：
 *   政府 2025 下半年起改「補假不補班」→ 2026 全年無補班日 → 暫不處理
 */
function getDayKind(dateKey) {
    const name = getHolidayName(dateKey);
    if (!dateKey) return { kind: 'workday', name: '', color: 'gray' };
    const [y, m, d] = String(dateKey).split('-').map(Number);
    if (!y || !m || !d) return { kind: 'workday', name: '', color: 'gray' };
    const dow = new Date(y, m - 1, d).getDay();

    // 1. 補假日：取代被補假的國定假日 → public
    //    判斷：caption 包含「補假」字樣（容錯：可能寫「補假」「補假（兒童節）」等）
    if (name && name.indexOf('補假') >= 0) {
        return { kind: 'public', name, color: 'red' };
    }

    // 2. 國定假日落在週末：休假權已遞延補假，當天回歸原本性質
    //    勞基法施行細則 §23：休假日遇例假/休息日，於其他工作日補休
    if (name && dow === 0) {
        return { kind: 'regular', name, color: 'red' };       // 週日國定 → 例假
    }
    if (name && dow === 6) {
        return { kind: 'rest', name, color: 'orange' };       // 週六國定 → 休息
    }

    // 3. 國定假日落在平日：public
    if (name) {
        return { kind: 'public', name, color: 'red' };
    }

    // 4. 純週末（無國定假日）
    if (dow === 0) return { kind: 'regular', name: '', color: 'red' };
    if (dow === 6) return { kind: 'rest', name: '', color: 'orange' };
    return { kind: 'workday', name: '', color: 'gray' };
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
    window.getDayKind = getDayKind;
}

console.log('✓ holidays-client 模組已加載');

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ensureHolidaysLoaded, isHoliday, getHolidayName, getDayKind };
}
