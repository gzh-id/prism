/**
 * 会话管理 —— 零后端架构下，会话只能由 SDK 自己维护
 *
 * 为什么用 sessionStorage 而不是 localStorage：
 * sessionStorage 的生命周期就是「标签页开着」，关掉即清空，这正好是
 * 「一次会话」的定义。用 localStorage 会导致用户三天后回来还被算成同一会话，
 * 看板上的数据就串了。
 *
 * 为什么全程 try/catch：
 * 无痕模式、禁用 Cookie、iframe 沙箱下访问 sessionStorage 会直接抛异常，
 * 而 SDK 的底线是「绝不能拖垮宿主页面」。
 */

const SESSION_KEY = '__prism_session__';

export interface SessionState {
  id: string;
  startedAt: number;
  lastActiveAt: number;
}

function createSessionId(): string {
  // Date.now 保证大致有序，随机后缀保证同毫秒内不冲突
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSession(): SessionState {
  const now = Date.now();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SessionState>;
      if (parsed.id && parsed.startedAt) {
        const next: SessionState = {
          id: parsed.id,
          startedAt: parsed.startedAt,
          lastActiveAt: now,
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
        return next;
      }
    }
    const created: SessionState = { id: createSessionId(), startedAt: now, lastActiveAt: now };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(created));
    return created;
  } catch {
    // 拿不到存储就退化成「每次刷新都是新会话」，功能降级但不报错
    return { id: createSessionId(), startedAt: now, lastActiveAt: now };
  }
}
