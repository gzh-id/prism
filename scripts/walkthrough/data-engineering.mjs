/**
 * 代码导览数据 · 工程化（导出 / 构建 / 命令行 / 测试）
 *
 * 这几页讲的不是业务逻辑，而是「让上面那些东西真的能用」的部分。
 * 其中内联 JS 的两个坑，是这个项目踩得最深、也最值得讲的两处。
 */
export default [
  {
    id: 'report',
    group: '工程化',
    title: 'report.ts',
    nav: 'report.ts 报告导出',
    file: 'packages/core/src/report.ts',
    loc: 133,
    pitch: '「单文件离线 HTML」的数据准备部分：压缩、编码、组装。',
    problem: [
      `导出的报告要把全部监控数据塞进一个 HTML 文件里。
       一份真实站点的数据轻松上 MB，<b>不压缩的话文件大到根本发不出去</b>
       （微信传不了、邮件附件超限）。`,
      `实测这个项目的数据：<b>14.8 KB → 1.6 KB，省了 89.4%</b>。
       这是「这个功能能不能用」的分水岭。`,
    ],
    blocks: [
      {
        h: '压缩：用浏览器原生 API，不引入第三方库',
        code: [[16, 31]],
        note: `<code>CompressionStream('gzip')</code> 是浏览器和 Node 都自带的原生 API。
              <b>选它而不是引入 pako / lz-string，是为了守住「零第三方依赖」这条承诺</b>
              —— 那正是 8KB 体积预算能守住的根本原因。
              <br /><br />
              第 22 行那个分支是兜底：不支持时<b>原样返回字节</b>，
              <b>宁可文件大一点也不能导出失败</b>。`,
      },
      {
        h: '解压：一个 TypeScript 类型上的坑',
        code: [[33, 44]],
        note: `注释里记录了一个真实的类型问题：<b>从 TypeScript 5.9 起，
              <code>Uint8Array</code> 底层的 buffer 可能是 <code>SharedArrayBuffer</code></b>，
              直接塞进 <code>Blob</code> 会类型不兼容。
              <br /><br />
              这里复制一份拿到确定的 <code>ArrayBuffer</code>，
              顺带还避免了调用方复用同一块内存导致的隐式改动。`,
      },
      {
        h: 'Base64 编码：必须分块',
        code: [[46, 67]],
        note: `二进制字节流不能直接塞进 HTML 文本里，必须转成 Base64 字符串。
              <br /><br />
              <b><code>CHUNK = 0x8000</code> 这个分块不能省。</b>
              原因在注释里：<code>String.fromCharCode</code> 用展开运算符一次吃不下太大的数组
              —— <b>参数太多会爆调用栈</b>。分块是这类转换的标准做法。`,
      },
      {
        h: '组装报告：按 sessionId 聚合会话',
        code: [[69, 100]],
        note: `<code>buildSessions</code> 用一个 <code>Map</code> 遍历事件，
              统计每个会话的事件数、开始时刻、最后活跃时刻。
              <code>Math.max(existing.lastActiveAt, event.timestamp)</code>
              保证时间取最晚的那条 ——
              <b>不能假设事件是按时间顺序传进来的。</b>`,
      },
      {
        h: '对外接口：导出返回压缩率，导入校验版本',
        code: [[102, 132]],
        note: `<code>exportCompressedReport</code> 顺便返回 <code>rawBytes</code> 和
              <code>compressedBytes</code>，让 UI 能展示「省了多少」——
              这是让用户感知到功能价值的细节。
              <br /><br />
              <code>importCompressedReport</code> 校验 <code>version</code>，
              版本不匹配时给出明确提示而不是崩溃。
              <b>报告是会被存下来、隔很久再打开的，版本漂移一定会发生。</b>`,
      },
    ],
    gotchas: [
      {
        t: '压缩率为什么这么高',
        d: `监控数据的高度重复性极强：同样的 <code>userAgent</code>、
            同样的字段名、大量结构相同的对象。gzip 对这种重复特别有效，
            所以实测能到 10%。
            <b>这也是为什么「数据量大」在这个项目里不构成致命问题。</b>`,
      },
      {
        t: '测试里有两条断言在保护这个功能',
        d: `一条验证「压缩 + Base64 往返后数据完全一致」——
            <b>证明压缩是无损的</b>；
            另一条验证压缩率 <b>&lt; 30%</b>，否则报告会大到发不出去。
            这两条是导出功能的底线。`,
      },
      {
        t: '<code>TextEncoder</code> 也在算体积',
        d: `<code>rawBytes</code> 用 <code>new TextEncoder().encode(json).length</code> 算，
            而不是 <code>json.length</code>。<b>因为中文字符在 UTF-8 下占 3 个字节</b>，
            用字符串长度算会严重低估实际体积。`,
      },
    ],
    interview: `「导出报告的核心是把数据压进一个 HTML 文件里。
                压缩用的是浏览器原生的 CompressionStream，不是第三方库 ——
                这是守住零依赖承诺的关键。
                然后再转 Base64 才能塞进 HTML 文本，转的时候要分块，
                因为 String.fromCharCode 一次吃不下太大的数组会爆栈。
                实测这份数据压缩后只剩 10% 左右，这是功能能成立的前提。』`,
  },

  {
    id: 'build',
    group: '工程化',
    title: 'rollup.config.mjs',
    nav: '构建 · 内联 JS 的坑',
    file: 'apps/dashboard/rollup.config.mjs',
    loc: 95,
    pitch: '看板的构建配置。这个文件里藏着两个最深的坑，都是「不写就白屏」级别。',
    problem: [
      `看板要产出<b>两份</b> HTML：`,
      {
        table: [
          ['产物', '特点', '用途'],
          [
            '<code>dist/index.html</code>',
            '外链 <code>bundle.js</code>',
            '开发时打开看板',
          ],
          [
            '<code>dist/report-template.html</code>',
            '<b>JS 和样式全部内联，只差数据</b>',
            '导出报告时的模板',
          ],
        ],
      },
      `Rollup 只管打包 JS，<b>HTML 得自己搬</b>。
       这一步是「单文件离线报告」能不能成立的前提 ——
       模板必须提前把运行时内联好，导出时才能只填数据就完事。`,
    ],
    blocks: [
      {
        h: '用正则匹配，不写死字符串',
        code: [[26, 31]],
        note: `要找到 <code>index.html</code> 里那行外链脚本标签并替换成内联。
              <b>这里用正则而不是写死字符串</b>：
              手写 HTML 时标签里的空格、属性顺序很容易对不上，
              写死字符串会<b>静默替换失败</b> ——
              产物里还留着外链，离线打开就是白屏，而且构建不会报任何错。`,
      },
      {
        h: '坑一：必须转义 <code>&lt;/script&gt;</code>',
        code: [[33, 38]],
        note: `<b>内联脚本内容一旦出现 <code>&lt;/script&gt;</code> 这个字面量，
              HTML 解析器会提前结束 <code>&lt;script&gt;</code> 块，整个报告直接白屏。</b>
              <br /><br />
              <b>这是内联 JS 最经典的坑。</b>
              而 React 压缩后的代码里<b>确实含有这个序列</b>
              （字符串常量里会出现），所以这一行转义不是防御性编程，是必需的。`,
      },
      {
        h: '坑二：<code>String.replace</code> 的替换值必须是函数',
        code: [[40, 58]],
        note: `这段注释值得逐字读。<code>String.replace</code> 的替换字符串里
              <code>$</code> 有特殊含义：<code>$&amp;</code> 是「匹配到的内容」、
              <code>$'</code> 是「匹配之后的内容」。
              <br /><br />
              <b>React 压缩后的代码里恰好含这些序列。</b>
              直接传字符串会让 HTML 片段被注入进 bundle 内部，
              表现为产物里莫名出现 <code>&lt;script src="..."&gt;</code> 字面量，
              其中的 <code>&lt;/script&gt;</code> 会提前结束内联脚本块 —— <b>又是白屏。</b>
              <br /><br />
              <b>用函数形式返回值就绕过了替换模式解析。</b>`,
      },
      {
        h: '其余构建配置',
        code: [[64, 94]],
        list: [
          `<b>用 Rollup 而不是 Vite</b>：同样是 esbuild 原生二进制在本机装不上的原因`,
          `<code>replace</code> 插件把 <code>process.env.NODE_ENV</code> 替换成 production，
           <b>不然 React 会把一堆开发警告打进产物</b>`,
          `<code>commonjs()</code> 插件：React 和 ReactDOM 发布的是 CommonJS，
           Rollup 默认只认 ESM，不转换会报 "useState is not exported by react"`,
          `产出 <b>IIFE 单文件</b>是有意为之 —— 「单文件离线报告」需要把整个看板内联进一个 HTML，产物越集中越好处理`,
        ],
      },
    ],
    gotchas: [
      {
        t: '这两个坑的症状一模一样：白屏',
        d: `两个都是「报告打开一片空白，但控制台可能什么都不报」。
            排查这种问题的思路是：<b>先看产物里有没有 <code>&lt;/script&gt;</code> 字面量</b>，
            有就是转义漏了；<b>再看 bundle 内部有没有被注入 HTML 片段</b>，有就是 replace 用错了。`,
      },
      {
        t: 'sourceMappingURL 要手动去掉',
        d: `<code>bundle.replace(/\\/\\/#\\s*sourceMappingURL=.*$/m, '')</code>。
            内联之后 map 文件不在旁边了，<b>留着这行引用只会让浏览器报 404</b>。`,
      },
      {
        t: '占位符是两处配合修改的',
        d: `构建时写入 <code>window.__PRISM_PAYLOAD__=/*__PRISM_DATA__*/null;</code>，
            而 <code>App.tsx</code> 里的 <code>DATA_PLACEHOLDER</code> 常量
            <b>必须和它逐字符一致</b>（包括那个空注释）。
            改一处忘一处，导出时会命中 <code>App.tsx</code> 里那个
            「找不到占位符，请重新执行 npm run build」的报错 —— 这条报错就是为了这种情况写的。`,
      },
    ],
    interview: `「单文件报告的做法是构建时产出一份已经把看板 JS 全部内联好的模板。
                这里有两个内联 JS 的经典坑：一是代码里出现 </script> 字面量会让
                HTML 解析器提前结束脚本块，必须转义；
                二是 String.replace 的替换字符串里 $& 有特殊含义，
                而 React 压缩后的代码里恰好含这个序列，会把 HTML 片段注入进 bundle，
                所以替换值必须写成函数形式。
                这两个坑的症状都是白屏。』`,
  },

  {
    id: 'cli',
    group: '工程化',
    title: 'cli/index.ts',
    nav: 'CLI · 还原混淆堆栈',
    file: 'packages/cli/src/index.ts',
    loc: 164,
    pitch: '命令行工具，把线上压缩代码的位置还原成源码位置。',
    problem: [
      `线上跑的是压缩后的代码，报错堆栈长这样：
       <code>at t.cart (index.global.js:1:4521)</code>。
       <b>这一行对排障毫无帮助。</b>`,
      `要还原就需要 source map。但 source map 是<b>几百 KB 到几 MB</b> 的资产，
       塞进浏览器会让 SDK 体积直接爆掉，违反 8KB 预算。`,
      `<b>所以它被做成了命令行工具</b>，理由有三条：
       ① source map 是构建期资产，不该出现在运行时；
       ② 还原需要读本地文件系统，浏览器做不到；
       ③ 真实项目里这也是标准做法 —— 构建时上传 map，出问题在本地或服务端还原。`,
    ],
    blocks: [
      {
        h: '取源码内容：一整排候选路径',
        code: [[31, 68]],
        note: `优先用 map 里内嵌的 <code>sourcesContent</code>，
              没有就回退读磁盘。
              <br /><br />
              <b>为什么要这么多候选路径：</b>map 里的 <code>sources</code>
              常带 <code>../../</code> 这类相对前缀，而<b>不同构建工具算这个前缀的基准不一样</b>
              （有的按 output 目录算，有的按项目根算），直接 <code>resolve</code> 经常对不上。
              <br /><br />
              所以除了原样拼，还按文件名去几个常见的源码目录里找一遍。
              <b>这是「拿不到就多试几种可能」的工程化兜底。</b>`,
      },
      {
        h: '打印上下文：在出错那一列下面打箭头',
        code: [[70, 92]],
        note: `打印出错行上下各 3 行，出错行前面用 <code>&gt;</code> 标记，
              并且在出错那一列的<b>正下方打一个 <code>^</code> 箭头</b>，
              精确定位到列而不只是行。
              <br /><br />
              列级定位的用处在压缩代码里特别明显 ——
              压缩后一行有几千个字符，只给行号等于没说。`,
      },
      {
        h: '主流程里两个容易被忽略的顺序问题',
        code: [[128, 157]],
        note: `<b>① <code>SourceMapConsumer</code> 是异步构造的</b>
              （内部要建二分查找索引），所以必须 <code>await</code>。
              <br /><br />
              <b>② 必须在 <code>destroy()</code> 之前把 <code>sourcesContent</code> 取出来。</b>
              注释里写着「这个顺序坑了我一次」——
              <code>destroy</code> 会释放内部引用，之后再访问就是 <code>undefined</code>。`,
      },
    ],
    gotchas: [
      {
        t: '这个包允许有第三方依赖',
        d: `它用了 <code>source-map</code> 这个 npm 包。
            <b>项目里「零依赖」的承诺只针对发布到浏览器的 <code>@prism/core</code></b>，
            命令行工具不受这个约束 ——
            因为它不进浏览器、不影响用户的页面加载速度。`,
      },
      {
        t: '还原不出来时要给出原因，而不只是失败',
        d: `<code>position.source === null</code> 时打印：
            「这一行来自第三方代码，或者构建时没有把这段代码纳入 map」。
            <b>把「失败」变成「可诊断的失败」，是工具类程序的重要素质。</b>`,
      },
      {
        t: '参数校验全部前置',
        d: `命令名不对、参数不全、map 文件不存在、行号列号不是数字 ——
            四种情况都在读文件之前就报错退出。
            <b>不做无用功，报错信息也指向修复动作</b>
            （「先执行 npm run build 生成 sourcemap」）。`,
      },
    ],
    interview: `「堆栈还原我做成了命令行工具而不是放进 SDK，
                因为 source map 有几百 KB 到几 MB，塞进浏览器会让体积直接爆掉，
                而且它本来就是构建期资产。
                实现上优先用 map 内嵌的 sourcesContent，没有就回退读磁盘 ——
                map 里的路径前缀基准在不同构建工具间不一致，
                所以准备了一排候选路径。
                另外 SourceMapConsumer 要在 destroy 之前把源码内容取出来，
                销毁之后再访问就是 undefined。』`,
  },

  {
    id: 'tests',
    group: '工程化',
    title: '测试',
    nav: '测试 · 21 个用例',
    file: 'packages/core/test/core.test.mjs',
    loc: 170,
    pitch: '21 个单元测试，覆盖纯函数逻辑和一处真实的时序缺陷。',
    problem: [
      `测试的<b>范围划分</b>是这个文件最值得讲的地方：`,
      {
        list: [
          `<b>只测纯函数</b>：环形缓冲、采样哈希、脱敏、压缩往返、阈值评级 ——
           这些不依赖浏览器环境，可以在 Node 里确定性地验证`,
          `<b>采集逻辑不在这里测</b>：它依赖 <code>PerformanceObserver</code>、
           <code>window.onerror</code> 这些浏览器 API，属于集成测试范畴`,
          `<b>例外</b>：Web Vitals 的上报时机用「假浏览器」单独测 —— 因为它踩过真实缺陷`,
        ],
      },
      `<b>另一个刻意的选择：测 dist 产物而不是 src 源码。</b>
       因为本项目跑在 Node 内置 test runner 上，直接吃 TS 源码需要额外的转译层；
       而测构建产物<b>反而更贴近真实情况</b> —— 用户拿到的就是这个文件。`,
    ],
    blocks: [
      {
        h: '钉住一个「已知前提」的测试',
        code: [[63, 85]],
        note: `这条测试的形状很特别：它断言的不是「功能正确」，
              而是<b>一个已经被记录的局限</b> ——
              djb2 哈希对同长度的短输入扩散很弱。
              <br /><br />
              <b>为什么要钉住一个「缺点」：</b>
              以后谁想换哈希算法，必须先回答「短 ID 采样退化」有没有被解决，
              而不是默默把算法改掉。同时另一半断言保证真实长度的 ID 扩散良好
              —— <b>采样功能的可用性由它守护。</b>`,
      },
      {
        h: '假浏览器环境：测一个手点测不出来的 bug',
        code: [[100, 126]],
        note: `这段测试的价值在于它<b>钉住了一个时序</b>，而这个时序用手点极难复现
              —— 鼠标快一点慢一点结果就不一样，属于典型的 flaky bug。
              <br /><br />
              <b>测试的写法</b>：<code>window</code> 上<b>故意不提供</b>
              <code>requestIdleCallback</code>，于是它会走 <code>setTimeout</code> 兜底分支，
              保证「空闲上报」不会在断言之前偷偷发生。
              <br /><br />
              然后：灌一条 LCP entry → 断言<b>此刻一条都没上报</b>
              → 触发 <code>pagehide</code> → 断言指标落地<b>并且 flush 被调用</b>。
              <br /><br />
              最后那条断言尤其重要：<b>它验证了「补一次 flush」这个容易被漏掉的动作。</b>`,
      },
      {
        h: '另外 16 个用例覆盖什么',
        table: [
          ['文件', '覆盖内容'],
          [
            '<code>core.test.mjs</code>',
            `环形缓冲的覆盖与顺序、采样决策的稳定性与边界、
             哈希确定性、URL 与对象脱敏、压缩往返无损、压缩率下限、
             会话聚合、阈值分档`,
          ],
          [
            '<code>webvitals.test.mjs</code>',
            `页面隐藏兜底（含 flush）、LCP 取最大且合并、
             CLS 累加且 0 也要上报、不支持的 entryType 不拖垮其他指标、
             FCP/TTFB 只认首次值`,
          ],
        ],
      },
    ],
    gotchas: [
      {
        t: '「测产物而不是源码」是有代价的',
        d: `必须先 <code>npm run build</code> 才能跑测试。
            忘了构建就会测到旧版本 —— 这种「测试通过但测的是旧代码」比测试失败更危险。
            所以 <code>npm test</code> 之前要确保构建是最新的。`,
      },
      {
        t: '还没做 E2E',
        d: `真实的端到端验证（比如「页面触发一个错误，断言 IndexedDB 里确实出现了这条事件」）
            需要 Playwright 之类在真浏览器里跑。
            这是这个项目<b>目前已知的缺口</b>，也是接下来最值得补的一块。`,
      },
      {
        t: '为什么用 Node 内置 test runner',
        d: `不额外引入 Jest / Vitest。
            <code>node --test</code> 是 Node 20+ 自带的，
            <b>零依赖、零配置</b> —— 和整个项目的取舍风格一致。`,
      },
    ],
    interview: `「测试我按依赖环境划了范围：纯函数逻辑用 Node 内置 test runner 测，
                测的是构建产物因为那才是用户拿到的文件；
                采集逻辑依赖浏览器 API，属于集成测试，我另开了一个用假浏览器环境的测试文件。
                其中一条测试很特别 —— 它钉住的是一个已知局限：
                djb2 哈希对短输入扩散弱，所以以后换算法必须先解决这个问题。
                另外 Web Vitals 那条测试钉的是时序缺陷，
                这种 bug 手点测不出来，必须写测试。』`,
  },
];
