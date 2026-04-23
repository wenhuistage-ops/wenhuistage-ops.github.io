# Firestore 完整遷移計劃

## 執行摘要

從 Google Apps Script + Google Sheets 遷移到 Firebase Firestore，預期打卡性能從 **4.1 秒 → < 800ms**。

**遷移工期**: 4-6 週  
**團隊規模**: 2-3 人  
**成本**: 免費（享受 Firebase 免費層）  
**風險等級**: 低（Google 產品之間相容性好）

---

## 前置條件檢查

- ✅ Google Cloud Project（已有）
- ✅ Firebase 專案（若沒有需創建）
- ✅ 團隊成員懂 JavaScript/Node.js
- ✅ 100+ 員工的現有數據
- ✅ 能接受 2-4 小時服務暫停

---

## Phase 1: 環境準備（Day 1-2）

### 1.1 創建 Firestore 數據庫

**在 Firebase Console 中**：

1. 打開 [Firebase Console](https://console.firebase.google.com/)
2. 選擇現有的 Google Cloud Project（或新建）
3. 點擊「建立資料庫」
4. 選擇：
   - 🌍 區域：`asia-southeast1`（台灣最近）
   - 🔒 安全性：從空白範本開始
5. 等待數據庫初始化（通常 1-2 分鐘）

### 1.2 設置 Firestore 集合結構

在 Firestore Console 中建立以下集合（不需手動建立，數據遷移時自動創建）：

```
firestore-db/
├── employees/              # 員工信息（文檔 ID = userId）
│   ├── userId1
│   ├── userId2
│   └── ...
│
├── attendance/             # 打卡記錄
│   ├── record1 {timestamp, userId, type, ...}
│   ├── record2
│   └── ...
│
├── locations/              # 打卡地點
│   ├── location1
│   ├── location2
│   └── ...
│
├── sessions/               # 會話信息
│   ├── sessionToken1
│   ├── sessionToken2
│   └── ...
│
└── notification_queue/     # 通知隊列（可選）
    ├── notif1
    ├── notif2
    └── ...
```

### 1.3 設置 Firebase Admin SDK

在 Google Apps Script 中使用 Firebase Admin SDK（通過 REST API）：

**或者**直接使用 Cloud Functions（推薦）。

---

## Phase 2: 數據遷移（Day 3-4）

### 2.1 編寫遷移腳本

創建 `migrate-to-firestore.js` 文件：

```javascript
const admin = require('firebase-admin');
const { google } = require('googleapis');

// 初始化 Firebase
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const sheets = google.sheets('v4');

// Google Sheets 配置
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
const auth = new google.auth.GoogleAuth({
  keyFile: './serviceAccountKey.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
});

/**
 * 從 Google Sheets 讀取數據
 */
async function readSheetsData(sheetName) {
  const authClient = await auth.getClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    auth: authClient
  });

  return response.data.values || [];
}

/**
 * 遷移員工數據
 */
async function migrateEmployees() {
  console.log('🔄 遷移員工數據...');
  const data = await readSheetsData('員工名單');
  
  if (!data || data.length === 0) {
    console.log('❌ 員工數據為空');
    return;
  }

  const headers = data[0];
  const batch = db.batch();
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // 跳過空行

    const employee = {
      userId: String(row[0] || '').trim(),
      email: String(row[1] || '').trim(),
      name: String(row[2] || '').trim(),
      picture: String(row[3] || '').trim(),
      firstLoginTime: row[4] ? new Date(row[4]) : null,
      dept: String(row[5] || '').trim(),
      salary: Number(row[6] || 0),
      leaveInsurance: String(row[7] || '第2級').trim(),
      healthInsurance: String(row[8] || '第2級').trim(),
      housingExpense: Number(row[9] || 1000),
      status: String(row[10] || '啟用').trim(),
      preferredLanguage: String(row[11] || '').trim(),
      lastLoginTime: row[12] ? new Date(row[12]) : null,
      createdAt: new Date()
    };

    const docRef = db.collection('employees').doc(employee.userId);
    batch.set(docRef, employee);
    count++;

    // Firestore 批量操作限制 500 個
    if (count % 500 === 0) {
      await batch.commit();
      batch = db.batch();
      console.log(`  ✓ 已遷移 ${count} 個員工`);
    }
  }

  if (count % 500 !== 0) {
    await batch.commit();
  }

  console.log(`✅ 員工數據遷移完成：${count} 個員工`);
}

/**
 * 遷移打卡記錄
 */
async function migrateAttendance() {
  console.log('🔄 遷移打卡記錄...');
  const data = await readSheetsData('打卡記錄');
  
  if (!data || data.length === 0) {
    console.log('❌ 打卡數據為空');
    return;
  }

  const batch = db.batch();
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;

    const record = {
      timestamp: new Date(row[0]),
      userId: String(row[1] || '').trim(),
      dept: String(row[2] || '').trim(),
      name: String(row[3] || '').trim(),
      type: String(row[4] || '').trim(),
      gps: String(row[5] || '').trim(),
      location: String(row[6] || '').trim(),
      note: String(row[7] || '').trim(),
      auditStatus: String(row[8] || '').trim(),
      device: String(row[9] || '').trim(),
      createdAt: new Date()
    };

    // 使用 userId + timestamp 作為文檔 ID（保證唯一）
    const docId = `${record.userId}_${record.timestamp.getTime()}`;
    const docRef = db.collection('attendance').doc(docId);
    batch.set(docRef, record);
    count++;

    if (count % 500 === 0) {
      await batch.commit();
      batch = db.batch();
      console.log(`  ✓ 已遷移 ${count} 條打卡記錄`);
    }
  }

  if (count % 500 !== 0) {
    await batch.commit();
  }

  console.log(`✅ 打卡記錄遷移完成：${count} 條記錄`);
}

/**
 * 遷移地點數據
 */
async function migrateLocations() {
  console.log('🔄 遷移地點數據...');
  const data = await readSheetsData('地點');
  
  if (!data || data.length === 0) {
    console.log('❌ 地點數據為空');
    return;
  }

  const batch = db.batch();
  let count = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[1]) continue; // 地點名稱為空則跳過

    const location = {
      id: String(row[0] || '').trim(),
      name: String(row[1] || '').trim(),
      lat: Number(row[2] || 0),
      lng: Number(row[3] || 0),
      radius: Number(row[4] || 100),
      createdAt: new Date()
    };

    const docRef = db.collection('locations').doc(location.id || location.name);
    batch.set(docRef, location);
    count++;
  }

  await batch.commit();
  console.log(`✅ 地點數據遷移完成：${count} 個地點`);
}

/**
 * 主遷移函數
 */
async function migrate() {
  try {
    console.log('🚀 開始 Firestore 數據遷移...\n');
    
    await migrateEmployees();
    await migrateAttendance();
    await migrateLocations();

    console.log('\n✅ 數據遷移完成！');
    console.log('📊 已創建以下集合：');
    console.log('  - employees');
    console.log('  - attendance');
    console.log('  - locations');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ 遷移失敗:', err);
    process.exit(1);
  }
}

// 執行遷移
migrate();
```

### 2.2 準備服務帳號金鑰

1. 在 Google Cloud Console 中創建服務帳號
2. 生成 JSON 金鑰
3. 保存為 `serviceAccountKey.json`
4. **⚠️ 重要**：不要提交到 Git，添加到 `.gitignore`

### 2.3 執行遷移

```bash
# 安裝依賴
npm install firebase-admin @googleapis/sheets

# 執行遷移
node migrate-to-firestore.js
```

**驗證遷移成功**：
- ✅ 在 Firebase Console 中查看各個集合的文檔數量
- ✅ 檢查數據完整性（隨機抽樣檢查）

### 2.4 回滾計劃

若遷移失敗，保留原始 Sheets 數據（不刪除），可隨時重新遷移。

---

## Phase 3: 建立索引（Day 4）

在 Firestore 中創建必要的複合索引，加快查詢速度。

### 3.1 在 Firebase Console 建立索引

打開 Firestore Console → 索引標籤

**創建以下索引**：

#### 索引 1：打卡記錄按日期排序
- 集合：`attendance`
- 第一個欄位：`timestamp`（降序）
- 第二個欄位：`userId`（升序）

#### 索引 2：打卡記錄按用戶過濾
- 集合：`attendance`
- 第一個欄位：`userId`（升序）
- 第二個欄位：`timestamp`（降序）

**或使用 Firestore 規則自動建立**：

```yaml
# firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 自動建立索引
    match /attendance/{document=**} {
      allow read, write: if request.auth.uid != null;
      
      // Firestore 會自動建立以下查詢的索引：
      // 1. WHERE userId = X ORDER BY timestamp DESC
      // 2. WHERE timestamp >= X ORDER BY timestamp
    }
  }
}
```

---

## Phase 4: 後端重寫（Day 5-8）

### 4.1 使用 Google Cloud Functions（推薦）

不再使用 Apps Script，改用 Cloud Functions。

**優勢**：
- ✅ 支持 Node.js，代碼更靈活
- ✅ 可直接訪問 Firestore
- ✅ 更好的性能和錯誤處理

**創建函數**：

```bash
# 初始化 Firebase 函數
firebase init functions
```

#### 4.1.1 打卡函數

`functions/src/punch.js`:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * 打卡函數
 */
exports.punch = functions.https.onCall(async (data, context) => {
  const { sessionToken, type, lat, lng, note } = data;

  try {
    // 驗證會話
    const sessionDoc = await db.collection('sessions').doc(sessionToken).get();
    if (!sessionDoc.exists) {
      return { ok: false, code: 'ERR_SESSION_INVALID' };
    }

    const session = sessionDoc.data();
    const userId = session.userId;

    // 檢查會話是否過期
    if (new Date() > session.expiresAt.toDate()) {
      return { ok: false, code: 'ERR_SESSION_EXPIRED' };
    }

    // 獲取員工信息
    const employeeDoc = await db.collection('employees').doc(userId).get();
    if (!employeeDoc.exists) {
      return { ok: false, code: 'ERR_NO_DATA' };
    }

    const employee = employeeDoc.data();

    // 檢查員工狀態
    if (employee.status !== '啟用') {
      return { ok: false, code: 'ERR_ACCOUNT_DISABLED' };
    }

    // 驗證坐標
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      return { ok: false, code: 'ERR_INVALID_COORDINATES' };
    }

    // 獲取地點（使用快取）
    const locationsSnap = await db.collection('locations').get();
    const locations = locationsSnap.docs.map(doc => ({
      name: doc.data().name,
      lat: doc.data().lat,
      lng: doc.data().lng,
      radius: doc.data().radius
    }));

    // 計算最近的地點
    let locationName = null;
    let minDistance = Infinity;
    let bestLocation = null;

    for (const location of locations) {
      const dist = calculateDistance(latNum, lngNum, location.lat, location.lng);
      
      if (dist < minDistance) {
        minDistance = dist;
        bestLocation = {
          name: location.name,
          distance: dist,
          radius: location.radius
        };
      }

      if (dist <= location.radius) {
        locationName = location.name;
        break;
      }
    }

    // 檢查是否在範圍內
    if (!locationName) {
      let errorMsg = 'ERR_OUT_OF_RANGE';
      if (bestLocation) {
        errorMsg += `_DISTANCE:${Math.round(bestLocation.distance)}m_LOCATION:${bestLocation.name}_RADIUS:${bestLocation.radius}m`;
      }
      return { ok: false, code: errorMsg };
    }

    // 寫入打卡記錄
    const attendanceRef = db.collection('attendance').doc();
    await attendanceRef.set({
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userId: userId,
      dept: employee.dept,
      name: employee.name,
      type: type,
      gps: `(${lat},${lng})`,
      location: locationName,
      note: note || '',
      auditStatus: '',
      device: '',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 更新員工的最後登錄時間
    await db.collection('employees').doc(userId).update({
      lastLoginTime: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      ok: true,
      code: 'PUNCH_SUCCESS',
      params: { type: type }
    };

  } catch (error) {
    console.error('打卡錯誤:', error);
    return { ok: false, code: 'SERVER_ERROR', error: error.message };
  }
});

/**
 * 計算兩點之間的距離（Haversine 公式）
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 地球半徑（米）
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // 距離（米）
}
```

#### 4.1.2 會話驗證函數

`functions/src/auth.js`:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * 驗證會話
 */
exports.verifySession = functions.https.onCall(async (data, context) => {
  const { sessionToken } = data;

  try {
    const sessionDoc = await db.collection('sessions').doc(sessionToken).get();
    
    if (!sessionDoc.exists) {
      return { ok: false, code: 'ERR_SESSION_INVALID' };
    }

    const session = sessionDoc.data();
    const now = new Date();
    const expiresAt = session.expiresAt.toDate();

    if (now > expiresAt) {
      return { ok: false, code: 'ERR_SESSION_EXPIRED' };
    }

    // 更新最後使用時間
    await db.collection('sessions').doc(sessionToken).update({
      lastUsedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 獲取員工信息
    const employeeDoc = await db.collection('employees').doc(session.userId).get();
    
    return {
      ok: true,
      user: employeeDoc.data(),
      code: 'WELCOME_BACK',
      params: { name: employeeDoc.data().name }
    };

  } catch (error) {
    console.error('會話驗證錯誤:', error);
    return { ok: false, code: 'SERVER_ERROR' };
  }
});
```

#### 4.1.3 異常記錄查詢函數

`functions/src/abnormal.js`:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

/**
 * 獲取異常記錄
 */
exports.getAbnormalRecords = functions.https.onCall(async (data, context) => {
  const { month, userId } = data;

  try {
    // 解析月份
    const [year, monthStr] = month.split('-');
    const monthNum = parseInt(monthStr) - 1;
    
    // 構建日期範圍
    const startDate = new Date(year, monthNum, 1);
    const endDate = new Date(year, monthNum + 1, 0);

    // 查詢該月的所有打卡記錄
    let query = db.collection('attendance')
      .where('timestamp', '>=', startDate)
      .where('timestamp', '<=', endDate);

    if (userId) {
      query = query.where('userId', '==', userId);
    }

    const snapshot = await query.orderBy('timestamp', 'desc').get();
    const records = snapshot.docs.map(doc => doc.data());

    // 計算異常（缺卡、遲到、早退等）
    const abnormalRecords = detectAbnormal(records, month, userId);

    return {
      ok: true,
      records: abnormalRecords
    };

  } catch (error) {
    console.error('查詢異常記錄失敗:', error);
    return { ok: false, code: 'SERVER_ERROR', error: error.message };
  }
});

/**
 * 檢測異常記錄
 */
function detectAbnormal(records, month, userId) {
  const abnormal = [];
  const recordsByDate = {};

  // 按日期分組
  for (const record of records) {
    const dateKey = record.timestamp.toDate().toISOString().split('T')[0];
    if (!recordsByDate[dateKey]) {
      recordsByDate[dateKey] = [];
    }
    recordsByDate[dateKey].push(record.type);
  }

  // 檢測每天的異常
  for (const [date, types] of Object.entries(recordsByDate)) {
    const hasCheckIn = types.includes('上班');
    const hasCheckOut = types.includes('下班');

    if (!hasCheckIn && !hasCheckOut) {
      abnormal.push({
        date: date,
        reason: 'STATUS_BOTH_MISSING',
        status: null
      });
    } else if (!hasCheckIn) {
      abnormal.push({
        date: date,
        reason: 'STATUS_PUNCH_IN_MISSING',
        status: null
      });
    } else if (!hasCheckOut) {
      abnormal.push({
        date: date,
        reason: 'STATUS_PUNCH_OUT_MISSING',
        status: null
      });
    }
  }

  return abnormal;
}
```

### 4.2 部署 Cloud Functions

```bash
# 部署
firebase deploy --only functions

# 查看部署的函數
firebase functions:list
```

部署後，Cloud Functions 會提供 HTTP 端點 URL，供前端調用。

---

## Phase 5: Firestore 安全規則（Day 8）

### 5.1 配置安全規則

編輯 `firestore.rules`:

```yaml
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // 默認拒絕所有訪問
    match /{document=**} {
      allow read, write: if false;
    }

    // 員工信息：已認證用戶可讀取自己的信息
    match /employees/{userId} {
      allow read: if request.auth.uid == userId;
      allow write: if false; // 禁止客戶端修改
    }

    // 打卡記錄：已認證用戶可寫入自己的記錄
    match /attendance/{document=**} {
      allow create: if request.auth.uid != null && 
                       request.resource.data.userId == request.auth.uid;
      allow read: if request.auth.uid == resource.data.userId;
      allow write: if false; // 禁止修改已寫入的記錄
    }

    // 會話：已認證用戶可讀取和管理自己的會話
    match /sessions/{sessionToken} {
      allow read, write: if request.auth.uid == resource.data.userId;
    }

    // 地點：所有已認證用戶可讀取
    match /locations/{locationId} {
      allow read: if request.auth.uid != null;
      allow write: if false; // 只有管理員可修改（通過 Cloud Functions）
    }

    // 通知隊列：禁止客戶端訪問（只有 Cloud Functions 可訪問）
    match /notification_queue/{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 5.2 部署安全規則

```bash
firebase deploy --only firestore:rules
```

---

## Phase 6: 前端適配（Day 9-11）

### 6.1 更新 API 調用

修改前端的 `callApifetch` 函數，使其調用 Cloud Functions 而不是 Apps Script。

**前置**：安裝 Firebase SDK

```bash
npm install firebase
```

**初始化 Firebase**（在 `core.js` 中）：

```javascript
import { initializeApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";

// Firebase 配置（從 Firebase Console 複製）
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef1234567890"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, 'asia-southeast1'); // 選擇區域

// 導出以供其他模塊使用
export { functions };
```

**修改 punch.js 中的 API 調用**：

```javascript
import { functions } from './core.js';
import { httpsCallable } from "firebase/functions";

async function submitPunch(lat, lng, accuracy, geoTime) {
  try {
    const apiStart = performance.now();
    
    // 使用 Cloud Functions
    const punch = httpsCallable(functions, 'punch');
    const res = await punch({
      sessionToken: localStorage.getItem("sessionToken"),
      type: type,
      lat: lat,
      lng: lng,
      note: `精確度: ${Math.round(accuracy)}m | ${navigator.userAgent}`
    });

    const apiEnd = performance.now();
    const apiTime = apiEnd - apiStart;

    // 後續邏輯相同...
    const msg = t(res.data.code || "UNKNOWN_ERROR", res.data.params || {});
    showNotification(msg, res.data.ok ? "success" : "error");
    // ...
  } catch (err) {
    console.error(err);
    showNotification('打卡失敗', 'error');
  }
}
```

### 6.2 更新異常記錄查詢

```javascript
import { httpsCallable } from "firebase/functions";

async function checkAbnormal(monthsToCheck = 1, forceRefresh = false) {
  const getAbnormalRecords = httpsCallable(functions, 'getAbnormalRecords');
  
  const currentDate = new Date();
  const currentMonth = currentDate.getFullYear() + "-" + 
                      String(currentDate.getMonth() + 1).padStart(2, "0");

  try {
    const res = await getAbnormalRecords({
      month: currentMonth,
      userId: localStorage.getItem("sessionUserId")
    });

    if (res.data.ok) {
      renderAbnormalRecords(res.data.records);
    }
  } catch (err) {
    console.error('查詢異常記錄失敗:', err);
  }
}
```

---

## Phase 7: 測試和驗證（Day 12-13）

### 7.1 功能測試

**測試清單**：

- [ ] 登入和會話驗證
- [ ] 打卡（上班/下班）
- [ ] 補打卡
- [ ] 異常記錄查詢
- [ ] 請假/休假申請
- [ ] 管理員審核

### 7.2 性能測試

使用 Chrome DevTools 或 Lighthouse 測試：

```javascript
// 在前端添加性能監控
console.time('punch');
await doPunch('上班');
console.timeEnd('punch'); // 應該 < 1000ms
```

**預期結果**：
- ✅ 打卡耗時: < 800ms（相比原先 4.1s）
- ✅ 異常查詢: < 500ms
- ✅ 數據準確性: 100%

### 7.3 負載測試

使用 [Apache JMeter](https://jmeter.apache.org/) 或 [Firebase Console](https://console.firebase.google.com/) 的監控面板模擬並發。

**測試場景**：
- 10 個用戶同時打卡 → 應該全部成功
- 100 個異常記錄查詢 → 應該在 2 秒內完成

---

## Phase 8: 灰度發佈（Day 14）

### 8.1 灰度發佈計劃

#### Stage 1: 內部測試（Day 14）
- ✅ 團隊成員測試
- ✅ 驗證所有功能
- ✅ 修復發現的 Bug

#### Stage 2: 10% 用戶（Day 15）
- ✅ 選擇 10 個用戶（測試組）
- ✅ 監控性能指標
- ✅ 收集反饋

#### Stage 3: 50% 用戶（Day 16）
- ✅ 若 Stage 2 無問題，擴大到 50% 用戶
- ✅ 同時保留 50% 在舊系統作為對比

#### Stage 4: 100% 用戶（Day 17）
- ✅ 全面切換到 Firestore
- ✅ 保持 GAS + Sheets 備份 30 天

### 8.2 發佈控制

使用 Feature Flag 控制發佈：

```javascript
// config.js
const USE_FIRESTORE = localStorage.getItem('useFirestore') === 'true';

async function callAPI(action, params) {
  if (USE_FIRESTORE) {
    return callFirebaseFunction(action, params);
  } else {
    return callAppsScriptAPI(action, params);
  }
}

// 通過 URL 參數控制：?useFirestore=true
if (new URLSearchParams(window.location.search).get('useFirestore') === 'true') {
  localStorage.setItem('useFirestore', 'true');
}
```

### 8.3 監控和告警

在 Firebase Console 中設置告警：

1. 打開 Firebase Console
2. 進入 Firestore 監控
3. 設置告警條件：
   - 錯誤率 > 1%
   - 延遲 > 1000ms
   - 配額使用 > 80%

---

## Phase 9: 清理和優化（Day 18-20）

### 9.1 刪除舊系統

若 Firestore 穩定運行 7 天以上：

```bash
# 1. 備份 Google Sheets 數據
# 2. 禁用 Google Apps Script 觸發器
# 3. 刪除舊的 GAS 代碼
# 4. 保留 Sheets 作為只讀備份（永久保存）
```

### 9.2 性能調優

- [ ] 分析慢查詢，創建額外索引
- [ ] 優化 Cloud Functions 執行時間
- [ ] 實施快取策略（Redis 可選）

### 9.3 文檔更新

- [ ] 更新架構文檔
- [ ] 編寫 Firestore 查詢指南
- [ ] 記錄遷移過程和教訓

---

## 成本分析

### Firestore 免費層

| 項目 | 免費額度 | 成本 |
|------|---------|------|
| 讀取操作 | 50,000/天 | 免費 |
| 寫入操作 | 20,000/天 | 免費 |
| 刪除操作 | 20,000/天 | 免費 |
| 儲存空間 | 1 GB | 免費 |
| 網路出站 | 10 GB/月 | 免費 |

### 實際使用估算（100 名員工）

每天操作數：
- 打卡：200 次（上班 + 下班）= 200 次寫入
- 異常查詢：50 次 = 50 次讀取
- 會話驗證：300 次 = 300 次讀取
- 總計：550 次操作/天

**結論**：完全免費，無額外成本 ✅

### Cloud Functions 成本

| 項目 | 免費額度 | 預期成本 |
|------|---------|---------|
| 調用次數 | 200 萬/月 | 免費 |
| 計算時間 | 400,000 GB-秒/月 | 免費 |
| 網路流量 | 5 GB/月 出站 | 免費 |

**結論**：完全免費 ✅

---

## 風險和回滾計劃

### 風險評估

| 風險 | 可能性 | 影響 | 緩解措施 |
|------|--------|------|---------|
| 數據遷移丟失 | 低 | 高 | 驗證遷移數據，保留 Sheets 備份 |
| Firestore 無法連接 | 低 | 高 | 實現離線快取，回滾到 GAS |
| 前端適配錯誤 | 中 | 中 | 充分測試，灰度發佈 |
| 性能未達預期 | 低 | 中 | 添加索引，優化查詢 |

### 回滾步驟

若發現嚴重問題：

```bash
# 1. 立即切回舊系統
localStorage.setItem('useFirestore', 'false');

# 2. 恢復 Apps Script 觸發器
# （已保存，無需重新部署）

# 3. 通知用戶暫停使用
# （可在 15 分鐘內完成）

# 4. 調查問題原因
# 5. 修復後重新發佈
```

**回滾時間**：< 15 分鐘

---

## 時間表摘要

```
Week 1
├─ Day 1-2: 環境準備、創建數據庫
├─ Day 3-4: 數據遷移、索引創建
├─ Day 5-6: 後端重寫（Cloud Functions）
└─ Day 7: 安全規則配置

Week 2
├─ Day 8-11: 前端適配
├─ Day 12-13: 測試和驗證
└─ Day 14-17: 灰度發佈

Week 3
├─ Day 18-20: 清理和優化
└─ Day 21: 文檔更新和總結

總計：21 天（3 週）
實際工作量：~80-100 小時
```

---

## 成功標準

✅ **遷移成功的指標**：

1. **性能**：打卡耗時 < 800ms（現時 4.1s）
2. **準確性**：100% 數據遷移成功
3. **穩定性**：7 天無嚴重錯誤
4. **成本**：< $1/月（通常免費）
5. **用戶滿意度**：無負面反饋

---

## 進度追蹤表

在遷移過程中，使用此表格追蹤進度：

| 階段 | 任務 | 負責人 | 開始日期 | 完成日期 | 狀態 |
|------|------|--------|---------|---------|------|
| P1 | 創建 Firestore | - | - | - | 🔲 |
| P2 | 數據遷移 | - | - | - | 🔲 |
| P3 | 建立索引 | - | - | - | 🔲 |
| P4 | 後端重寫 | - | - | - | 🔲 |
| P5 | 安全規則 | - | - | - | 🔲 |
| P6 | 前端適配 | - | - | - | 🔲 |
| P7 | 測試驗證 | - | - | - | 🔲 |
| P8 | 灰度發佈 | - | - | - | 🔲 |
| P9 | 清理優化 | - | - | - | 🔲 |

---

## 文件清單

遷移過程中應保留的文件：

- ✅ `migrate-to-firestore.js` - 數據遷移腳本
- ✅ `serviceAccountKey.json` - Firebase 服務帳號（保密）
- ✅ `functions/` - Cloud Functions 代碼
- ✅ `firestore.rules` - 安全規則
- ✅ `FIRESTORE_MIGRATION_LOG.md` - 遷移日誌
- ✅ 原始 Google Sheets - 永久保存作為備份

---

## 下一步行動

1. ✅ **确認管理層同意**：評估 3 週時間和團隊投入
2. ✅ **準備環境**：創建 Firebase 專案，獲取必要權限
3. ✅ **組建團隊**：分配角色（PM、開發、測試）
4. ✅ **準備備份**：完整備份 Google Sheets 和 Apps Script
5. ✅ **開始 Phase 1**：按計劃推進

---

**文檔版本**: v1.0  
**最後更新**: 2026-04-23  
**作者**: Claude Code  
**估計完成日期**: 2026-05-21（21 天後）
