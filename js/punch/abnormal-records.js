/**
 * 異常紀錄模組（從 punch.js Region 3 抽出）
 *
 * 職責：查詢、補充申請狀態、渲染異常打卡記錄。
 * 依賴全域：cacheManager、callApifetch、renderTranslations、DOMPurify、
 *           recordsLoadingEl、abnormalRecordsSectionEl、abnormalListEl、
 *           recordsEmptyEl（DOM 引用由 state.js / app.js 初始化）
 *
 * 載入順序：必須在 punch.js 之前載入（index.html 已處理）。
 */

// ===================================
// #region 異常紀錄檢查
// ===================================

async function checkAbnormal(monthsToCheck = 1, forceRefresh = false) {
    // 檢查快取是否有效（問題 8.4：性能優化）
    // 🌟 P1-3 改進：使用統一的 CacheManager，自動處理 TTL
    const abnormalCache = !forceRefresh ? cacheManager.get('abnormal', 'records') : null;

    if (abnormalCache) {
        console.log(`使用快取的異常記錄`);
        renderAbnormalRecords(abnormalCache);
        return;
    }

    const currentDate = new Date();
    const currentMonth = currentDate.getFullYear() + "-" + String(currentDate.getMonth() + 1).padStart(2, "0");
    const sessionUserId = localStorage.getItem("sessionUserId");

    console.log("檢查異常記錄 - 當前月份:", currentMonth, "檢查月份數:", monthsToCheck, "用戶ID:", sessionUserId);

    // 🚀 P4-2 優化：並行加載多個月份的異常記錄
    const monthPromises = [];
    for (let i = 0; i < monthsToCheck; i++) {
        const checkDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
        const month = checkDate.getFullYear() + "-" + String(checkDate.getMonth() + 1).padStart(2, "0");

        monthPromises.push(
            callApifetch({
                action: 'getAbnormalRecords',
                month: month,
                userId: sessionUserId
            }).then(res => ({ res, month })).catch(error => {
                console.error(`檢查月份 ${month} 時出錯:`, error);
                return { res: null, month };
            })
        );
    }

    // 等待所有月份的 API 調用完成（並行而非串行）
    const results = await Promise.all(monthPromises);
    let allAbnormalRecords = [];

    for (const { res, month } of results) {
        if (res && res.ok && res.records) {
            // 為每個記錄添加月份標記
            const recordsWithMonth = res.records.map(record => ({
                ...record,
                month: month,
                displayDate: `${month}-${record.date.split('-')[2]}`
            }));
            allAbnormalRecords = allAbnormalRecords.concat(recordsWithMonth);
            console.log(`月份 ${month} 找到 ${res.records.length} 條異常記錄`);
        }
    }

    // 按日期排序（最新的在前面）
    allAbnormalRecords.sort((a, b) => new Date(b.displayDate) - new Date(a.displayDate));

    console.log("總共找到 " + allAbnormalRecords.length + " 條異常記錄");

    // 隱藏載入動畫
    const recordsLoading = recordsLoadingEl;
    if (recordsLoading) recordsLoading.style.display = 'none';

    // 🌟 P1-3 改進：使用統一的 CacheManager 保存快取（自動 5 分鐘 TTL）
    cacheManager.set('abnormal', 'records', allAbnormalRecords);
    console.log("異常記錄已快取");

    // 查詢待審核申請，並將狀態合併到異常記錄中
    await enrichAbnormalRecordsWithApplicationStatus(allAbnormalRecords);

    renderAbnormalRecords(allAbnormalRecords);
}

/**
 * 查詢待審核申請，並將狀態信息添加到異常記錄中
 * @param {Array} records - 異常記錄陣列
 */
async function enrichAbnormalRecordsWithApplicationStatus(records) {
    try {
        // 查詢所有待審核申請
        const res = await callApifetch({
            action: 'getReviewRequest'
        });

        if (res.ok && res.reviewRequest) {
            // 為每個異常記錄檢查是否有對應的待審核申請
            const applicationsByDate = {};
            res.reviewRequest.forEach(app => {
                // 日期格式可能是 YYYY-MM-DD 或其他格式
                const appDate = app.date || app.displayDate;
                if (!applicationsByDate[appDate]) {
                    applicationsByDate[appDate] = [];
                }
                applicationsByDate[appDate].push(app);
            });

            // 將狀態合併到異常記錄中
            records.forEach(record => {
                // 匹配時需要考慮日期格式，記錄的 displayDate 格式是 YYYY-MM-DD
                const displayDate = record.displayDate; // 格式: YYYY-MM-DD

                if (applicationsByDate[displayDate] && applicationsByDate[displayDate].length > 0) {
                    record.status = 'pending'; // 有待審核申請
                    record.applications = applicationsByDate[displayDate];
                    console.log(`異常記錄 ${displayDate} 有 ${record.applications.length} 個待審核申請`);
                }
            });
        }
    } catch (error) {
        console.error("查詢待審核申請時出錯:", error);
        // 即使出錯也繼續，不阻止異常記錄顯示
    }
}

/**
 * 渲染異常記錄列表
 * @param {Array} records - 異常記錄陣列
 */
function renderAbnormalRecords(records) {
    const abnormalRecordsSection = abnormalRecordsSectionEl;
    const abnormalList = abnormalListEl;
    const recordsEmpty = recordsEmptyEl;

    if (records.length > 0) {
        abnormalRecordsSection.style.display = 'block';
        recordsEmpty.style.display = 'none';
        abnormalList.replaceChildren();

        // 🚀 P4-2 優化：使用 DocumentFragment 批量插入 DOM
        const fragment = document.createDocumentFragment();

        records.forEach(record => {
            console.log("Abnormal Record:", record.displayDate, record.reason, "Status:", record.status);

            // 判斷異常類型
            const displayReason = record.reason; // 直接使用 reason 作為顯示鍵

            // 只有當上班和下班都沒有打卡時，才顯示請假和休假按鈕
            const showLeaveButtons = record.reason === "STATUS_BOTH_MISSING";

            // 檢查是否有待審核申請（status: 'pending' 或 'reviewing'）
            const hasPendingApplication = record.status === 'pending' || record.status === 'reviewing';

            // 檢查是否有請假/休假申請（待審核或已批准）
            const hasLeaveOrVacationRequest = [
                "STATUS_LEAVE_PENDING",
                "STATUS_VACATION_PENDING",
                "STATUS_LEAVE_APPROVED",
                "STATUS_VACATION_APPROVED"
            ].includes(record.reason);

            // 補打卡按鈕顯示條件：需排除請假/休假申請，只在打卡缺失時顯示
            const canShowAdjustBtn = !hasPendingApplication && !hasLeaveOrVacationRequest &&
                [
                    "STATUS_BOTH_MISSING",
                    "STATUS_PUNCH_IN_MISSING",
                    "STATUS_PUNCH_OUT_MISSING"
                ].includes(record.reason);

            const li = document.createElement('li');
            li.className = 'p-3 bg-gray-50 rounded-lg flex justify-between items-center dark:bg-gray-700';

            // 動態生成按鈕HTML
            let buttonsHtml = '';
            if (canShowAdjustBtn) {
                buttonsHtml = `
                    <button data-i18n="ADJUST_BUTTON_TEXT" data-date="${record.displayDate}" data-reason="${record.reason}"
                            class="adjust-btn text-sm font-semibold
                                   text-indigo-600 dark:text-indigo-400
                                   hover:text-indigo-800 dark:hover:text-indigo-300 mr-2">
                        補打卡
                    </button>`;
            }

            if (showLeaveButtons && !hasPendingApplication && !hasLeaveOrVacationRequest) {
                buttonsHtml += `
                    <button data-i18n="BTN_LEAVE" data-date="${record.displayDate}" data-reason="${record.reason}"
                            class="leave-btn text-sm font-semibold
                                   text-orange-600 dark:text-orange-400
                                   hover:text-orange-800 dark:hover:text-orange-300 mr-2">
                        請假
                    </button>
                    <button data-i18n="BTN_VACATION" data-date="${record.displayDate}" data-reason="${record.reason}"
                            class="vacation-btn text-sm font-semibold
                                   text-green-600 dark:text-green-400
                                   hover:text-green-800 dark:hover:text-green-300">
                        休假
                    </button>`;
            }

            // 如果有待審核申請，顯示狀態標籤
            let statusBadge = '';
            if (hasPendingApplication) {
                statusBadge = `
                    <span class="px-2 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 text-xs rounded-full font-medium">
                        <i class="fas fa-hourglass-half mr-1"></i>審核中
                    </span>`;
            }

            // ✅ XSS防護：使用 DOMPurify 淨化 HTML
            const safeHtml = `
                <div>
                    <p class="font-medium text-gray-800 dark:text-white">${record.displayDate}</p>
                    <p class="text-sm text-red-600 dark:text-red-400"
                       data-i18n-dynamic="true"
                       data-i18n-key="${displayReason}">
                   </p>
                </div>
                <div class="flex flex-wrap gap-1 items-center">
                    ${statusBadge}
                    ${buttonsHtml}
                </div>
            `;
            li.innerHTML = DOMPurify.sanitize(safeHtml);
            fragment.appendChild(li);
        });

        // 一次性插入所有 DOM 節點
        abnormalList.appendChild(fragment);
        // 渲染所有翻譯（而非逐個渲染）
        renderTranslations(abnormalList); // 來自 core.js

    } else {
        abnormalRecordsSection.style.display = 'block';
        recordsEmpty.style.display = 'block';
        abnormalList.replaceChildren();
    }
}
// #endregion

console.log('✓ abnormal-records 模組已加載');

// CommonJS export（僅 Node.js/Jest，瀏覽器無影響）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        checkAbnormal,
        enrichAbnormalRecordsWithApplicationStatus,
        renderAbnormalRecords,
    };
}
