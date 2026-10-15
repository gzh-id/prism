/**
 * 稳定采样 —— 决定「这个会话的数据要不要采集」
 *
 * 为什么不用 Math.random()：
 * 如果每一条事件都独立掷骰子，同一个用户的会话里，前 5 条上报了、后 3 条被丢了。
 * 结果就是看板上看到的用户行为轨迹是断的：点击 → 请求 → 【空】→ 报错。
 * 排障时最需要的恰恰是连续轨迹，所以采样必须是「会话级」的稳定决策。
 *
 * 做法：对 sessionId 做哈希，把哈希值映射到 0~1，小于采样率就采。
 * 同一个 sessionId 永远得到同一个结果，不需要存任何状态。
 */

/**
 * djb2 字符串哈希。短小、够快、分布均匀，几行代码就能满足稳定采样需求。
 *
 * ⚠️ 一个实测出来的前提：djb2 对「长度很短的输入」几乎没有扩散能力。
 * 因为对定长输入来说它的结果是线性的，同长度的短 ID 会全部落进同一个桶 ——
 * 实测 's1' 's2' … 'sz' 的哈希比例全都是 0.00137。
 * 后果是：如果调用方传进来的 sessionId 只有两三个字符，采样就退化成「要么全采、要么全丢」。
 * 本项目自产的 sessionId 是 `时间戳36进制-8位随机`（约 20 字符），实测扩散正常
 * （样本比值从 0.08 到 0.99 均有覆盖），所以不受影响。
 * 但把它当通用工具复用时，必须保证 ID 有足够的长度和熵。
 */
export function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  // 转成无符号 32 位，保证后面除法落在 0~1
  return hash >>> 0;
}

/**
 * @param sessionId 会话标识，同一会话必须传入同一个值
 * @param rate 采样率 0~1
 */
export function shouldSample(sessionId: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const ratio = hashString(sessionId) / 0xffffffff;
  return ratio < rate;
}
