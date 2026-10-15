#!/usr/bin/env node
/**
 * 代码导览生成器 —— 把源码变成一份可点击翻页的讲解页面
 *
 * 为什么用「生成器 + 行号区间」而不是手写 HTML：
 * 讲解里贴的代码如果靠手抄，改一次源码就全对不上了。
 * 这里所有代码片段都通过 [起始行, 结束行] 从真实源文件里抽，
 * 所以页面上的代码和编辑器里的永远一致，行号也能直接对着看。
 *
 * 用法：
 *   node scripts/make-walkthrough.mjs
 * 产出：
 *   docs/代码导览.html（单文件，双击即可打开，无外部依赖）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import corePages from './walkthrough/data-core.mjs';
import pluginPages from './walkthrough/data-plugins.mjs';
import dashboardPages from './walkthrough/data-dashboard.mjs';
import engineeringPages from './walkthrough/data-engineering.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const PAGES = [...corePages, ...pluginPages, ...dashboardPages, ...engineeringPages];

/* ------------------------------------------------------------------ 代码高亮 */

/** 只转义这三个字符，引号保留原样，否则字符串正则就匹配不到了 */
function esc(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'import', 'export', 'default', 'from', 'as', 'class', 'extends', 'implements',
  'interface', 'type', 'enum', 'new', 'try', 'catch', 'finally', 'throw', 'await',
  'async', 'typeof', 'instanceof', 'in', 'of', 'this', 'super', 'null', 'undefined',
  'true', 'false', 'readonly', 'private', 'public', 'protected', 'static', 'get',
  'set', 'void', 'never', 'unknown', 'any', 'string', 'number', 'boolean', 'break',
  'continue', 'delete', 'keyof', 'declare', 'namespace',
]);

function span(cls, text) {
  return `<span class="${cls}">${text}</span>`;
}

/** 普通文本里挑出关键字和数字着色 */
function colorizePlain(text) {
  return text.replace(/([A-Za-z_$][A-Za-z0-9_$]*)|(\d[\w.]*)/g, (match, word, num) => {
    if (word && KEYWORDS.has(word)) return span('k', match);
    if (num) return span('n', match);
    return match;
  });
}

/**
 * 逐行高亮。
 *
 * 为什么必须逐行扫而不是全文跑一个正则：
 * 块注释和字符串会跨行，全文高亮后再按行切开，span 就被拦腰截断了。
 * 这里用一个跨行延续的状态（{ block, quote }）让每一行都知道自己从什么状态开始。
 */
function highlight(code) {
  const state = { block: false, quote: null };
  const out = [];

  for (const line of code.split('\n')) {
    let html = '';
    let plain = '';
    let i = 0;

    const flush = () => {
      if (plain) html += colorizePlain(esc(plain));
      plain = '';
    };

    while (i < line.length) {
      // 处于块注释中：找到 */ 才出来
      if (state.block) {
        const end = line.indexOf('*/', i);
        if (end === -1) {
          html += span('c', esc(line.slice(i)));
          i = line.length;
        } else {
          html += span('c', esc(line.slice(i, end + 2)));
          i = end + 2;
          state.block = false;
        }
        continue;
      }

      // 处于字符串中：找到同种引号才出来
      if (state.quote) {
        const quote = state.quote;
        let j = i;
        let closed = false;
        while (j < line.length) {
          if (line[j] === '\\') {
            j += 2;
            continue;
          }
          if (line[j] === quote) {
            j += 1;
            closed = true;
            break;
          }
          j += 1;
        }
        html += span('s', esc(line.slice(i, Math.min(j, line.length))));
        if (closed) {
          state.quote = null;
          i = j;
        } else {
          i = line.length;
        }
        continue;
      }

      const ch = line[i];
      const next = line[i + 1];

      if (ch === '/' && next === '/') {
        flush();
        html += span('c', esc(line.slice(i)));
        i = line.length;
        continue;
      }
      if (ch === '/' && next === '*') {
        flush();
        // 只置状态、不推进 i —— 让块注释分支从 '/*' 本身开始扫，
        // 否则开头的 '/*' 会被吃掉（曾把 '/**' 渲染成 '*'，被校验脚本抓到）
        state.block = true;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        flush();
        // 只输出开引号，然后把状态挂上 —— 字符串内容交给下一轮循环的
        // state.quote 分支去扫，它会一直吃到闭引号为止
        state.quote = ch;
        i += 1;
        html += span('s', esc(ch));
        continue;
      }

      plain += ch;
      i += 1;
    }

    flush();
    out.push(html);
  }

  return out;
}

/* ------------------------------------------------------------------ 读代码 */

const fileCache = new Map();

function readLines(relPath) {
  if (!fileCache.has(relPath)) {
    const abs = resolve(root, relPath);
    if (!existsSync(abs)) {
      throw new Error(`源文件不存在：${relPath}`);
    }
    fileCache.set(relPath, readFileSync(abs, 'utf-8').split('\n'));
  }
  return fileCache.get(relPath);
}

/**
 * 按区间抽代码。
 * ranges 形如 [[13, 21], [27, 32]]，行号按 1 开始、闭区间，
 * 和编辑器里显示的行号完全一致。
 */
function extract(relPath, ranges) {
  const lines = readLines(relPath);
  const picked = [];

  ranges.forEach((range, index) => {
    const [from, to] = range;
    if (index > 0) {
      picked.push({ gap: true, text: '⋯', line: from });
    }
    for (let n = from; n <= to && n <= lines.length; n += 1) {
      picked.push({ gap: false, text: lines[n - 1] ?? '', line: n });
    }
  });

  return picked;
}

/* ------------------------------------------------------------------ 渲染 */

function renderCode(relPath, ranges) {
  const picked = extract(relPath, ranges);
  const first = picked.find((p) => !p.gap);
  const last = [...picked].reverse().find((p) => !p.gap);

  const body = picked
    .map((p) => {
      const content = p.gap ? '⋯' : highlight(p.text)[0];
      const cls = p.gap ? 'lin ln-gap' : 'lin';
      return `<div class="${cls}"><span class="lg">${p.gap ? '' : p.line}</span><span class="lc">${content}</span></div>`;
    })
    .join('');

  return `
  <div class="code">
    <div class="code-head">
      <span class="code-path">${esc(relPath)}</span>
      <span class="code-range">第 ${first?.line ?? 0}–${last?.line ?? 0} 行</span>
    </div>
    <div class="code-body">${body}</div>
  </div>`;
}

/** 一段文字，支持字符串或 { list } 两种写法 */
function renderNote(note) {
  if (!note) return '';
  if (typeof note === 'string') return `<p>${note}</p>`;
  if (Array.isArray(note)) return note.map((n) => renderNote(n)).join('');
  if (note.list) {
    return `<ul>${note.list.map((t) => `<li>${t}</li>`).join('')}</ul>`;
  }
  if (note.flow) {
    return `<div class="flow">${note.flow
      .map((s, i) => `${i > 0 ? '<i>→</i>' : ''}<b>${s}</b>`)
      .join('')}</div>`;
  }
  if (note.table) {
    const [head, ...rows] = note.table;
    return `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
      .join('')}</tbody></table>`;
  }
  return '';
}

function renderGotchas(items) {
  if (!items || items.length === 0) return '';
  return `
  <div class="gotchas">
    ${items
      .map(
        (g) => `
      <div class="gotcha">
        <div class="gotcha-t">${g.t}</div>
        <div class="gotcha-d">${g.d}</div>
      </div>`,
      )
      .join('')}
  </div>`;
}

function renderPage(page) {
  const blocks = (page.blocks ?? [])
    .map((b) => {
      const parts = [`<h3>${b.h}</h3>`];
      if (b.code) parts.push(renderCode(page.file, b.code));
      if (b.note) parts.push(renderNote(b.note));
      if (b.list) parts.push(renderNote({ list: b.list }));
      if (b.table) parts.push(renderNote({ table: b.table }));
      if (b.flow) parts.push(renderNote({ flow: b.flow }));
      return `<div class="block">${parts.join('')}</div>`;
    })
    .join('');

  const problem = renderNote(page.problem);

  return `
  <section class="page" id="p-${page.id}" data-id="${page.id}">
    <div class="pg-head">
      <div class="pg-group">${page.group}</div>
      <h1>${page.title}</h1>
      ${page.file ? `<div class="pg-file">${esc(page.file)}${page.loc ? ` · ${page.loc} 行` : ''}</div>` : ''}
    </div>
    ${page.pitch ? `<p class="pitch">${page.pitch}</p>` : ''}
    ${page.extra ?? ''}
    ${problem ? `<h2>它解决什么问题</h2>${problem}` : ''}
    ${blocks ? `<h2>怎么写的</h2>${blocks}` : ''}
    ${page.gotchas ? `<h2>注意的地方</h2>${renderGotchas(page.gotchas)}` : ''}
    ${page.interview ? `<div class="interview"><b>面试怎么答</b><p>${page.interview}</p></div>` : ''}
    <div class="pg-foot">
      <button class="pager" data-go="prev">← 上一页</button>
      <span class="pg-hint">也可以按键盘的 ← → 翻页</span>
      <button class="pager" data-go="next">下一页 →</button>
    </div>
  </section>`;
}

function renderNav(pages) {
  const groups = [];
  for (const page of pages) {
    const last = groups[groups.length - 1];
    if (!last || last.name !== page.group) groups.push({ name: page.group, items: [page] });
    else last.items.push(page);
  }

  return groups
    .map(
      (g) => `
    <div class="nav-group">
      <div class="nav-g">${g.name}</div>
      ${g.items
        .map(
          (p) =>
            `<button class="nav-i" data-go="${p.id}"><span class="nav-n"></span>${p.nav ?? p.title}</button>`,
        )
        .join('')}
    </div>`,
    )
    .join('');
}

/* ------------------------------------------------------------------ 说明页 */

const INTRO = `
<section class="page" id="p-start" data-id="start">
  <div class="pg-head">
    <div class="pg-group">开始</div>
    <h1>先说实话：这些代码是谁写的</h1>
  </div>

  <p class="pitch">这份导览覆盖 ${PAGES.length} 个模块，一个模块一页。</p>

  <h2>署名</h2>
  <p>
    你问「这里这么多文件和代码，哪些是你写的」——答案是<b>全部都是 AI 写的</b>。
    <code>prism</code> 目录下约 2900 行源码，按模块拆成 ${PAGES.length} 页，
    没有一个字是你敲的。这点没什么好含糊的，含糊了在面试里会付出代价。
  </p>
  <p>但「谁写的」和「谁的设计」是两件事。真实的协作分工是这样的：</p>
  <table>
    <thead><tr><th>环节</th><th>谁做的</th><th>具体是什么</th></tr></thead>
    <tbody>
      <tr><td>方向与标准</td><td><b>你</b></td><td>定下「真实需求 / 设计点新颖 / 有技术纵深」三条筛选标准，以及技术栈、工期</td></tr>
      <tr><td>需求与范围</td><td><b>你</b></td><td>决定做「零后端、隐私优先的可观测性工具」，并砍掉不做的部分</td></tr>
      <tr><td>验收与反馈</td><td><b>你</b></td><td>跑演示、截图上反馈、指出 LCP 图空白等实际问题</td></tr>
      <tr><td>编码实现</td><td>AI</td><td>全部源码、测试、构建脚本、文档</td></tr>
      <tr><td>缺陷发现与修复</td><td>AI</td><td>Web Vitals 上报时机缺陷、djb2 短输入退化</td></tr>
    </tbody>
  </table>

  <div class="gotchas">
    <div class="gotcha warn">
      <div class="gotcha-t">面试里怎么说才对</div>
      <div class="gotcha-d">
        不要说「这个项目是我写的」。一旦这么开口，面试官的下一个动作就是往细节里钻，
        而细节是背不出来的。改说：「<b>我定需求和技术方案，用 AI 辅助实现，代码我逐模块审过。</b>」
        —— 这句话是真的，而且把考场拉到了你真正的强项上。
      </div>
    </div>
    <div class="gotcha">
      <div class="gotcha-t">面试官真正在考什么</div>
      <div class="gotcha-d">
        不是「你敲了多少行」，而是「你为什么这么选」。比如：为什么采样要按会话不按事件？
        为什么面包屑不能用数组而要用环形缓冲？为什么资源加载失败必须在捕获阶段监听？
        这些问题的答案就在后面每一页的<b>「注意的地方」</b>里。这份导览的存在意义，
        就是让你能把这 ${PAGES.length} 页全部讲出来。
      </div>
    </div>
  </div>

  <h2>整条链路长什么样</h2>
  <div class="flow big">
    <b>页面里的用户操作</b><i>→</i>
    <b>四个采集插件</b><i>→</i>
    <b>内核：采样 / 脱敏 / 入队</b><i>→</i>
    <b>IndexedDB 落盘</b><i>→</i>
    <b>看板读出来画图</b><i>→</i>
    <b>导出单文件报告</b>
  </div>

  <h2>怎么用这份导览</h2>
  <ul>
    <li>左边点文件名切页，也可以按键盘 <b>← →</b> 翻页</li>
    <li>每一页都有一段<b>真实源码</b>（从源文件按行号抽出来的，和 VS Code 里一致）</li>
    <li>建议顺序读：先内核 → 再插件 → 再看板 → 最后工程化</li>
    <li>每页最后有「面试怎么答」，背下来就能接住追问</li>
  </ul>

  <div class="pg-foot">
    <span></span>
    <span class="pg-hint">一共 ${PAGES.length} 页，从左边开始</span>
    <button class="pager" data-go="next">下一页 →</button>
  </div>
</section>`;

/* ------------------------------------------------------------------ 组装 */

const css = `
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --purple:#534AB7;--purple-l:#EEEDFE;--purple-d:#3C3489;
  --green:#1D9E75;--green-l:#E1F5EE;--green-d:#085041;
  --amber:#BA7517;--amber-l:#FAEEDA;--amber-d:#633806;
  --pink:#D4537E;--pink-l:#FBEAF0;
  --ink:#1F1F28;--ink2:#55555F;--ink3:#8A8A96;
  --bg:#FAFAFC;--card:#fff;--line:#E8E8EF;--line2:#F2F2F7;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Courier New",monospace;
}
html,body{height:100%}
body{
  font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:var(--bg);color:var(--ink);font-size:14px;line-height:1.75;
  -webkit-font-smoothing:antialiased;
}
code{font-family:var(--mono);font-size:.92em;background:var(--purple-l);color:var(--purple-d);
  padding:1px 5px;border-radius:4px}

.app{display:flex;min-height:100vh}

/* 侧栏 */
.side{
  width:270px;flex:0 0 270px;background:var(--card);border-right:1px solid var(--line);
  height:100vh;position:sticky;top:0;overflow-y:auto;padding:20px 0 40px;
}
.brand{padding:0 20px 4px;font-size:16px;font-weight:500;color:var(--purple-d);
  display:flex;align-items:center;gap:8px}
.brand i{width:9px;height:9px;border-radius:50%;background:var(--green);display:inline-block;
  animation:pulse 2.2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.8)}}
.side-meta{padding:0 20px 16px;font-size:12px;color:var(--ink3)}
.nav-group{margin-top:14px}
.nav-g{padding:6px 20px;font-size:11px;letter-spacing:.08em;color:var(--ink3);text-transform:uppercase}
.nav-i{
  display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:none;border:0;
  padding:7px 20px;font-size:13px;color:var(--ink2);cursor:pointer;font-family:inherit;
  border-left:2px solid transparent;transition:background .15s,color .15s,border-color .15s;
}
.nav-i:hover{background:var(--line2);color:var(--ink)}
.nav-i.on{background:var(--green-l);color:var(--green-d);border-left-color:var(--green);font-weight:500}
.nav-n{font-size:11px;color:var(--ink3);min-width:16px;font-family:var(--mono)}
.nav-i.on .nav-n{color:var(--green)}

/* 主区 */
.main{flex:1;min-width:0;max-width:920px;padding:0 40px 80px}
.bar{
  position:sticky;top:0;z-index:9;background:rgba(250,250,252,.92);backdrop-filter:blur(6px);
  display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);
  margin-bottom:26px;
}
.bar button{
  background:var(--card);border:1px solid var(--line);border-radius:8px;padding:5px 12px;
  font-size:13px;color:var(--ink2);cursor:pointer;font-family:inherit;transition:all .15s;
}
.bar button:hover{border-color:var(--purple);color:var(--purple)}
.bar button:disabled{opacity:.35;cursor:default}
.bar button:disabled:hover{border-color:var(--line);color:var(--ink2)}
#pos{font-size:12px;color:var(--ink3);font-family:var(--mono)}
.progress{flex:1;height:3px;background:var(--line);border-radius:2px;overflow:hidden}
.progress i{display:block;height:100%;background:linear-gradient(90deg,var(--green),var(--purple));
  border-radius:2px;transition:width .3s ease}

/* 页面 */
.page{display:none;animation:fade .28s ease}
.page.on{display:block}
/* JS 没跑起来时（被禁用 / 报错）至少让第一页可见，不能整页空白 */
body:not(.js) #p-start{display:block}
@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.pg-head{margin-bottom:18px}
.pg-group{display:inline-block;font-size:11px;letter-spacing:.06em;color:var(--green-d);
  background:var(--green-l);padding:2px 9px;border-radius:20px;margin-bottom:9px}
.pg-head h1{font-size:25px;font-weight:500;letter-spacing:-.01em;font-family:var(--mono)}
.pg-file{font-size:12px;color:var(--ink3);font-family:var(--mono);margin-top:4px}
.pitch{font-size:15px;color:var(--purple-d);background:var(--purple-l);padding:12px 16px;
  border-radius:10px;margin-bottom:8px;border-left:3px solid var(--purple)}

h2{font-size:15px;font-weight:500;margin:30px 0 12px;padding-bottom:7px;border-bottom:1px solid var(--line)}
h2::before{content:'';display:inline-block;width:3px;height:13px;background:var(--purple);
  border-radius:2px;margin-right:9px;vertical-align:-1px}
h3{font-size:13.5px;font-weight:500;color:var(--purple-d);margin:22px 0 10px}
.block{margin-bottom:6px}
.block h3:first-child{margin-top:16px}
p{margin:9px 0;color:var(--ink2)}
p b,li b{color:var(--ink);font-weight:500}
ul,ol{margin:9px 0 9px 20px;color:var(--ink2)}
li{margin:5px 0}

table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
th,td{border:1px solid var(--line);padding:7px 11px;text-align:left;vertical-align:top}
th{background:var(--line2);font-weight:500;color:var(--ink)}

.flow{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin:12px 0}
.flow b{background:var(--card);border:1px solid var(--line);border-radius:7px;padding:5px 11px;
  font-size:12.5px;font-weight:400;color:var(--ink)}
.flow i{color:var(--ink3);font-style:normal;font-size:12px}
.flow.big b{border-color:var(--purple-l);background:var(--purple-l);color:var(--purple-d)}

/* 代码 */
.code{border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:14px 0;
  background:#FCFCFD;transition:border-color .18s}
.code:hover{border-color:#D6D6E4}
.code-head{display:flex;justify-content:space-between;align-items:center;gap:10px;
  padding:7px 13px;background:var(--line2);border-bottom:1px solid var(--line);
  font-family:var(--mono);font-size:11.5px;color:var(--ink3)}
.code-path{color:var(--purple-d)}
.code-range{color:var(--ink3);white-space:nowrap}
.code-body{overflow-x:auto;padding:10px 0}
.lin{display:flex;font-family:var(--mono);font-size:12.5px;line-height:1.65;white-space:pre}
.lin:hover{background:#F6F6FA}
.lg{flex:0 0 42px;text-align:right;padding-right:13px;color:#C0C0CC;user-select:none}
.lc{flex:1;padding-right:14px}
.ln-gap .lg{color:transparent}
.ln-gap .lc{color:var(--ink3)}
.k{color:#7C3AED}
.s{color:#1D9E75}
.c{color:#9A9AA8;font-style:italic}
.n{color:#BA7517}

/* 坑 */
.gotchas{display:flex;flex-direction:column;gap:10px;margin:12px 0}
.gotcha{border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:9px;
  padding:11px 15px;background:var(--card);transition:transform .18s,box-shadow .18s}
.gotcha:hover{transform:translateX(3px);box-shadow:0 3px 14px rgba(83,74,183,.08)}
.gotcha.warn{border-left-color:var(--pink);background:var(--pink-l)}
.gotcha-t{font-weight:500;font-size:13.5px;color:var(--amber-d);margin-bottom:3px}
.gotcha.warn .gotcha-t{color:var(--pink)}
.gotcha-d{font-size:13px;color:var(--ink2)}

/* 面试 */
.interview{margin:26px 0 0;padding:13px 17px;border-radius:10px;background:var(--green-l);
  border-left:3px solid var(--green)}
.interview b{font-size:12px;letter-spacing:.05em;color:var(--green-d);display:block;margin-bottom:3px}
.interview p{margin:0;color:var(--green-d);font-size:13.5px}

.pg-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;
  margin-top:44px;padding-top:20px;border-top:1px solid var(--line)}
.pg-hint{font-size:12px;color:var(--ink3)}
.pager{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 15px;
  font-size:13px;color:var(--ink2);cursor:pointer;font-family:inherit;transition:all .15s}
.pager:hover{border-color:var(--purple);color:var(--purple);transform:translateY(-1px)}

@media(max-width:820px){
  .side{display:none}
  .main{padding:0 18px 60px}
}
`;

const js = `
document.body.classList.add('js');
const pages = [...document.querySelectorAll('.page')];
const navs = [...document.querySelectorAll('.nav-i')];
let cur = 0;

function show(index, push) {
  cur = Math.max(0, Math.min(pages.length - 1, index));
  pages.forEach((p, i) => p.classList.toggle('on', i === cur));
  navs.forEach((n, i) => n.classList.toggle('on', i === cur));
  const active = navs[cur];
  if (active) active.scrollIntoView({ block: 'nearest' });
  document.getElementById('pos').textContent =
    String(cur + 1).padStart(2, '0') + ' / ' + pages.length;
  document.getElementById('prev').disabled = cur === 0;
  document.getElementById('next').disabled = cur === pages.length - 1;
  document.querySelector('.progress i').style.width =
    ((cur + 1) / pages.length) * 100 + '%';
  if (push) history.replaceState(null, '', '#' + pages[cur].dataset.id);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

navs.forEach((n, i) => n.addEventListener('click', () => show(i, true)));
document.getElementById('prev').addEventListener('click', () => show(cur - 1, true));
document.getElementById('next').addEventListener('click', () => show(cur + 1, true));
document.querySelectorAll('[data-go]').forEach((el) => {
  const target = el.dataset.go;
  if (target === 'prev' || target === 'next') return;
  const index = pages.findIndex((p) => p.dataset.id === target);
  if (index >= 0) el.addEventListener('click', () => show(index, true));
});
document.querySelectorAll('.pg-foot [data-go]').forEach((el) => {
  el.addEventListener('click', () => show(el.dataset.go === 'next' ? cur + 1 : cur - 1, true));
});
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft') show(cur - 1, true);
  if (e.key === 'ArrowRight') show(cur + 1, true);
});

const start = pages.findIndex((p) => p.dataset.id === location.hash.slice(1));
show(start >= 0 ? start : 0, false);
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Prism 代码导览 · 每个文件一页</title>
<style>${css}</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand"><i></i>Prism 代码导览</div>
    <div class="side-meta">${PAGES.length} 个模块 · 一模块一页</div>
    <nav>${renderNav(PAGES)}</nav>
  </aside>
  <main class="main">
    <div class="bar">
      <button id="prev">← 上一页</button>
      <span id="pos"></span>
      <div class="progress"><i></i></div>
      <button id="next">下一页 →</button>
    </div>
    ${INTRO}
    ${PAGES.map(renderPage).join('\n')}
  </main>
</div>
<script>${js}</script>
</body>
</html>`;

const outPath = resolve(root, 'docs/代码导览.html');
writeFileSync(outPath, html, 'utf-8');

const groups = [...new Set(PAGES.map((p) => p.group))];
console.log('代码导览已生成');
console.log(`  产出    ${relative(root, outPath)}`);
console.log(`  体积    ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
console.log(`  页数    ${PAGES.length + 1}（含 1 页说明）`);
console.log(`  分组    ${groups.join(' / ')}`);
