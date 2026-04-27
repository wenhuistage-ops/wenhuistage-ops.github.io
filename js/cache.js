/**
 * 統一 Cache 層管理器
 * 支持 LRU 快取和 TTL 快取
 */

class CacheManager {
  constructor() {
    // 快取儲存：{ [cacheType]: { data: {}, order: [], expireTimes: {} } }
    this.caches = {};
    this.configs = {};
  }

  /**
   * 註冊新的快取類型
   * @param {string} name - 快取名稱（如 'month', 'monthDetail', 'abnormal'）
   * @param {object} options - 配置選項
   *   - maxSize: 最大項目數（LRU 模式）
   *   - ttl: 過期時間（毫秒，TTL 模式）
   */
  register(name, options = {}) {
    if (this.caches[name]) {
      console.warn(`快取 "${name}" 已存在，跳過註冊`);
      return;
    }

    this.caches[name] = {
      data: {},
      order: [], // LRU 順序
      expireTimes: {} // TTL 過期時間
    };

    this.configs[name] = {
      maxSize: options.maxSize || Infinity,
      ttl: options.ttl || null // null 表示無限期
    };

    console.log(`✓ 快取 "${name}" 已註冊 (maxSize: ${this.configs[name].maxSize}, ttl: ${this.configs[name].ttl}ms)`);
  }

  /**
   * 獲取快取數據
   * @param {string} cacheName - 快取名稱
   * @param {string} key - 快取鍵
   * @returns 快取數據，或 undefined 如果不存在或已過期
   */
  get(cacheName, key) {
    if (!this.caches[cacheName]) {
      console.warn(`快取 "${cacheName}" 不存在`);
      return undefined;
    }

    const cache = this.caches[cacheName];
    const data = cache.data[key];

    // 檢查 TTL 過期
    if (data !== undefined && cache.expireTimes[key]) {
      if (Date.now() > cache.expireTimes[key]) {
        // 數據已過期，刪除
        this.delete(cacheName, key);
        return undefined;
      }
    }

    // 更新 LRU 順序（移到末尾表示最近使用）
    if (data !== undefined && this.configs[cacheName].maxSize !== Infinity) {
      const index = cache.order.indexOf(key);
      if (index !== -1) {
        cache.order.splice(index, 1);
        cache.order.push(key);
      }
    }

    return data;
  }

  /**
   * 設置快取數據
   * @param {string} cacheName - 快取名稱
   * @param {string} key - 快取鍵
   * @param {*} data - 快取數據
   */
  set(cacheName, key, data) {
    if (!this.caches[cacheName]) {
      console.warn(`快取 "${cacheName}" 不存在`);
      return;
    }

    const cache = this.caches[cacheName];
    const config = this.configs[cacheName];

    // 如果鍵已存在，先移除
    if (key in cache.data) {
      const index = cache.order.indexOf(key);
      if (index !== -1) {
        cache.order.splice(index, 1);
      }
    }

    // 設置 TTL（如果配置了）
    if (config.ttl) {
      cache.expireTimes[key] = Date.now() + config.ttl;
    }

    // 存儲數據和更新順序
    cache.data[key] = data;
    cache.order.push(key);

    // 檢查 LRU 大小限制
    if (config.maxSize !== Infinity) {
      while (cache.order.length > config.maxSize) {
        const oldestKey = cache.order.shift();
        delete cache.data[oldestKey];
        delete cache.expireTimes[oldestKey];
      }
    }
  }

  /**
   * 刪除快取數據
   * @param {string} cacheName - 快取名稱
   * @param {string} key - 快取鍵
   */
  delete(cacheName, key) {
    if (!this.caches[cacheName]) return;

    const cache = this.caches[cacheName];
    const index = cache.order.indexOf(key);

    if (index !== -1) {
      cache.order.splice(index, 1);
    }

    delete cache.data[key];
    delete cache.expireTimes[key];
  }

  /**
   * 清空指定快取
   * @param {string} cacheName - 快取名稱
   */
  clear(cacheName) {
    if (!this.caches[cacheName]) return;

    const cache = this.caches[cacheName];
    cache.data = {};
    cache.order = [];
    cache.expireTimes = {};
  }

  /**
   * 清空所有快取
   */
  clearAll() {
    Object.keys(this.caches).forEach(name => this.clear(name));
  }

  /**
   * 獲取快取統計信息
   * @param {string} cacheName - 快取名稱（可選，不指定則返回所有）
   * @returns 統計信息
   */
  getStats(cacheName = null) {
    if (cacheName) {
      if (!this.caches[cacheName]) return null;
      const cache = this.caches[cacheName];
      return {
        name: cacheName,
        size: cache.order.length,
        maxSize: this.configs[cacheName].maxSize,
        ttl: this.configs[cacheName].ttl,
        keys: Object.keys(cache.data)
      };
    } else {
      // 返回所有快取統計
      const stats = {};
      Object.keys(this.caches).forEach(name => {
        const cache = this.caches[name];
        stats[name] = {
          size: cache.order.length,
          maxSize: this.configs[name].maxSize,
          ttl: this.configs[name].ttl
        };
      });
      return stats;
    }
  }

  /**
   * 打印快取信息（用於調試）
   */
  printStats() {
    console.group('📊 快取統計');
    Object.keys(this.caches).forEach(name => {
      const stats = this.getStats(name);
      console.log(`${name}: ${stats.size}/${stats.maxSize} (TTL: ${stats.ttl}ms)`);
    });
    console.groupEnd();
  }
}

// 創建全局快取管理器實例
const cacheManager = new CacheManager();

// 註冊預定義的快取類型
cacheManager.register('month', { maxSize: 12 }); // 月份摘要快取
cacheManager.register('monthDetail', { maxSize: 6 }); // 月份詳細快取
cacheManager.register('abnormal', { ttl: 5 * 60 * 1000 }); // 異常記錄快取（5分鐘 TTL）
cacheManager.register('adminMonth', { maxSize: 12 }); // 管理員月份快取
cacheManager.register('employeeList', { ttl: 10 * 60 * 1000 }); // 員工列表快取（10分鐘 TTL）
cacheManager.register('reviewRequest', { ttl: 60 * 1000 }); // 審核列表快取（60秒 TTL，approve/reject 後 invalidate）

console.log('✓ 快取管理器已初始化');
