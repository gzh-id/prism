/**
 * core 的单元测试。
 *
 * 为什么测的是 dist 产物而不是 src 源码：
 * 本项目跑在 Node 内置 test runner 上，直接吃 TS 源码需要额外的转译层。
 * 而测构建产物反而更贴近真实情况 —— 用户拿到的就是这个文件。
 *
 * 为什么只测纯函数：
 * 采集类逻辑依赖浏览器 API（PerformanceObserver、window.onerror），
 * 属于集成测试范畴，交给阶段 6 的 Playwright 在真实浏览器里验证。
 * 单元测试只负责「不依赖环境的确定性逻辑」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PrismClientImpl,
  RingBuffer,
  shouldSample,
  sanitizeUrl,
  sanitizeData,
  rateMetric,
  hashString,
  buildReport,
  compressString,
  decompressString,
  toBase64,
  fromBase64,
} from '../dist/index.js';

test('RingBuffer：写满后覆盖最老的，且保持时间正序', () => {
  const buffer = new RingBuffer(3);
  buffer.push('a');
  buffer.push('b');
  buffer.push('c');
  assert.deepEqual(buffer.toArray(), ['a', 'b', 'c']);

  // 写入第 4 条后，最老的 'a' 应该被挤掉
  buffer.push('d');
  assert.deepEqual(buffer.toArray(), ['b', 'c', 'd']);
  assert.equal(buffer.size, 3);
});

test('RingBuffer：未写满时 size 正确，不返回空位', () => {
  const buffer = new RingBuffer(20);
  buffer.push('x');
  assert.equal(buffer.size, 1);
  assert.deepEqual(buffer.toArray(), ['x']);
});

test('shouldSample：同一 sessionId 决策必须稳定', () => {
  // 这是采样策略的核心保证：不能同一个会话一会儿采一会儿不采
  const id = 'session-abc';
  const first = shouldSample(id, 0.5);
  for (let i = 0; i < 100; i += 1) {
    assert.equal(shouldSample(id, 0.5), first, '同会话的采样决策必须一致');
  }
});

test('shouldSample：边界值', () => {
  assert.equal(shouldSample('anything', 0), false);
  assert.equal(shouldSample('anything', 1), true);
});

test('hashString：确定性、取值范围，以及短输入扩散弱这个已知前提', () => {
  assert.equal(hashString('prism'), hashString('prism'));
  assert.notEqual(hashString('prism'), hashString('prizm'));
  const h = hashString('prism');
  assert.ok(h >= 0 && h <= 0xffffffff, '哈希必须落在无符号 32 位范围内');

  // djb2 对定长短输入是线性映射，所以 's1' ~ 'sz' 会挤在同一个桶里。
  // 这条断言是在钉住这个被记录在源码注释里的前提 —— 换来的是：
  // 以后谁想换哈希算法，必须先回答「短 ID 采样退化」有没有被解决，而不是默默改掉。
  const short = ['s1', 's2', 's3', 's9', 'sa', 'sz'].map((s) => hashString(s) / 0xffffffff);
  const spread = Math.max(...short) - Math.min(...short);
  assert.ok(spread < 0.001, `同长度的短 ID 应几乎落在同一个桶，实测极差 ${spread}`);

  // 反过来，本项目真实生成的 sessionId（时间戳36进制-8位随机，约 20 字符）
  // 必须扩散良好，否则采样功能等于废掉
  const long = [
    'mutc5z3b-gp840a2l',
    'mutc5z3b-yvlv57rh',
    'mutc5z3b-b3ltolib',
    'mutc5z3b-7ucqx8z8',
  ].map((s) => hashString(s) / 0xffffffff);
  assert.ok(Math.max(...long) - Math.min(...long) > 0.5, '真实长度的 sessionId 必须扩散良好');
});

test('sanitizeUrl：剔除敏感 query 参数，保留其余部分', () => {
  const url = 'https://a.com/api?user=1&token=secret&page=2&access_token=xxx';
  const result = sanitizeUrl(url);
  assert.ok(!result.includes('token'), 'token 必须被剔除');
  assert.ok(!result.includes('secret'), '敏感值本身也不能留下');
  assert.ok(result.includes('user=1'), '非敏感参数要保留');
  assert.ok(result.includes('page=2'), '非敏感参数要保留');
});

test('sanitizeUrl：无 query 时原样返回', () => {
  assert.equal(sanitizeUrl('https://a.com/home'), 'https://a.com/home');
});

test('sanitizeData：删除命中敏感 key 的字段', () => {
  const out = sanitizeData({ name: 'tom', password: '123456', age: 18 });
  assert.equal(out.name, 'tom');
  assert.equal(out.age, 18);
  assert.equal('password' in out, false);
});

test('sanitizeUrl：不应误伤 design / author / assignment 这类正常参数', () => {
  // 早期版本用子串匹配，会把含 sign / auth 片段的正常参数误删
  const url = 'https://a.com/?design=blue&author=Jane&assignment=5&page=2';
  const result = sanitizeUrl(url);
  assert.ok(result.includes('design=blue'), 'design 不是敏感参数，必须保留');
  assert.ok(result.includes('author=Jane'), 'author 不是敏感参数，必须保留');
  assert.ok(result.includes('assignment=5'), 'assignment 不是敏感参数，必须保留');
  assert.ok(result.includes('page=2'), '其余参数照常保留');
});

test('sanitizeData：删除敏感 key 但保留 design / author 等正常字段', () => {
  const out = sanitizeData({
    name: 'tom',
    password: '123456',
    access_token: 'xxx',
    design: 'blue',
    author: 'Jane',
  });
  assert.equal(out.name, 'tom');
  assert.equal(out.design, 'blue');
  assert.equal(out.author, 'Jane');
  assert.equal('password' in out, false, 'password 必须被删除');
  assert.equal('access_token' in out, false, 'access_token 必须被删除');
});

test('报告：压缩 + Base64 往返后数据必须完全一致', async () => {
  // 这是「单文件离线报告」能不能用的底线：压缩是有损的吗？不是，必须能原样还原
  const original = JSON.stringify({ hello: '棱镜', list: [1, 2, 3], nested: { a: { b: 1 } } });
  const compressed = await compressString(original);
  const restored = await decompressString(fromBase64(toBase64(compressed)));
  assert.equal(restored, original);
});

test('报告：JSON 压缩率应该显著（这是导出功能的立身之本）', async () => {
  // 监控数据高度重复（同样的 url、userAgent、字段名），gzip 压缩率通常很高
  const repeated = JSON.stringify(
    Array.from({ length: 200 }, (_, i) => ({
      type: 'network',
      url: 'https://example.com/api/list',
      status: 200,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) same-ua',
      index: i,
    })),
  );
  const compressed = await compressString(repeated);
  const ratio = compressed.length / repeated.length;
  assert.ok(ratio < 0.3, `压缩后应小于原始体积的 30%，实际 ${(ratio * 100).toFixed(1)}%`);
});

test('buildReport：把事件按 sessionId 聚合成会话', () => {
  const base = {
    sessionId: 's1',
    release: '1.0.0',
    environment: 'production',
    url: 'https://a.com',
    userAgent: 'ua',
  };
  const report = buildReport([
    { ...base, id: '1', type: 'error', kind: 'js', message: 'a', severity: 'error', breadcrumbs: [], timestamp: 100 },
    { ...base, id: '2', type: 'error', kind: 'js', message: 'b', severity: 'error', breadcrumbs: [], timestamp: 300 },
    { ...base, sessionId: 's2', id: '3', type: 'error', kind: 'js', message: 'c', severity: 'error', breadcrumbs: [], timestamp: 200 },
  ]);

  assert.equal(report.sessions.length, 2, '两个不同 sessionId 应聚成两个会话');
  const s1 = report.sessions.find((s) => s.id === 's1');
  assert.equal(s1.eventCount, 2);
  assert.equal(s1.startedAt, 100, '会话开始时间取最早的事件');
  assert.equal(s1.lastActiveAt, 300, '会话活跃时间取最晚的事件');
});

test('rateMetric：严格按官方阈值分档', () => {
  assert.equal(rateMetric('LCP', 2000), 'good');
  assert.equal(rateMetric('LCP', 2500), 'good', '恰好等于 good 上限应算 good');
  assert.equal(rateMetric('LCP', 3000), 'needs-improvement');
  assert.equal(rateMetric('LCP', 4000), 'needs-improvement');
  assert.equal(rateMetric('LCP', 4001), 'poor');
  assert.equal(rateMetric('CLS', 0.05), 'good');
  assert.equal(rateMetric('CLS', 0.3), 'poor');
});

test('finalize：页面隐藏时 client 先调用插件的 beforeFlush 再 drain 队列', () => {
  const captured = [];
  const integration = {
    name: 't',
    setup() {},
    beforeFlush(c) {
      c.captureMetric('INP', 123);
    },
  };
  const client = new PrismClientImpl({
    integrations: [integration],
    transport: (evts) => {
      captured.push(...evts);
    },
  });

  // 模拟页面隐藏：client 应调用 beforeFlush 把内部缓冲刷进队列并 drain
  client.finalize();

  assert.equal(captured.length, 1, 'beforeFlush 贡献的事件应被 drain 出去');
  assert.equal(captured[0].name, 'INP');
});
