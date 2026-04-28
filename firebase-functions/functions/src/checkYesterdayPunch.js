/**
 * checkYesterdayPunch — 檢查昨天打卡狀況並透過 LINE 提醒
 *
 * 對應 GS：判斷昨天有無打卡.gs (checkYesterdayPunchAndNotify)
 *
 * 排程：每天 Asia/Taipei 09:00 執行
 *
 * 邏輯：
 *   1. 撈昨天（台灣時區 00:00 ~ 今天 00:00）的所有 attendance 紀錄
 *   2. 按 userId 分組
 *   3. 對每位「啟用中」員工逐一判斷：
 *        - 完全沒打 → PUNCH_ALL_MISS
 *        - 沒「上班」 → PUNCH_IN_MISS
 *        - 沒「下班」 → PUNCH_OUT_MISS
 *        - 都有 → 不發訊息
 *   4. 用 LINE Buttons template 發訊息（含「補打卡」按鈕，連回網站首頁）
 *
 * 多語：依 employees.preferredLanguage 切換訊息與按鈕文字，缺值時退回 zh-TW。
 */

const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  db,
  COLLECTIONS,
  DEFAULT_LINE_REDIRECT_URL,
  LINE_CHANNEL_ACCESS_TOKEN,
} = require("./_helpers");

// 多語訊息字典（直接搬自 GS BROADCAST_TEXT）
const BROADCAST_TEXT = {
  // 情境 1：整天都沒有打卡紀錄
  PUNCH_ALL_MISS: {
    "zh-TW": "⚠️ 您昨天無打卡紀錄。若非休假，請記得補打卡。",
    vi: "⚠️ Bạn không có dữ liệu chấm công hôm qua. Nếu không phải là ngày nghỉ, hãy bổ sung nhé.",
    id: "⚠️ Anda tidak memiliki catatan absensi kemarin. Jika bukan hari libur, harap lengkapi absensi Anda.",
    en: "⚠️ No attendance record found for yesterday. If you weren't on leave, please complete your punch-in/out.",
    ja: "⚠️ 昨日の打刻記録がありません。休暇でない場合は、打刻修正を行ってください。",
    ko: "⚠️ 어제 출퇴근 기록이 없습니다. 휴무가 아니었다면 출퇴근 기록을 보완해 주세요.",
  },
  // 情境 2：只有上班漏打
  PUNCH_IN_MISS: {
    "zh-TW": "⚠️ 您昨天漏打「上班卡」。若非休假，請記得補打卡。",
    vi: "⚠️ Bạn quên chấm công 「Giờ vào」 hôm qua. Nếu không phải là ngày nghỉ, hãy bổ sung nhé.",
    id: "⚠️ Anda lupa absen 「Masuk」 kemarin. Jika bukan hari libur, harap lengkapi absensi Anda.",
    en: "⚠️ You missed your 「Clock-in」 yesterday. If you weren't on leave, please complete it.",
    ja: "⚠️ 昨日の「出勤打刻」が漏れています。休暇でない場合は修正してください。",
    ko: "⚠️ 어제 「출근 기록」이 누락되었습니다. 휴무가 아니었다면 기록을 보완해 주세요.",
  },
  // 情境 3：只有下班漏打
  PUNCH_OUT_MISS: {
    "zh-TW": "⚠️ 您昨天漏打「下班卡」。若非休假，請記得補打卡。",
    vi: "⚠️ Bạn quên chấm công 「Giờ ra」 hôm qua. Nếu không phải là ngày nghỉ, hãy bổ sung nhé.",
    id: "⚠️ Anda lupa absen 「Pulang」 kemarin. Jika bukan hari libur, harap lengkapi absensi Anda.",
    en: "⚠️ You missed your 「Clock-out」 yesterday. If you weren't on leave, please complete it.",
    ja: "⚠️ 昨日の「退勤打刻」が漏れています。休暇でない場合は修正してください。",
    ko: "⚠️ 어제 「퇴근 기록」이 누락되었습니다. 휴무가 아니었다면 기록을 보완해 주세요.",
  },
  // 提醒補卡的按鈕文字
  PUNCH_REPAIR: {
    "zh-TW": "補打卡",
    vi: "Bổ sung công",
    id: "Absensi",
    en: "Fix Punch",
    ja: "打刻修正",
    ko: "출퇴근 수정",
  },
};

function getBroadcastText(code, lang) {
  const item = BROADCAST_TEXT[code];
  if (!item) return "";
  return item[lang] || item["zh-TW"];
}

/**
 * 計算昨天（Asia/Taipei）在 UTC 上的起訖時間
 * 例：執行時刻 = 2026-04-29 09:00 Asia/Taipei (= 01:00 UTC)
 *     回傳 start = 2026-04-27 16:00 UTC (= 04-28 00:00 Taipei)
 *          end   = 2026-04-28 16:00 UTC (= 04-29 00:00 Taipei)
 */
function getYesterdayRangeTaipei() {
  const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
  const now = new Date();
  const taipeiNow = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  const y = taipeiNow.getUTCFullYear();
  const m = taipeiNow.getUTCMonth();
  const d = taipeiNow.getUTCDate();
  const start = new Date(Date.UTC(y, m, d - 1) - TAIPEI_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, d) - TAIPEI_OFFSET_MS);
  return { start, end };
}

/**
 * 發送 LINE Buttons template（含一顆 URI 按鈕）
 * 對應 GS sendLineButtonMessage
 */
async function sendLineButtonMessage({ to, text, buttonLabel, url, accessToken }) {
  if (!accessToken) {
    console.warn("sendLineButtonMessage: LINE_CHANNEL_ACCESS_TOKEN 未設定");
    return { ok: false, code: "TOKEN_MISSING" };
  }
  try {
    const resp = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to,
        messages: [
          {
            type: "template",
            altText: text,
            template: {
              type: "buttons",
              text,
              actions: [{ type: "uri", label: buttonLabel, uri: url }],
            },
          },
        ],
      }),
    });
    if (resp.ok) return { ok: true };
    const body = await resp.text();
    console.warn(`LINE button push 失敗 ${to}: ${resp.status} ${body}`);
    return { ok: false, status: resp.status, body };
  } catch (err) {
    console.error(`LINE button push 例外 ${to}:`, err?.message);
    return { ok: false, error: err?.message };
  }
}

module.exports = onSchedule(
  {
    schedule: "every day 09:00",
    timeZone: "Asia/Taipei",
    region: "asia-southeast1",
    retryCount: 1,
    secrets: [LINE_CHANNEL_ACCESS_TOKEN],
  },
  async () => {
    const { start, end } = getYesterdayRangeTaipei();
    console.log(
      `checkYesterdayPunch: 檢查 ${start.toISOString()} ~ ${end.toISOString()}`
    );

    // 1. 撈昨天的所有打卡（一次 collection query；attendance 量大時建議搭配 timestamp 索引）
    const attendanceSnap = await db
      .collection(COLLECTIONS.ATTENDANCE)
      .where("timestamp", ">=", start)
      .where("timestamp", "<", end)
      .get();

    const recordsByUser = new Map();
    attendanceSnap.docs.forEach((doc) => {
      const data = doc.data();
      const uid = data.userId;
      if (!uid) return;
      if (!recordsByUser.has(uid)) recordsByUser.set(uid, []);
      recordsByUser.get(uid).push(data);
    });

    // 2. 撈所有「啟用中」員工。GS 是直接 iterate sheet；這裡額外把停用 / 未啟用過濾掉，
    //    避免對沒在用的帳號狂發訊息（push 失敗會被 LINE 視為無效用戶累積扣分）。
    const employeesSnap = await db.collection(COLLECTIONS.EMPLOYEES).get();
    const accessToken = LINE_CHANNEL_ACCESS_TOKEN.value();
    const repairUrl = DEFAULT_LINE_REDIRECT_URL;

    const sendTasks = [];
    let allMiss = 0;
    let inMiss = 0;
    let outMiss = 0;
    let normal = 0;
    let skipped = 0;

    employeesSnap.docs.forEach((doc) => {
      const emp = doc.data();
      const userId = emp.userId || doc.id;
      const name = emp.name || "(未命名)";
      const status = emp.status || "啟用";
      const lang = emp.preferredLanguage || "zh-TW";

      // 沒 LINE userId 或非啟用 → 跳過
      if (!userId || status !== "啟用") {
        skipped++;
        return;
      }

      const records = recordsByUser.get(userId) || [];

      if (records.length === 0) {
        allMiss++;
        console.log(`${name} 昨天無打卡`);
        sendTasks.push(
          sendLineButtonMessage({
            to: userId,
            text: getBroadcastText("PUNCH_ALL_MISS", lang),
            buttonLabel: getBroadcastText("PUNCH_REPAIR", lang),
            url: repairUrl,
            accessToken,
          })
        );
        return;
      }

      // 對齊 _attendance.js summarizeByDay 的 type 判斷（容錯 IN/OUT）
      const hasOn = records.some((r) => /上班|IN|in/i.test(r.type || ""));
      const hasOff = records.some((r) => /下班|OUT|out/i.test(r.type || ""));

      if (!hasOn) {
        inMiss++;
        console.log(`${name} 昨天無打上班卡`);
        sendTasks.push(
          sendLineButtonMessage({
            to: userId,
            text: getBroadcastText("PUNCH_IN_MISS", lang),
            buttonLabel: getBroadcastText("PUNCH_REPAIR", lang),
            url: repairUrl,
            accessToken,
          })
        );
      } else if (!hasOff) {
        outMiss++;
        console.log(`${name} 昨天無打下班卡`);
        sendTasks.push(
          sendLineButtonMessage({
            to: userId,
            text: getBroadcastText("PUNCH_OUT_MISS", lang),
            buttonLabel: getBroadcastText("PUNCH_REPAIR", lang),
            url: repairUrl,
            accessToken,
          })
        );
      } else {
        normal++;
      }
    });

    const results = await Promise.all(sendTasks);
    const sendOk = results.filter((r) => r.ok).length;
    const sendFail = results.length - sendOk;

    console.log(
      `checkYesterdayPunch 完成：` +
        `全缺=${allMiss}, 缺上班=${inMiss}, 缺下班=${outMiss}, 正常=${normal}, 略過=${skipped}; ` +
        `LINE 推送 成功=${sendOk}/${results.length}, 失敗=${sendFail}`
    );
  }
);
