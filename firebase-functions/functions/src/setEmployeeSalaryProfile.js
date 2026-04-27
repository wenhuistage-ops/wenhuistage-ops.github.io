/**
 * setEmployeeSalaryProfile — 寫入員工薪資制度與勞保等級（管理員專用）
 *
 * 寫入：employees/{userId} 的下列欄位（merge）：
 *   salaryType            'monthly' | 'hourly'
 *   monthlySalary         數字（NT$，monthly 模式必填，須 ≥ 28590 = 2026 基本工資）
 *   hourlyRate            數字（NT$，hourly 模式必填）
 *   laborInsuranceGrade   1–23（依勞保投保薪資分級表）
 *   hasLaborPension       boolean（是否提繳勞退）
 *   laborPensionRate      0–6（員工自願提繳率 %）
 *   housingExpense        數字 ≥ 0（每月住宿費扣款，外籍員工常用，預設 0）
 *   incomeTaxRate         0–30（薪資所得稅扣繳率 %，外籍員工常用 6 或 18）
 *
 * 規則：
 * - 必須是管理員 session
 * - 已提供的欄位才驗證；缺值欄位不寫入（partial update）
 * - monthlySalary 為 0 視為「清空設定」，跳過下限檢查
 */

const { onCall } = require("firebase-functions/v2/https");
const { admin, db, verifyAdmin } = require("./_helpers");

// 2026 年基本月薪（與 js/labor-hours.js 同步；每年元旦前手動更新）
const MIN_MONTHLY_WAGE = 28590;

module.exports = onCall(
  {
    region: "asia-southeast1",
    cors: true,
  },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token || null;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const data = request.data || {};
    const userId = String(data.userId || "").trim();
    if (!userId) {
      return { ok: false, code: "ERR_MISSING_USER_ID", msg: "userId required" };
    }

    const update = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.user?.userId || "",
    };

    // salaryType
    if (data.salaryType !== undefined) {
      const t = String(data.salaryType);
      if (!["monthly", "hourly"].includes(t)) {
        return { ok: false, code: "ERR_INVALID_SALARY_TYPE", msg: "salaryType must be 'monthly' or 'hourly'" };
      }
      update.salaryType = t;
    }

    // monthlySalary（≥ 基本工資；0 表示清空）
    if (data.monthlySalary !== undefined) {
      const s = Number(data.monthlySalary);
      if (isNaN(s) || s < 0) {
        return { ok: false, code: "ERR_INVALID_MONTHLY_SALARY", msg: "monthlySalary must be number ≥ 0" };
      }
      if (s > 0 && s < MIN_MONTHLY_WAGE) {
        return {
          ok: false,
          code: "ERR_BELOW_MIN_WAGE",
          msg: `monthlySalary must be ≥ ${MIN_MONTHLY_WAGE} (2026 minimum wage) or 0 to clear`,
        };
      }
      update.monthlySalary = s;
    }

    // hourlyRate
    if (data.hourlyRate !== undefined) {
      const r = Number(data.hourlyRate);
      if (isNaN(r) || r < 0) {
        return { ok: false, code: "ERR_INVALID_HOURLY_RATE", msg: "hourlyRate must be number ≥ 0" };
      }
      update.hourlyRate = r;
    }

    // laborInsuranceGrade 1-23
    if (data.laborInsuranceGrade !== undefined) {
      const g = Number(data.laborInsuranceGrade);
      if (!Number.isInteger(g) || g < 1 || g > 23) {
        return { ok: false, code: "ERR_INVALID_GRADE", msg: "laborInsuranceGrade must be integer 1-23" };
      }
      update.laborInsuranceGrade = g;
    }

    // hasLaborPension boolean
    if (data.hasLaborPension !== undefined) {
      update.hasLaborPension = !!data.hasLaborPension;
    }

    // laborPensionRate 0-6
    if (data.laborPensionRate !== undefined) {
      const p = Number(data.laborPensionRate);
      if (isNaN(p) || p < 0 || p > 6) {
        return { ok: false, code: "ERR_INVALID_PENSION_RATE", msg: "laborPensionRate must be 0-6" };
      }
      update.laborPensionRate = p;
    }

    // housingExpense（每月住宿費扣款，≥ 0）
    if (data.housingExpense !== undefined) {
      const h = Number(data.housingExpense);
      if (isNaN(h) || h < 0) {
        return { ok: false, code: "ERR_INVALID_HOUSING_EXPENSE", msg: "housingExpense must be number ≥ 0" };
      }
      update.housingExpense = h;
    }

    // incomeTaxRate（薪資所得稅扣繳率 % 0-30）
    if (data.incomeTaxRate !== undefined) {
      const r = Number(data.incomeTaxRate);
      if (isNaN(r) || r < 0 || r > 30) {
        return { ok: false, code: "ERR_INVALID_INCOME_TAX_RATE", msg: "incomeTaxRate must be 0-30 (%)" };
      }
      update.incomeTaxRate = r;
    }

    // 至少要有一個薪資相關欄位才寫
    const writableKeys = Object.keys(update).filter(
      (k) => k !== "updatedAt" && k !== "updatedBy"
    );
    if (writableKeys.length === 0) {
      return { ok: false, code: "ERR_NO_FIELDS", msg: "no salary fields provided" };
    }

    await db.collection("employees").doc(userId).set(update, { merge: true });

    return { ok: true, updatedFields: writableKeys };
  }
);
