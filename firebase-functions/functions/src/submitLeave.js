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
  notifyAdmins,
  LINE_CHANNEL_ACCESS_TOKEN,
} = require("./_helpers");
const { invalidateMonthlyCacheForDate, applyEventToMonthly } = require("./_attendance");

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
    secrets: [LINE_CHANNEL_ACCESS_TOKEN],
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const { date, type, photo } = request.data || {};
    const reason = clampText(request.data?.reason);
    const note = clampText(request.data?.note);

    if (!date || !type || !reason) {
      return { ok: false, code: "ERR_MISSING_PARAMS", msg: "缺少必要參數" };
    }

    // 回傳真實錯誤碼（ERR_SESSION_MISSING/INVALID/EXPIRED、ERR_ACCOUNT_INACTIVE），
    // 與其他端點一致，前端 i18n 才有對應翻譯
    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    const user = session.user;
    const punchDate = new Date(date);
    if (isNaN(punchDate.getTime())) {
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

    const applicationTime = new Date();
    const typeText = type === "leave" ? "請假" : "休假";

    const docData = {
      timestamp: admin.firestore.Timestamp.fromDate(punchDate),
      userId: user.userId,
      dept: user.dept || "",
      name: user.name || "",
      type: typeText,
      coords: `申請時間: ${applicationTime.toISOString()}`,
      locationName: reason, // GS 版把原因存在地點欄位；此處欄位同
      reason,
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
      `📝 原因：${reason}\n` +
      (note ? `📋 備註：${note}\n` : "") +
      (proofPhoto ? `📎 已附證明照片\n` : "") +
      `🕒 申請時間：${applicationTime.toISOString()}`;
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
