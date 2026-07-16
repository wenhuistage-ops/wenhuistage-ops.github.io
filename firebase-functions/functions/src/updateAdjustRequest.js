/**
 * updateAdjustRequest — 員工修改自己尚未通過的補卡申請
 *
 * 用途：員工在「我的申請」頁面，對 audit='?' 的補卡申請修改 datetime / note。
 *
 * 安全條件（白名單）：
 *   1. attendance.userId === session.user.userId（只能改自己的）
 *   2. attendance.audit === '?'（已核准 'v' / 已退回 'x' 都不允許改）
 *   3. attendance.adjustmentType === '補打卡'（不允許改一般打卡 / 系統虛擬卡 / 請假）
 *
 * 流程：
 *   1. verifySession
 *   2. 讀目標 doc，驗 ownership + audit='?' + adjustmentType='補打卡'
 *   3. update timestamp 與 note（保留 [員工補卡] prefix）
 *   4. 呼叫 applyEventToMonthly 同步聚合
 *
 * 前端呼叫：
 *   callApifetch({ action: 'updateAdjustRequest', id, datetime, note? })
 *
 * 回傳：
 *   成功：{ ok: true, code: 'UPDATE_ADJUST_REQUEST_SUCCESS' }
 *   失敗：{ ok: false, code: 'ERR_NOT_FOUND' | 'ERR_NO_PERMISSION' |
 *           'ERR_ALREADY_REVIEWED' | 'ERR_NOT_ADJUSTMENT' | 'ERR_INVALID_DATETIME' }
 */

"use strict";

const admin = require("firebase-admin");
const { onCall } = require("firebase-functions/v2/https");
const { db, COLLECTIONS, verifySession, clampText, isReasonableAttendanceDate } = require("./_helpers");
const { applyEventToMonthly, invalidateMonthlyCacheForDate } = require("./_attendance");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const session = await verifySession(sessionToken);
    if (!session.ok) return { ok: false, code: session.code };

    const id = String(request.data?.id || "").trim();
    const datetime = request.data?.datetime;
    // 與 punch/adjustPunch/submitLeave 同樣截斷：漏這條路徑就能繞過 clampText
    // 把超長 note 寫進聚合 doc 撐爆 1MiB 上限
    const rawNote = clampText(request.data?.note);

    if (!id) return { ok: false, code: "ERR_MISSING_ID", msg: "缺少申請 id" };
    if (!datetime) return { ok: false, code: "ERR_INVALID_DATETIME", msg: "缺少 datetime" };

    const newDate = new Date(datetime);
    if (!isReasonableAttendanceDate(newDate)) {
      return { ok: false, code: "ERR_INVALID_DATETIME" };
    }

    const ref = db.collection(COLLECTIONS.ATTENDANCE).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return { ok: false, code: "ERR_NOT_FOUND", msg: "申請不存在" };
    }
    const data = snap.data();

    // ① 必須是自己的
    if (data.userId !== session.user.userId) {
      return { ok: false, code: "ERR_NO_PERMISSION", msg: "只能修改自己的補卡申請" };
    }
    // ② 必須仍待審核
    if (data.audit !== "?") {
      return {
        ok: false,
        code: "ERR_ALREADY_REVIEWED",
        msg: "此申請已審核（已核准或已退回），不能再修改",
      };
    }
    // ③ 必須是補打卡（不能改請假 / 一般打卡 / 虛擬卡）
    if (data.adjustmentType !== "補打卡") {
      return {
        ok: false,
        code: "ERR_NOT_ADJUSTMENT",
        msg: "僅能修改 adjustmentType='補打卡' 的紀錄",
      };
    }

    // 保留 [員工補卡] prefix，使用者送過來的 note 是新內容
    const noteWithTag = rawNote
      ? `[員工補卡] ${rawNote}`
      : "[員工補卡]";

    // 同步聚合：先記舊月份 cache invalidate，再 update，再 invalidate 新月份
    const oldPunchDate = data.timestamp?.toDate?.() || data.timestamp;

    await ref.update({
      timestamp: admin.firestore.Timestamp.fromDate(newDate),
      note: noteWithTag,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 失效兩個月份的 cache（舊 + 新）並觸發聚合重算
    if (oldPunchDate) invalidateMonthlyCacheForDate(oldPunchDate, session.user.userId);
    invalidateMonthlyCacheForDate(newDate, session.user.userId);

    try {
      // 2026-06-10 修正：applyEventToMonthly 是「按日」增量重算。
      // 只要新舊日期不是同一天（台北時區），兩天都要重算 —— 否則舊日期的
      // 聚合會殘留已搬走的紀錄（舊版只在「跨月」才重算舊日期，同月改日 /
      // 跨年同月都會漏）。
      const taipeiDayKey = (d) =>
        new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (oldPunchDate && taipeiDayKey(oldPunchDate) !== taipeiDayKey(newDate)) {
        await applyEventToMonthly(session.user.userId, oldPunchDate);
      }
      await applyEventToMonthly(session.user.userId, newDate);
    } catch (err) {
      console.error(
        `applyEventToMonthly 失敗 user=${session.user.userId} (updateAdjustRequest):`,
        err?.message
      );
    }

    console.log(
      `[adjust-update] id=${id} user=${session.user.userId.slice(0, 8)} ` +
        `oldTs=${oldPunchDate?.toISOString?.()} newTs=${newDate.toISOString()}`
    );

    return {
      ok: true,
      code: "UPDATE_ADJUST_REQUEST_SUCCESS",
      id,
    };
  }
);
