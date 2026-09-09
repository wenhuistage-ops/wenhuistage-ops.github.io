/**
 * getHolidays — 台灣國定假日表（後端統一抓取並快取）
 *
 * 為什麼要有這支（F-M6）：
 * 薪資的「日別」（國定假日 / 例假 / 休息日 / 工作日）決定加班倍率，而這份判斷
 * 原本完全來自前端直接打第三方網站 api.pin-yi.me，並快取在使用者自己的
 * localStorage。第三方掛掉或改格式時，Excel 薪資會靜默算錯而沒有人會發現。
 *
 * 改成後端抓取後：
 *   - 全公司共用一份快取（Firestore holidays/{year}），第三方只被打極少次
 *   - 第三方掛掉時回傳上一次的資料（stale-while-error），不會突然變成「全年無假日」
 *   - 資料來源集中，日後要改成人工維護或政府開放資料只需動這一支
 *
 * 前端呼叫：callApifetch({ action: 'getHolidays', year: 2026 })
 * 回傳：{ ok: true, year, records: [...], stale?: true } | { ok: false, code }
 */

"use strict";

const { onCall } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { db, CORS_ORIGINS, verifySession } = require("./_helpers");

const SOURCE_URL = (year) => `https://api.pin-yi.me/taiwan-calendar/${year}/`;
// 30 天：足以在年中政府公告補假調整後跟上，又不會頻繁打第三方
const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_YEAR = 2020;

/** 年份必須是合理範圍內的整數，否則會被拿來當 doc id 灌垃圾 */
function isValidYear(y) {
  const n = Number(y);
  if (!Number.isInteger(n)) return false;
  const maxYear = new Date().getUTCFullYear() + 2;
  return n >= MIN_YEAR && n <= maxYear;
}

async function fetchFromSource(year) {
  const res = await fetch(SOURCE_URL(year));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error("payload 不是非空陣列");
  // 只留需要的欄位，避免把整份第三方回應原封不動存進 Firestore
  return data
    .filter((r) => r && r.date_format)
    .map((r) => ({
      date_format: String(r.date_format),
      isHoliday: !!r.isHoliday,
      caption: String(r.caption || ""),
      week_chinese: String(r.week_chinese || ""),
    }));
}

module.exports = onCall(
  { region: "asia-southeast1", cors: CORS_ORIGINS },
  async (request) => {
    const auth = await verifySession(request.data?.sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const year = Number(request.data?.year);
    if (!isValidYear(year)) return { ok: false, code: "ERR_INVALID_YEAR" };

    const ref = db.collection("holidays").doc(String(year));
    let cached = null;
    try {
      const snap = await ref.get();
      if (snap.exists) cached = snap.data();
    } catch (err) {
      console.warn("getHolidays 讀快取失敗:", err?.message);
    }

    const fetchedAt = cached?.fetchedAt?.toMillis?.() ?? cached?.fetchedAt ?? 0;
    const fresh = cached && Array.isArray(cached.records) && (Date.now() - fetchedAt) < REFRESH_AFTER_MS;
    if (fresh) return { ok: true, year, records: cached.records };

    try {
      const records = await fetchFromSource(year);
      await ref.set({
        year,
        records,
        fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        source: SOURCE_URL(year),
      });
      return { ok: true, year, records };
    } catch (err) {
      console.error(`getHolidays ${year} 取來源失敗:`, err?.message);
      // 來源掛掉時寧可回過期資料，也不要讓前端以為全年沒有假日而算錯加班倍率
      if (cached && Array.isArray(cached.records)) {
        return { ok: true, year, records: cached.records, stale: true };
      }
      return { ok: false, code: "ERR_HOLIDAYS_UNAVAILABLE" };
    }
  }
);
