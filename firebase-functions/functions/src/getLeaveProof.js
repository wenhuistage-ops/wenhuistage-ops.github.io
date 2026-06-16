/**
 * getLeaveProof — 按需取得單筆請假紀錄的病假證明照片（base64）
 *
 * 為什麼獨立端點：照片是 ~500KB base64，不放進 getReviewRequest 清單回應
 * （否則 admin 開審核清單就一次拉所有照片，浪費頻寬）。清單只帶 hasProof
 * 旗標，admin 點「查看證明」才呼叫本端點單筆讀取。
 *
 * 權限：admin 可看任何人的；一般員工只能看自己的（ownership 檢查）。
 *
 * 前端：callApifetch({ action: 'getLeaveProof', id })
 * 回傳：成功 { ok:true, photo:'data:image/...;base64,...' }
 *       失敗 'ERR_MISSING_ID' | 'ERR_NOT_FOUND' | 'ERR_NO_PERMISSION' | 'ERR_NO_PROOF'
 */

"use strict";

const { onCall } = require("firebase-functions/v2/https");
const { db, COLLECTIONS, verifySession } = require("./_helpers");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    const id = String(request.data?.id || "").trim();
    if (!id) return { ok: false, code: "ERR_MISSING_ID" };

    const snap = await db.collection(COLLECTIONS.ATTENDANCE).doc(id).get();
    if (!snap.exists) return { ok: false, code: "ERR_NOT_FOUND" };
    const data = snap.data();

    const isAdmin = session.user.dept === "管理員";
    if (!isAdmin && data.userId !== session.user.userId) {
      return { ok: false, code: "ERR_NO_PERMISSION" };
    }
    if (!data.proofPhoto) return { ok: false, code: "ERR_NO_PROOF" };

    console.log(
      `[reads] getLeaveProof id=${id.slice(0, 8)} by=${session.user.userId.slice(0, 8)} reads=1`
    );
    return { ok: true, photo: data.proofPhoto };
  }
);
