import type { PrismEvent } from '@prism/shared';

/**
 * IndexedDB 存储层 —— 零后端架构的落地
 *
 * 为什么选 IndexedDB 而不是 localStorage：
 * localStorage 有 5MB 硬上限且只能存字符串，监控数据在量大时会直接写爆；
 * IndexedDB 容量按磁盘剩余空间算（通常是几百 MB 起），并且支持结构化存储与索引，
 * 才能做「按时间排序」「淘汰最老数据」这些操作。
 *
 * 为什么把容量上限定在 5000 条：
 * 一个真实站点一天的异常事件通常在几十到几百条量级，5000 条足够回溯一周以上。
 * 再大只会拖慢看板的首次渲染，收益递减。
 */

const DB_NAME = 'prism';
const DB_VERSION = 1;
const STORE_EVENTS = 'events';
const INDEX_TIME = 'by_timestamp';

/** 超出这个条数就淘汰最老的事件，防止磁盘被写满 */
const MAX_EVENTS = 5000;

/**
 * 单个会话的事件上限。防止一个超长 SPA 会话把整个配额占满、
 * 把其他更有价值的会话挤出去。超过就删掉该会话最老的部分。
 */
const PER_SESSION_CAP = 2000;

function isSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * 打开数据库。只在首次调用或版本变化时触发 onupgradeneeded 建表。
 * 全程包 Promise 是因为 IndexedDB 是事件回调式的 API，
 * 不包一层的话调用方要写一堆 onsuccess/onerror，没法维护。
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const store = db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
        // 建时间索引是为了淘汰时能按时间顺序删，不用全表扫描
        store.createIndex(INDEX_TIME, 'timestamp');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 把一批事件写入库。用同一个事务批量写，比逐条写快一个数量级 */
export async function putEvents(events: PrismEvent[]): Promise<void> {
  if (!isSupported() || events.length === 0) return;

  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_EVENTS);
      for (const event of events) {
        store.put(event);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    await evictIfNeeded(db);
  } finally {
    // 用完立刻关，长时间持有连接会阻塞其他标签页的升级操作
    db.close();
  }
}

/** 超过容量上限时，先按时间从老到新删掉多余的部分（全局配额） */
async function evictIfNeeded(db: IDBDatabase): Promise<void> {
  const total = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readonly');
    const request = tx.objectStore(STORE_EVENTS).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (total > MAX_EVENTS) {
    const toDelete = total - MAX_EVENTS;
    let deleted = 0;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_EVENTS);
      // 顺着时间索引从头走，走到的就是最老的一批
      const cursorRequest = store.index(INDEX_TIME).openCursor();

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || deleted >= toDelete) {
          resolve();
          return;
        }
        cursor.delete();
        deleted += 1;
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
  }

  // 全局配额之内，仍然要保证单个会话不独占总空间
  await enforcePerSessionCap(db);
}

/**
 * 把单个会话的事件数压到 PER_SESSION_CAP 以内：超过的部分删掉最老的。
 * 这样即便某个会话异常嘈杂，也不会把其他会话的历史冲刷掉。
 */
async function enforcePerSessionCap(db: IDBDatabase): Promise<void> {
  const all = await new Promise<PrismEvent[]>((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readonly');
    const request = tx.objectStore(STORE_EVENTS).getAll();
    request.onsuccess = () => resolve(request.result as PrismEvent[]);
    request.onerror = () => reject(request.error);
  });

  const bySession = new Map<string, PrismEvent[]>();
  for (const event of all) {
    const list = bySession.get(event.sessionId) ?? [];
    list.push(event);
    bySession.set(event.sessionId, list);
  }

  const idsToDelete: string[] = [];
  for (const list of bySession.values()) {
    if (list.length <= PER_SESSION_CAP) continue;
    // 按时间升序，删掉最老的那一批，只留下最新的 PER_SESSION_CAP 条
    list.sort((a, b) => a.timestamp - b.timestamp);
    for (const event of list.slice(0, list.length - PER_SESSION_CAP)) {
      idsToDelete.push(event.id);
    }
  }

  if (idsToDelete.length === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    const store = tx.objectStore(STORE_EVENTS);
    for (const id of idsToDelete) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 读出全部事件，按时间正序。看板的列表与图表都依赖这个顺序 */
export async function readAllEvents(): Promise<PrismEvent[]> {
  if (!isSupported()) return [];

  const db = await openDb();
  try {
    const events = await new Promise<PrismEvent[]>((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, 'readonly');
      const request = tx.objectStore(STORE_EVENTS).index(INDEX_TIME).getAll();
      request.onsuccess = () => resolve(request.result as PrismEvent[]);
      request.onerror = () => reject(request.error);
    });
    return events;
  } finally {
    db.close();
  }
}

/** 清空所有数据。「导出并清理」和「重置」两种场景都用到 */
export async function clearEvents(): Promise<void> {
  if (!isSupported()) return;

  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      tx.objectStore(STORE_EVENTS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * 创建一个写入 IndexedDB 的 transport。
 * 之所以做成工厂函数：容量上限这类参数要留给调用方，
 * 而且 transport 本身不该持有状态。
 */
export function createIdbTransport(): (events: PrismEvent[]) => Promise<void> {
  return async (events: PrismEvent[]) => {
    try {
      await putEvents(events);
    } catch {
      // 写库失败（隐私模式、磁盘配额用尽）时静默降级，
      // 绝不因为存储问题影响页面本身
    }
  };
}
