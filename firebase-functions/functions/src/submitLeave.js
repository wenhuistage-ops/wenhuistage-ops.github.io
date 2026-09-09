/**
 * submitLeave — 員工提交請假 / 休假申請
 * 對應 GS：Handlers.gs handleSubmitLeave
 *
 * 資料模型：寫入 attendance 集合（audit='?'、adjustmentType='系統請假記錄'）
 * 通知：TODO 對接異步通知佇列後觸發
 *
 * 2026-06-10 病假證明照片：
 *   - 前端壓縮成 JPEG base64 data URL（resize ≤1280px + quality 自適應 <~525KB）
 *   - 存在 raw attendance doc 的 proofPhoto 欄位（+ hasProof:true 旗標）
 *   - ⚠️ 刻意「只存 raw doc，不進 attendanceMonthly 聚合」：summarizeByDay 用顯式
 *     欄位映射（不 spread），照片不會洩漏進每次月曆載入都讀的聚合 doc，避免讀取爆量
 *   - admin 審核時透過 getLeaveProof 端點按需單筆讀取照片，不污染清單回應
 */

// 照片大小上限（base64 字元數）。~700,000 chars ≈ 525KB 二進位，
// 保證單 doc 遠低於 Firestore 1MiB 限制（其餘欄位都很小）。
const MAX_PROOF_CHARS = 720000;

const { onCall } = require("firebase-functions/v2/https");
const {
  admin,
  db,
  COLLECTIONS,
  verifySession,
  clampText,
  isReasonableAttendanceDate,
  notifyAdmins,
  normalizeLeaveKind,
  leaveGroupOf,
  formatTaipei,
  LINE_CHANNEL_ACCESS_TOKEN,
  CORS_ORIGINS,
} = require("./_helpers");
const { invalidateMonthlyCacheForDate, applyEventToMonthly } = require("./_attendance");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: CORS_ORIGINS,
    secrets: [LINE_CHANNEL_ACCESS_TOKEN],
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { date, type, photo } = request.data || {};
    const reason = clampText(request.data?.reason);
    const note = clampText(request.data?.note);

    if (!date || !type || !reason) {
      // 不帶 msg：前端顯示邏輯是 `res.msg || t(res.code)`，帶中文 msg 會
      // 永遠蓋掉五語系翻譯，外籍員工看不懂
      return { ok: false, code: "ERR_MISSING_PARAMS" };
    }

    // 回傳真實錯誤碼（ERR_SESSION_MISSING/INVALID/EXPIRED、ERR_ACCOUNT_INACTIVE），
    // 與其他端點一致，前端 i18n 才有對應翻譯
    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    const user = session.user;
    const punchDate = new Date(date);
    if (!isReasonableAttendanceDate(punchDate)) {
      return { ok: false, code: "ERR_INVALID_DATE" };
    }

    // 病假證明照片（選填）：驗格式與大小
    let proofPhoto = null;
    if (photo) {
      if (typeof photo !== "string" || !/^data:image\/(jpeg|jpg|png|webp);base64,/.test(photo)) {
        return { ok: false, code: "ERR_INVALID_PHOTO", msg: "照片格式不正確" };
      }
      if (photo.length > MAX_PROOF_CHARS) {
        return { ok: false, code: "ERR_PHOTO_TOO_LARGE", msg: "照片太大，請重新拍攝" };
      }
      proofPhoto = photo;
    }

    // B-L11：假別走白名單並正規化成中文。
    //
    // 原本 reason 是自由文字直接存進 locationName，而薪資倒扣規則（js/labor-hours.js）
    // 只認中文假別 —— 越南籍員工送出的 'Nghỉ ốm' 比不到任何規則，病假不但沒扣半天，
    // 統計也把同一種假拆成五種。type 也沒白名單，任意字串都能寫進 attendance.type。
    //
    // 相容性：normalizeLeaveKind 同時接受中文、五語系翻譯字串與固定代碼，
    // 現有前端（送翻譯後文字）不需改動也能通過。
    const leaveKind = normalizeLeaveKind(reason);
    if (!leaveKind) {
      return { ok: false, code: "ERR_INVALID_LEAVE_TYPE" };
    }
    // 群組由假別反推（兩組假別互斥），確保 type 與 reason 永遠一致 ——
    // 前端傳的 type 只當作沒帶假別時的參考，不能拿來覆寫。
    const typeText = leaveGroupOf(leaveKind);
    if (!typeText) {
      return { ok: false, code: "ERR_INVALID_LEAVE_TYPE" };
    }
    // type 仍檢查一次，擋掉明顯亂送的值（前端送 'leave' / 'vacation'）
    if (!["leave", "vacation", "請假", "休假"].includes(String(type))) {
      return { ok: false, code: "ERR_INVALID_LEAVE_TYPE" };
    }

    const applicationTime = new Date();

    const docData = {
      timestamp: admin.firestore.Timestamp.fromDate(punchDate),
      userId: user.userId,
      dept: user.dept || "",
      name: user.name || "",
      type: typeText,
      coords: `申請時間: ${applicationTime.toISOString()}`,
      // 薪資倒扣規則讀 locationName，故存正規中文假別（不是使用者介面語言的字串）
      locationName: leaveKind,
      reason: leaveKind,
      // 保留使用者實際送出的原字串，方便日後追溯 / 稽核
      leaveKindRaw: reason,
      note: note || "",
      audit: "?",
      adjustmentType: "系統請假記錄",
      applicationTime: admin.firestore.Timestamp.fromDate(applicationTime),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (proofPhoto) {
      // 照片只存 raw doc，不進聚合（summarizeByDay 顯式欄位映射，不會帶出去）
      docData.proofPhoto = proofPhoto;
      docData.hasProof = true;
    }

    const ref = await db.collection(COLLECTIONS.ATTENDANCE).add(docData);
    invalidateMonthlyCacheForDate(punchDate, user.userId);

    // Phase 1 shadow write：同步聚合 attendanceMonthly（請假日所在月）
    try {
      await applyEventToMonthly(user.userId, punchDate);
    } catch (err) {
      console.error(
        `applyEventToMonthly 失敗 user=${user.userId} (submitLeave):`,
        err?.message
      );
    }

    // 異步通知管理員（fire-and-forget，不 await）
    const notifMsg =
      `📋 新${typeText}申請\n` +
      `👤 申請人：${user.name || ""}\n` +
      `📅 日期：${date}\n` +
      `📝 原因：${leaveKind}\n` +
      (note ? `📋 備註：${note}\n` : "") +
      (proofPhoto ? `📎 已附證明照片\n` : "") +
      // U-L11：原本是 UTC 的 toISOString()，管理員看到的申請時間少 8 小時
      `🕒 申請時間：${formatTaipei(applicationTime)}`;
    notifyAdmins(notifMsg, LINE_CHANNEL_ACCESS_TOKEN.value()).catch((err) =>
      console.error("submitLeave notifyAdmins 失敗:", err)
    );

    return {
      ok: true,
      msg: typeText === "請假" ? "請假申請已提交" : "休假申請已提交",
      id: ref.id,
    };
  }
);
