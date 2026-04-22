/*
 * Copyright (C) 2025 0J (Lin Jie / 0rigin1856)
 *
 * This file is part of 0riginAttendance-System.
 *
 * 0riginAttendance-System is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * 0riginAttendance-System is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with 0riginAttendance-System.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Please credit "0J (Lin Jie / 0rigin1856)" when redistributing or modifying this project.
 */


// LineApi.gs

function exchangeCodeForToken_(code, redirectUrl = null) {
  // 如果沒有提供 redirectUrl，使用預設值
  const actualRedirectUrl = redirectUrl || LINE_REDIRECT_URL;

  const url     = 'https://api.line.me/oauth2/v2.1/token';
  const payload = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: actualRedirectUrl,
    client_id: LINE_CHANNEL_ID,
    client_secret: LINE_CHANNEL_SECRET
  };

  Logger.log("exchangeCodeForToken: 使用的 redirectUrl = " + actualRedirectUrl);

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    payload: Object.keys(payload).map(k => `${k}=${encodeURIComponent(payload[k])}`).join('&'),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    muteHttpExceptions: true
  });
  const json = JSON.parse(resp.getContentText());
  if (!json.access_token) throw new Error('交換 access_token 失敗：' + resp.getContentText());
  return json;
}

function getLineProfile_(accessToken) {
  const resp = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  return JSON.parse(resp.getContentText());
}

function parseIdToken_(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error("Invalid id_token format");

  // 轉換 base64url → base64
  let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }

  const decoded = Utilities.base64Decode(base64);
  return JSON.parse(Utilities.newBlob(decoded).getDataAsString());
}

function getLineUserInfo_(tokenJson) {
  const profile = getLineProfile_(tokenJson.access_token);
  const payload = parseIdToken_(tokenJson.id_token);
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl,
    email: payload.email || ""
  };
}

/**
 * 發送 LINE 推送消息給指定用戶
 * @param {string} userId - LINE 用戶 ID
 * @param {string} message - 要發送的消息
 * @return {object} 發送結果
 */
function sendLinePushMessage(userId, message) {
  try {
    const channelAccessToken = LINE_CHANNEL_ACCESS_TOKEN;
    if (!channelAccessToken) {
      Logger.log("LINE_CHANNEL_ACCESS_TOKEN 未設定，無法發送推送消息");
      return { ok: false, msg: "LINE_CHANNEL_ACCESS_TOKEN 未設定" };
    }

    const url = 'https://api.line.me/v2/bot/message/push';
    const payload = {
      to: userId,
      messages: [{
        type: 'text',
        text: message
      }]
    };

    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + channelAccessToken
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const responseCode = resp.getResponseCode();
    if (responseCode === 200) {
      Logger.log("LINE 推送消息發送成功: " + userId);
      return { ok: true, msg: "消息發送成功" };
    } else {
      Logger.log("LINE 推送消息發送失敗: " + resp.getContentText());
      return { ok: false, msg: "發送失敗: " + resp.getContentText() };
    }
  } catch (error) {
    Logger.log("發送 LINE 推送消息時發生錯誤: " + error.message);
    return { ok: false, msg: "發送錯誤: " + error.message };
  }
}

/**
 * 發送通知給所有管理員
 * @param {string} message - 要發送的消息
 * @return {object} 發送結果
 */
function notifyAdmins(message) {
  try {
    Logger.log("開始獲取管理員列表...");
    const admins = getAdminList();
    Logger.log("獲取到的管理員列表: " + JSON.stringify(admins));
    
    if (!admins || admins.length === 0) {
      Logger.log("沒有找到管理員，無法發送通知");
      return { ok: false, msg: "沒有管理員" };
    }

    let successCount = 0;
    let failCount = 0;

    for (const admin of admins) {
      Logger.log("處理管理員: " + admin.name + ", LINE ID: " + admin.lineUserId);
      if (admin.lineUserId) {
        const result = sendLinePushMessage(admin.lineUserId, message);
        if (result.ok) {
          successCount++;
          Logger.log("成功發送給管理員: " + admin.name);
        } else {
          failCount++;
          Logger.log("發送給管理員 " + admin.name + " 失敗: " + result.msg);
        }
      } else {
        Logger.log("管理員 " + admin.name + " 沒有 LINE 用戶 ID");
        failCount++;
      }
    }

    return {
      ok: successCount > 0,
      msg: `發送完成，成功: ${successCount}，失敗: ${failCount}`,
      successCount: successCount,
      failCount: failCount
    };
  } catch (error) {
    Logger.log("通知管理員時發生錯誤: " + error.message);
    return { ok: false, msg: "通知錯誤: " + error.message };
  }
}
