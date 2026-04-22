/**
 * 請求審批模塊（Request Approval）
 * 管理待審核請求的加載、渲染和審批流程
 */

/**
 * 加載待審核請求
 * @param {string} adminUserId - 管理員 ID
 * @returns {Promise<array>} - 待審核請求列表
 */
async function loadPendingRequests(adminUserId) {
  try {
    const res = await callApifetch({
      action: 'getPendingRequests',
      userId: adminUserId
    });

    if (res.ok) {
      return res.requests || [];
    } else {
      console.error('無法加載待審核請求:', res.msg);
      return [];
    }
  } catch (err) {
    console.error('加載待審核請求出錯:', err);
    return [];
  }
}

/**
 * 渲染待審核請求列表
 * @param {array} requests - 請求列表
 * @param {HTMLElement} container - 容器元素
 */
function renderPendingRequests(requests, container) {
  if (!container) return;

  container.replaceChildren();

  if (!requests || requests.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'text-center text-gray-500 py-8';
    emptyEl.textContent = t('NO_PENDING_REQUESTS') || '沒有待審核的請求';
    container.appendChild(emptyEl);
    return;
  }

  requests.forEach(request => {
    const requestEl = document.createElement('div');
    requestEl.className = 'border-b border-gray-200 dark:border-gray-700 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer';

    requestEl.innerHTML = DOMPurify.sanitize(`
      <div class="flex justify-between items-center">
        <div>
          <p class="font-semibold">${request.employeeName}</p>
          <p class="text-sm text-gray-600 dark:text-gray-400">${request.requestType}: ${request.requestDate}</p>
          <p class="text-sm text-gray-500">${request.reason || '無備註'}</p>
        </div>
        <div class="flex gap-2">
          <button class="approve-btn px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600" data-request-id="${request.id}">
            ${t('BTN_APPROVE') || '批准'}
          </button>
          <button class="reject-btn px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600" data-request-id="${request.id}">
            ${t('BTN_REJECT') || '拒絕'}
          </button>
        </div>
      </div>
    `);

    container.appendChild(requestEl);
  });
}

/**
 * 批准請求
 * @param {string} requestId - 請求 ID
 * @param {string} adminUserId - 管理員 ID
 * @returns {Promise<boolean>} - 批准是否成功
 */
async function approveRequest(requestId, adminUserId) {
  try {
    const res = await callApifetch({
      action: 'approveRequest',
      requestId: requestId,
      adminUserId: adminUserId
    });

    if (res.ok) {
      showNotification(t('REQUEST_APPROVED') || '請求已批准', 'success');
      return true;
    } else {
      showNotification(t(res.code || 'APPROVAL_FAILED') || '批准失敗', 'error');
      return false;
    }
  } catch (err) {
    console.error('批准請求出錯:', err);
    showNotification('批准請求時發生錯誤', 'error');
    return false;
  }
}

/**
 * 拒絕請求
 * @param {string} requestId - 請求 ID
 * @param {string} reason - 拒絕原因
 * @param {string} adminUserId - 管理員 ID
 * @returns {Promise<boolean>} - 拒絕是否成功
 */
async function rejectRequest(requestId, reason, adminUserId) {
  try {
    const res = await callApifetch({
      action: 'rejectRequest',
      requestId: requestId,
      reason: reason,
      adminUserId: adminUserId
    });

    if (res.ok) {
      showNotification(t('REQUEST_REJECTED') || '請求已拒絕', 'success');
      return true;
    } else {
      showNotification(t(res.code || 'REJECTION_FAILED') || '拒絕失敗', 'error');
      return false;
    }
  } catch (err) {
    console.error('拒絕請求出錯:', err);
    showNotification('拒絕請求時發生錯誤', 'error');
    return false;
  }
}

/**
 * 設置請求審批事件監聽
 * @param {string} adminUserId - 管理員 ID
 * @param {HTMLElement} container - 請求列表容器
 */
function setupRequestApprovalListeners(adminUserId, container) {
  if (!container) return;

  container.addEventListener('click', async (e) => {
    const approveBtn = e.target.closest('.approve-btn');
    const rejectBtn = e.target.closest('.reject-btn');

    if (approveBtn) {
      const requestId = approveBtn.dataset.requestId;
      const success = await approveRequest(requestId, adminUserId);
      if (success) {
        approveBtn.parentElement.parentElement.parentElement.remove();
      }
    }

    if (rejectBtn) {
      const requestId = rejectBtn.dataset.requestId;
      const reason = prompt(t('ENTER_REJECTION_REASON') || '請輸入拒絕原因:');
      if (reason !== null) {
        const success = await rejectRequest(requestId, reason, adminUserId);
        if (success) {
          rejectBtn.parentElement.parentElement.parentElement.remove();
        }
      }
    }
  });
}


console.log('✓ request-approval 模塊已加載');
