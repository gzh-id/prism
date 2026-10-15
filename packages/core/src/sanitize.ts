/**
 * 默认脱敏 —— 本项目「隐私优先」这条承诺的兜底实现
 *
 * 为什么必须在 SDK 里做，而不是等上报时做：
 * 一旦数据离开浏览器，就已经造成泄露了。零后端架构下数据存在本地，
 * 但用户可能会把导出的 HTML 报告发给别人，所以入库前就必须已经脱敏。
 *
 * 实现方式：用一份「敏感参数名精确匹配表」来判定，而不是子串包含匹配。
 * 早期版本用 /(token|sign|auth|...)/i 做子串匹配，会误伤 design、assignment、
 * resign、author 这类完全不敏感的参数（它们恰好包含 sign / auth 子串）。
 * 精确匹配表可解释、可扩展，也更好在面试里讲清「为什么这样不会误伤」。
 */

/**
 * 敏感参数名白名单（精确匹配，小写）。
 * 同时覆盖常见前缀/后缀变体：access_token、card_number、authorization 等。
 * 注意：这里不放 'auth' 这种「既是前缀也是正常词根」的片段，
 * 否则 'author'（博客作者参数）会被误杀；'authorization' 单独列出。
 */
const SENSITIVE_KEYS = new Set<string>([
  // 密码类
  'password', 'passwd', 'pwd', 'pass', 'passphrase',
  // 令牌类（含常见下划线变体）
  'token', 'access_token', 'refresh_token', 'auth_token', 'id_token', 'csrf_token',
  'accesstoken', 'refreshtoken', 'csrftoken', 'authtoken',
  'idtoken', 'usertoken', 'remembertoken', 'xcsrftoken', 'xtoken',
  // 密钥类
  'secret', 'apikey', 'api_key', 'accesskey', 'access_key', 'privatekey', 'private_key',
  // 鉴权类
  'authorization',
  // 会话类
  'session', 'sessionid', 'session_id', 'sid',
  // Cookie 类
  'cookie', 'setcookie', 'cookies',
  // 证件类
  'idcard', 'id_card', 'idnumber', 'id_number',
  // 手机号类
  'phone', 'mobile', 'telephone', 'cellphone',
  // 卡号类
  'card', 'cardno', 'cardnumber', 'card_no', 'card_number', 'bankcard',
  // 签名类
  'sign', 'signature', 'signkey', 'sign_key',
]);

/** 判定一个参数名是否敏感：小写精确匹配白名单 */
function isSensitiveKey(rawKey: string): boolean {
  // 去掉可能存在的 fragment（# 之后），只对 query 部分做判定
  const key = rawKey.split('#')[0]?.trim().toLowerCase() ?? '';
  return SENSITIVE_KEYS.has(key);
}

/** 脱敏 URL：保留 path，剔除敏感 query 参数 */
export function sanitizeUrl(rawUrl: string): string {
  const qIndex = rawUrl.indexOf('?');
  if (qIndex === -1) return rawUrl;

  const base = rawUrl.slice(0, qIndex);
  const query = rawUrl.slice(qIndex + 1);
  const kept = query.split('&').filter((pair) => {
    const key = pair.split('=')[0] ?? '';
    return !isSensitiveKey(key);
  });

  return kept.length > 0 ? `${base}?${kept.join('&')}` : base;
}

/** 脱敏结构化数据：命中敏感 key 的字段直接删除 */
export function sanitizeData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (isSensitiveKey(key)) continue;
    out[key] = data[key];
  }
  return out;
}
