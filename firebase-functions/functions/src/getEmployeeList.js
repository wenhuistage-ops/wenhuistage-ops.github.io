/**
 * getEmployeeList — 員工清單（管理員專用）
 * 對應 GS：Handlers.gs handleGetEmployeeList + DbOperations.gs getEmployeeList
 */

const { onCall } = require("firebase-functions/v2/https");
const { db, COLLECTIONS, verifyAdmin } = require("./_helpers");

module.exports = onCall(
  { region: "asia-southeast1", cors: true },
  async (request) => {
    const sessionToken = request.data?.sessionToken || request.data?.token;
    const auth = await verifyAdmin(sessionToken);
    if (!auth.ok) return { ok: false, code: auth.code };

    const snap = await db.collection(COLLECTIONS.EMPLOYEES).get();
    const employeesList = snap.docs.map((doc) => {
      const d = doc.data();
      const dept = String(d.dept || "").trim();
      return {
        userId: doc.id,
        email: d.email || "",
        name: d.name || "",
        picture: d.picture || "",
        firstLoginTime: d.firstLoginTime?.toDate?.() || null,
        dept,
        salary: Number(d.salary || 0),
        leaveInsurance: d.leaveInsurance || "第2級",
        healthInsurance: d.healthInsurance || "第2級",
        // housingExpense 預設 0（之前是 1000，但部分員工不適用，由管理員顯式設定）
        housingExpense: Number(d.housingExpense || 0),
        incomeTaxRate: Number(d.incomeTaxRate || 0),
        customInsuredSalary: Number(d.customInsuredSalary || 0),
        status: d.status || "啟用",
        preferredLanguage: d.preferredLanguage || "",
        lastLoginTime: d.lastLoginTime?.toDate?.() || null,
        isAdmin: dept === "管理員" || /admin/i.test(dept),
        lineUserId: doc.id,
        // Phase L7：薪資與勞保（僅 admin 取得，呼叫端是 verifyAdmin 已過）
        nationality: d.nationality === "foreign" ? "foreign" : "taiwanese", // 預設台灣
        salaryType: d.salaryType || "monthly",
        monthlySalary: Number(d.monthlySalary || 0),
        hourlyRate: Number(d.hourlyRate || 0),
        laborInsuranceGrade: d.laborInsuranceGrade != null ? Number(d.laborInsuranceGrade) : null,
        // 外籍員工不論欄位值如何，一律回傳 false（一致性保險）
        hasLaborPension: d.nationality === "foreign" ? false : (d.hasLaborPension !== false),
        laborPensionRate: d.nationality === "foreign" ? 0 : Number(d.laborPensionRate || 0),
      };
    });

    return { ok: true, employeesList };
  }
);
