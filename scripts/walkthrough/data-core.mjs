/**
 * 代码导览数据 · 采集内核（packages/core/src）
 *
 * 每条记录的字段含义：
 *   id / group / title / nav —— 导航与标题
 *   file / loc               —— 源文件路径与行数
 *   pitch                    —— 一句话说明这个文件干什么
 *   problem                  —— 它解决什么问题（支持字符串 / 数组 / {list} / {table} / {flow}）
 *   blocks                   —— 「怎么写的」，每块可以带 h 小标题、code 行号区间、note 说明
 *   gotchas                  —— 「注意的地方」，每条一个坑
 *   interview                —— 面试怎么答
 *
 * code 里的行号是【闭区间、从 1 开始】，和编辑器左侧显示的行号一致。
 * 代码内容由生成器从真实源文件里抽取，所以永远不会和源码脱节。
 */
export default [
  {
    id: 'types',
    group: '采集内核',
    title: 'types.ts',
    nav: 'types.ts 类型真相源',
    file: 'packages/shared/src/types.ts',
    loc: 242,
    pitch: '全项目唯一的事件模型定义。core 采集、dashboard 展示、cli 还原，三方都从这里 import。',
    problem: [
      `这个项目由三个部分消费同一份数据：内核负责采集、看板负责画图、命令行负责还原堆栈。
       如果各自定义一遍事件结构，字段名一定会漂移 —— 采集端写 <code>transferSize</code>，
       看板端读 <code>transfer_size</code>，这种错编译期查不出来，只会在页面上变成一块空白。`,
      `所以这里定了一条硬规矩：<b>任何模块都不许自己重新定义事件结构。</b>
       这个文件只放类型和纯函数，不放任何副作用，因此可以被任何环境安全引入。`,
    ],
    blocks: [
      {
        h: '四种错误来源，是写死的联合类型',
        code: [[31, 32]],
        note: `这个联合类型是整个项目错误处理能力的<b>边界</b>。
              浏览器能提供的原生错误信号只有这四种，再往外的东西 SDK 不可能凭空知道。
              想加第五种，先得回答「浏览器在什么时机给你这个信号」。`,
      },
      {
        h: '官方阈值，以及共用同一套评级逻辑',
        code: [[34, 53]],
        table: [
          ['要点', '说明'],
          [`元组含义`, `<code>[good 上限, poor 上限]</code>，边界是包含关系`],
          [`为什么放 shared`, `内核算评级、看板也画达标线。放两处就会不一致 —— 内核说 good、看板画成黄灯`],
          [`数值不能改`, `来自 Google web.dev 的官方定义，凭感觉调会让整张图失去意义`],
        ],
      },
      {
        h: '每条事件自带完整上下文',
        code: [[66, 90]],
        note: `注意 <code>PrismEventBase</code> 里带了 <code>sessionId</code>、<code>release</code>、
              <code>environment</code>、<code>url</code>、<code>userAgent</code>。
              这不是冗余 —— <b>零后端架构下没有服务端帮你关联上下文</b>，
              落盘之后这些字段就再也拼不回来了，所以必须在采集那一刻就写进每一条事件里。`,
      },
    ],
    gotchas: [
      {
        t: 'HTTP 500 不是错误事件',
        d: `它是一次<b>正常完成</b>的请求，会被记成 <code>status: 500, ok: false</code> 的网络事件，
            在「网络」页按状态码筛，而不是在「错误」页找。这个分工是对的，别在面试里说成「漏掉了接口错误」。`,
      },
      {
        t: '网络事件绝不存请求体和响应体',
        d: `这是「隐私优先」这条承诺最硬的一块。类型里根本没有 body 字段 ——
            不是忘了加，是<b>故意不给</b>。`,
      },
      {
        t: '面包屑只在错误事件上携带',
        d: `如果每条网络事件都挂 20 条面包屑，数据量会翻 20 倍。
            只在 <code>ErrorEvent</code> 上放 <code>breadcrumbs</code> 字段。`,
      },
    ],
    interview: `「事件模型我抽了一个 shared 包做唯一真相来源，三方共用。
                四种错误类型是刻意收敛的 —— 浏览器给不出的信号我不假装能采到。
                HTTP 500 归网络事件，不是错误事件。」`,
  },

  {
    id: 'session',
    group: '采集内核',
    title: 'session.ts',
    nav: 'session.ts 会话',
    file: 'packages/core/src/session.ts',
    loc: 51,
    pitch: '零后端架构下，会话只能由 SDK 自己维护。它产出的 sessionId 是整个系统关联数据的唯一线索。',
    problem: [
      `有服务端的监控系统靠 Cookie + 服务端会话表来关联网关。这个项目<b>完全没有服务端</b>，
       所以「哪些事件属于同一个用户的一次访问」这件事，必须由 SDK 自己在浏览器里定下来。`,
      `判定标准想清楚了：<b>一个标签页从打开到关闭，算一次会话。</b>
       这个定义直接决定了存储位置该选哪个。`,
    ],
    blocks: [
      {
        h: '会话 ID 怎么生成',
        code: [[22, 25]],
        note: `<code>Date.now().toString(36)</code> 提供了大致有序的时间前缀（好处是 ID 本身携带时间信息），
              后面拼 8 位随机串是为了解决<b>同一毫秒内开多个标签页</b>会撞 ID 的问题。
              最终长度约 20 字符 —— 这个长度对采样哈希的分布质量很关键，见下一页。`,
      },
      {
        h: '读取逻辑，以及那一整层 try/catch',
        code: [[27, 50]],
        note: `<code>sessionStorage</code> 在下面三种环境里访问会直接抛异常：
              <b>无痕模式、用户禁用 Cookie、iframe 沙箱</b>。
              而 SDK 的底线是不能因为自己出错把宿主页面搞挂，
              所以连读存储这件事都裹在 try/catch 里，失败就降级。`,
      },
    ],
    gotchas: [
      {
        t: '为什么必须是 sessionStorage 而不是 localStorage',
        d: `这是本文件最关键的一个选择。<code>sessionStorage</code> 的生命周期就是「标签页开着」，
            关掉即清空 —— 正好等于「一次会话」的定义。而 <code>localStorage</code> 会永久保留，
            用户三天后回来访问，SDK 会把他算成<b>同一个会话</b>，
            于是看板上「会话时长」变成三天、行为轨迹首尾不接。`,
      },
      {
        t: '降级策略是有意设计的',
        d: `拿不到存储时不抛错、不静默失败，而是退化成「每次刷新都是新会话」。
            功能打折但页面照常工作 —— 这是 SDK 应有的姿态。`,
      },
      {
        t: '每次读取都会回写 lastActiveAt',
        d: `所以这个字段表示的是「最后一次活跃时刻」而不是「最后一次写入时刻」，
            会话时长要用 <code>lastActiveAt - startedAt</code> 算。`,
      },
    ],
    interview: `「会话我用 sessionStorage 存，因为它的生命周期恰好等于一次会话。
                用 localStorage 会让三天后的访问还算作同一会话，看板数据就串了。
                无痕模式下访问存储会抛异常，所以整段逻辑裹在 try/catch 里降级。」`,
  },

  {
    id: 'sampling',
    group: '采集内核',
    title: 'sampling.ts',
    nav: 'sampling.ts 稳定采样',
    file: 'packages/core/src/sampling.ts',
    loc: 43,
    pitch: '决定「这个会话的数据要不要采集」。43 行，零依赖，是整个项目最短也最值得讲的文件。',
    problem: [
      `监控 SDK 在高流量站点上必须降采样，否则数据量会失控。
       但<b>按什么粒度抽签</b>这件事，抽错了比不抽更糟。`,
      {
        table: [
          ['做法', '结果', '可不可用'],
          ['每条事件独立 <code>Math.random()</code>', '同一会话里采到第 1、2、4、5 条，第 3 条丢了', '❌ 轨迹断裂'],
          ['按会话稳定决策', '整个会话要么全采、要么全丢', '✅ 轨迹完整'],
        ],
      },
      `假设采样率 50%，用户在同一个会话里连续做了几个动作。
       按事件抽签的话，你在看板上看到的是这样的时间轴：
       <code>点击结算 → 请求 /api/cart → 【空】 → 请求 /api/price → 报错</code>。
       中间那一步「用户改了数量」不见了 —— 而它很可能恰恰是报错的原因。
       <b>排障最需要的连续轨迹，被采样剪碎了。</b>`,
    ],
    blocks: [
      {
        h: '哈希函数：把任意字符串压成 32 位数',
        code: [[13, 31]],
        list: [
          `<code>5381</code> 是 djb2 这个经典算法的推荐种子值，位模式分散`,
          `<code>(hash &lt;&lt; 5) + hash</code> 等于 <code>hash * 33</code>。为什么这么写？因为 33 = 32 + 1，只用移位和加法。现代 JS 引擎里和直接乘 33 性能一样，这里更多是沿用经典写法的习惯 —— <b>面试被追问时实话实说，比硬扯性能加分</b>`,
          `<code>input.charCodeAt(i)</code> 让字符参与运算，否则 <code>'abc'</code> 和 <code>'cba'</code> 会得到同一个结果`,
          `<code>| 0</code> 是<b>防精度丢失</b>：每轮乘 33，算 20 个字符就是 <code>5381 × 33²⁰</code>，远超 JS 能精确表示整数的上限 2⁵³，小数部分就不可信了。JS 位运算强制转 32 位有符号整数，顺便把结果截断回安全范围`,
          `<code>&gt;&gt;&gt; 0</code> 把可能出现的负数翻译成对应的无符号值，保证后面除以 <code>0xffffffff</code> 得到 0~1`,
        ],
      },
      {
        h: '决策函数：只有 4 行，但每一行都有理由',
        code: [[37, 42]],
        list: [
          `<b>为什么先处理 0 和 1</b>：不只是省一次哈希。采样率 1 的含义是「100% 都要」，就该无条件 <code>true</code>，不该指望「哈希比值恰好小于 1」。提前返回把这类边界歧义彻底消灭`,
          `<b>除数是 <code>0xffffffff</code>（4294967295）而不是 <code>0x100000000</code></b>：因为 <code>hash &gt;&gt;&gt; 0</code> 的最大值就是它。除以它，比值能完整覆盖 <code>[0, 1]</code> 闭区间；除以 2³² 的话最大值只能到 0.99999999977，理论上有极微小偏差`,
          `<b>整个模块是纯函数</b>：没有 Map 记录「哪些会话决定采过」。因为结果由输入唯一决定，不需要记 —— 零内存、不泄漏，新页面加载时重算必然得到同一答案`,
        ],
      },
    ],
    gotchas: [
      {
        t: '⚠️ djb2 对短输入几乎没有扩散能力（实测发现）',
        d: `实测数据：<code>'s1'</code>、<code>'s2'</code>、<code>'s9'</code>、<code>'sa'</code>、<code>'sz'</code>
            的哈希比值<b>全都是 0.00137</b>，全部落进同一个桶。
            原因是同长度输入的哈希结果是线性组合，取值范围被锁死在 <code>5381×33² ≈ 5.86M</code> 附近。
            <b>后果</b>：如果 <code>sessionId</code> 只有两三个字符，采样会退化成「全采」或「全丢」，功能失灵。
            本项目安全 —— 生成的 ID 约 20 字符，实测 8 个样本比值从 0.0817 到 0.9898 覆盖良好
            （5000 次、采样率 0.1 实测命中率 9.72%，期望 10%）。`,
      },
      {
        t: '这个前提已经被测试钉住了',
        d: `测试里同时断言两件事：同长短 ID 的比值极差 <b>&lt; 0.001</b>（钉住已知局限），
            真实长度 ID 的比值极差 <b>&gt; 0.5</b>（钉住采样可用性）。
            以后谁想换哈希算法，必须先回答「短 ID 退化」有没有被解决。`,
      },
      {
        t: '采样决策整个会话只算一次',
        d: `在 <code>client.ts</code> 构造函数里算出 <code>this.sampled</code> 并缓存，
            之后每个采集入口都只是判 <code>if (!this.sampled) return</code>。
            不理解这点会误以为它被调用了很多次。`,
      },
    ],
    interview: `「采样必须按会话做，不能按事件做 —— 按事件抽签会把用户的因果链剪碎，
                你看到一个错误却看不到导致它的那次操作。
                实现上是对 sessionId 做 djb2 哈希映射到 0~1，纯函数、不存状态。
                不过 djb2 对短输入扩散很弱，实测两字符 ID 全落在同一个桶，
                所以我保证了生成的 sessionId 有 20 个字符和足够熵，并用测试把这个前提钉住了。」`,
  },

  {
    id: 'ring-buffer',
    group: '采集内核',
    title: 'ring-buffer.ts',
    nav: 'ring-buffer.ts 环形缓冲',
    file: 'packages/core/src/ring-buffer.ts',
    loc: 53,
    pitch: '面包屑的存储结构。定长数组 + 一个写指针，写入永远 O(1) 且零内存分配。',
    problem: [
      `面包屑是<b>高频写入</b>的 —— 用户每点一次、每发一个请求就写一条，
       交互密集的页面上一秒可能写十几条。同时它必须有容量上限，
       否则一个长期挂着的标签页会把内存吃光。`,
      `最直观的写法是数组加 <code>shift()</code>。问题在于
       <code>shift()</code> 会把后面所有元素往前挪一格，是 O(n)；
       而 <code>slice(-20)</code> 这类写法每次都会创建一个新数组。
       在高频路径上，这等于<b>每秒制造十几个临时数组让垃圾回收器去扫</b> ——
       监控 SDK 自己成了拖慢页面的元凶，这就本末倒置了。`,
    ],
    blocks: [
      {
        h: '三个字段，各管一件事',
        code: [[13, 29]],
        list: [
          `<code>items</code>：定长数组，长度就是容量。类型是 <code>Array&lt;T | undefined&gt;</code> —— 刚创建时里面全是空洞，类型上必须诚实标出来`,
          `<code>writeIndex</code>：下一个该写哪一格，写满后绕回 0`,
          `<code>filled</code>：已经装了多少条，上限是容量。<b>它为什么必须存在</b>见下面的坑`,
          `<code>push</code> 里没有任何「先判断格子有没有人」的逻辑 —— <b>覆盖就是设计本身，不是意外</b>`,
        ],
      },
      {
        h: '读取：最容易讲错的一行',
        code: [[31, 52]],
        note: `<code>const start = this.filled &lt; this.capacity ? 0 : this.writeIndex;</code>
              这一行是整个文件的核心，翻译成人话：
              <b>没写满</b>时数据从下标 0 连续存放，所以 <code>start = 0</code>；
              <b>写满了</b>时最老的那条<b>正好躺在 writeIndex 位置</b>（因为下一步它就要被覆盖），
              所以 <code>start = writeIndex</code>。`,
        flow: ['从 start 出发', '绕圈读 filled 个', '取模自动回绕', '得到时间正序'],
      },
      {
        h: '实测走位（容量 3，依次 push a b c d e）',
        table: [
          ['操作', '<code>items</code> 实际内容', 'writeIndex', 'filled', '<code>toArray()</code>'],
          ['初始', '<code>[_,_,_]</code>', '0', '0', '<code>[]</code>'],
          ['push a', '<code>[a,_,_]</code>', '1', '1', '<code>["a"]</code>'],
          ['push b', '<code>[a,b,_]</code>', '2', '2', '<code>["a","b"]</code>'],
          ['push c', '<code>[a,b,c]</code>', '0', '3', '<code>["a","b","c"]</code>'],
          ['<b>push d</b>', '<b><code>[d,b,c]</code></b>', '<b>1</b>', '3', '<b><code>["b","c","d"]</code></b>'],
          ['push e', '<code>[d,e,c]</code>', '2', '3', '<code>["c","d","e"]</code>'],
        ],
        note: `<code>push d</code> 那一步是关键：<code>a</code> 被 <code>d</code> 直接覆盖，
              <code>items</code> 变成乱序的 <code>[d,b,c]</code>，而读取从下标 1 开始绕 1→2→0，
              得到正序的 <code>b, c, d</code>。
              <b>内部存储顺序是乱的，读出来永远是时间正序</b> —— 看板的时间轴完全依赖这个保证。`,
      },
    ],
    gotchas: [
      {
        t: '<code>filled</code> 不能用 <code>items.length</code> 代替',
        d: `<code>items</code> 是预分配的定长数组，<code>length</code> 从头到尾都是容量。
            另一个更重要的原因：<b>写指针会绕圈</b>，当它回到 0 时你没法判断这是「刚开始写」
            还是「已经绕了一整圈」—— 这两种状态要做的事完全不同。
            所以环形缓冲天然需要区分<b>填充期</b>（filled &lt; capacity）和<b>稳态期</b>（filled === capacity）。`,
      },
      {
        t: 'O(n) 被刻意放在了读取侧',
        d: `<code>push</code> 是 O(1) 零分配，<code>toArray</code> 是 O(n) 且每次新建数组。
            看起来不对称，其实是刻意的：<b>写入高频、读取低频</b>。
            <code>toArray</code> 只在 <code>captureException</code> 冻结快照时调用一次。
            如果反过来（写的时候 slice），就等于把开销压在了最热的路径上。`,
      },
      {
        t: '容量 20 这个数字的由来',
        d: `意思是「最多回溯用户报错前的 20 个操作」。
            再多会明显加大错误事件的体积 —— 面包屑会随错误一起落盘，
            而且导出报告时也一起被压缩进去。`,
      },
    ],
    interview: `「面包屑我用环形缓冲存，不是数组。数组方案下 shift 是 O(n) 还要搬移元素，
                slice 每次都造临时数组，在高频写入路径上会给 GC 很大压力。
                环形缓冲是定长数组加写指针，写入 O(1) 零分配。
                要注意 filled 这个字段不能省 —— 写指针绕回 0 时，靠它才能区分刚开始写还是已经绕了一圈。」`,
  },

  {
    id: 'sanitize',
    group: '采集内核',
    title: 'sanitize.ts',
    nav: 'sanitize.ts 脱敏',
    file: 'packages/core/src/sanitize.ts',
    loc: 44,
    pitch: '「隐私优先」这条承诺的兜底实现。45 行，做两件事：剔除 URL 里的敏感参数、删除对象里的敏感字段。',
    problem: [
      `监控数据里最容易泄露隐私的两处是 <b>URL 的 query</b>（<code>?token=xxx</code>）
       和<b>结构化数据里的字段</b>（<code>{ password: '...' }</code>）。
       这类信息一旦被采集，就会随错误事件落盘、随导出报告发给别人。`,
      `关键认知：<b>脱敏必须在 SDK 里做，不能等上报时再做。</b>
       这个项目数据存在本地，看起来不涉及出境 —— 但用户会把导出的 HTML 报告发给同事，
       文件一旦离开浏览器，泄露就已经发生了。所以<b>入库前就必须已经脱敏</b>。`,
    ],
    blocks: [
      {
        h: '敏感词表：用包含匹配，不用全等',
        code: [[12, 32]],
        note: `实际项目里的字段名千奇百怪：<code>userToken</code>、<code>access_token</code>、
              <code>pay_password</code>、<code>idCard</code>…… 全等匹配只能拦住最标准的写法。
              <b>包含匹配才能覆盖这一类命名变体。</b>`,
      },
      {
        h: '结构化数据：命中就整个删掉字段',
        code: [[34, 44]],
        note: `注意这里是<b>删除</b>而不是置空。置成 <code>'***'</code> 会留下一条「这里有个敏感字段」的痕迹，
              而删除之后这条数据看起来就从来没存在过。`,
      },
    ],
    gotchas: [
      {
        t: '「打码」比「直接丢弃」更危险',
        d: `这是本文件最重要的取舍。把手机号打成 <code>138****0000</code> 看起来安全，
            但<b>打码后的值仍然可能被反推</b> —— 知道运营商号段和用户归属地就能缩小到很小的范围。
            所以这里的选择是<b>整个丢掉，不留残片</b>。`,
      },
      {
        t: '<code>sanitizeData</code> 只处理第一层',
        d: `它是浅拷贝，嵌套对象里的敏感字段不会被清掉。
            真要覆盖多层需要递归，而递归会带来性能和栈深度问题，
            这里选择了「覆盖最常见的场景」而不是「理论上完备」。`,
      },
      {
        t: 'URL 的 path 要保留',
        d: `<code>sanitizeUrl</code> 只切掉 query 部分，path 原样保留 ——
            因为 <code>/api/orders</code> 这类路径恰恰是排障时最需要的信息。`,
      },
    ],
    interview: `「脱敏我在入库前做，不等上报 —— 因为导出的报告会被发给别人，数据离开浏览器就算泄露了。
                策略上我选择直接丢弃而不是打码，因为打码后的值仍然可能被反推。
                匹配用的是包含匹配而不是全等，实际字段名千奇百怪，全等拦不住。」`,
  },

  {
    id: 'schedule',
    group: '采集内核',
    title: 'schedule.ts',
    nav: 'schedule.ts 调度',
    file: 'packages/core/src/schedule.ts',
    loc: 42,
    pitch: '决定「什么时候把数据交出去」。两个时机：浏览器空闲时、页面即将隐藏时。',
    problem: [
      `这个文件解决的问题很具体：<b>监控 SDK 不能和首屏渲染抢主线程。</b>
       如果在页面加载过程中就急着上报、跑采集逻辑，SDK 本身就成了拖慢页面的原因 ——
       那才是最大的讽刺。`,
      `另一个时机是页面生命周期：用户关标签页、切后台的那一刻，是<b>最后一次上报机会</b>，
       错过就永久丢失。这两个需求指向同一个文件。`,
    ],
    blocks: [
      {
        h: '空闲执行，并且必须准备兜底',
        code: [[16, 25]],
        note: `<code>requestIdleCallback</code> 让浏览器在真正闲下来时才跑回调，
              <code>timeout: 2000</code> 保证再忙也会在两秒内执行。
              但关键在于那个 <code>else</code> 分支 —— 见下面的坑。`,
      },
      {
        h: '页面隐藏：两个事件都监听',
        code: [[27, 42]],
        note: `<code>visibilitychange</code> 管「切标签页 / 切后台」，
              <code>pagehide</code> 管「关闭 / 导航走」。
              <b>为什么要两个都监听</b>：桌面端切标签页只触发前者，
              移动端 Safari 上后者更可靠。少监听一个，就有一类设备上报不到。`,
      },
    ],
    gotchas: [
      {
        t: 'Safari 至今不支持 <code>requestIdleCallback</code>',
        d: `不写 <code>setTimeout</code> 兜底的话，<b>在 Safari 上数据永远发不出来</b>。
            而这种 bug 极难发现 —— 开发时用 Chrome 一切正常，
            上线后 iOS 用户的看板是空的。`,
      },
      {
        t: '必须判空 <code>document</code> 和 <code>window</code>',
        d: `SSR 环境、Node 单元测试、Web Worker 里都没有这两个对象。
            不判的话 SDK 一加载就崩 —— 这是「SDK 不能拖垮宿主」这条底线的具体体现。`,
      },
      {
        t: '时机选错会导致数据丢失（真实踩过）',
        d: `这个文件提供的能力，被 <code>webVitals.ts</code> 用错了地方：
            原来只在「空闲时」上报性能指标，结果用户在页面加载后很快点击跳转时，
            空闲回调还没触发页面就没了，LCP/CLS/INP 全部丢失。
            修复方式是补上 <code>onPageHide</code> 兜底。详见性能插件那一页。`,
      },
    ],
    interview: `「调度分两个时机：空闲时上报，避免和首屏渲染抢主线程；
                页面隐藏时上报，那是最后一次机会。
                requestIdleCallback 在 Safari 上不支持，所以必须有 setTimeout 兜底，
                否则 iOS 用户的数据永远发不出来。」`,
  },

  {
    id: 'idb',
    group: '采集内核',
    title: 'storage/idb.ts',
    nav: 'idb.ts IndexedDB 存储',
    file: 'packages/core/src/storage/idb.ts',
    loc: 158,
    pitch: '零后端架构的落地层。数据全部留在浏览器里，不经过任何服务器。',
    problem: [
      `「零后端」听起来像是一句营销词，落到实处就是：<b>数据存在浏览器本地</b>。
       可选方案有两个，选错一个整个架构就不成立。`,
      {
        table: [
          ['方案', '容量上限', '能力', '结论'],
          [
            '<code>localStorage</code>',
            '<b>5MB 硬上限</b>',
            '只能存字符串，同步 API 会阻塞主线程',
            '❌ 量大直接写爆，而且没法做索引和淘汰',
          ],
          [
            '<code>IndexedDB</code>',
            '按磁盘剩余空间算，通常几百 MB 起',
            '结构化存储、支持索引、异步不阻塞',
            '✅ 才能实现「按时间排序」和「淘汰最老数据」',
          ],
        ],
      },
    ],
    blocks: [
      {
        h: '打开数据库，以及包一层 Promise 的原因',
        code: [[33, 49]],
        note: `IndexedDB 是<b>事件回调式</b>的 API（<code>onsuccess</code> / <code>onerror</code>），
              不包成 Promise 的话，调用方要写一堆嵌套回调，根本没法维护。
              <code>onupgradeneeded</code> 只在首次调用或<b>版本号变化</b>时触发，也就是说
              第一次建表、以及未来升级表结构，都走这个分支。`,
      },
      {
        h: '批量写入：一个事务搞定',
        code: [[51, 73]],
        note: `注意 <code>for</code> 循环里全部用同一个 <code>tx</code>，
              <b>比逐条开事务快一个数量级</b>。IndexedDB 的事务开销主要在提交时，
              逐条写等于把提交成本乘以条数。`,
      },
      {
        h: '容量淘汰：顺着时间索引删最老的',
        code: [[75, 107]],
        note: `<code>MAX_EVENTS = 5000</code> 是容量上限。超出时用 <code>openCursor()</code>
              顺着时间索引从头走，走到的就是最老的那一批，删够数就停。
              <b>建索引的意义就在这里</b> —— 不用全表扫描再排序。`,
      },
    ],
    gotchas: [
      {
        t: '用完必须立刻 <code>db.close()</code>',
        d: `长时间持有数据库连接会<b>阻塞其他标签页的升级操作</b>。
            多个标签页同时开着时，一个页面占着旧版本连接不放，
            另一个页面想升级就会一直卡在 <code>onblocked</code>。`,
      },
      {
        t: '5000 条这个上限怎么来的',
        d: `一个真实站点一天的异常事件通常在几十到几百条量级，5000 条足够回溯一周以上。
            再往上加只会拖慢看板的首次渲染，收益递减。
            （对应地，看板列表用了虚拟滚动来兜住渲染性能。）`,
      },
      {
        t: '写库失败要静默降级，不能抛',
        d: `隐私模式、磁盘配额用尽、无痕模式都可能让写入失败。
            <code>createIdbTransport</code> 里把异常吃掉了 ——
            <b>绝不因为存储问题影响页面本身</b>。`,
      },
    ],
    interview: `「存储我选了 IndexedDB 而不是 localStorage。localStorage 有 5MB 硬上限、
                只能存字符串、还是同步 API 会阻塞主线程；
                IndexedDB 容量按磁盘剩余空间算，支持结构化存储和索引，
                才能实现按时间排序和淘汰最老数据。
                写入时用一个事务批量提交，比逐条开关事务快一个数量级。」`,
  },

  {
    id: 'client',
    group: '采集内核',
    title: 'client.ts',
    nav: 'client.ts 内核骨架',
    file: 'packages/core/src/client.ts',
    loc: 321,
    pitch: '整个 SDK 的中枢：所有事件都要经过它，采样、脱敏、入队、上报四道工序都在这里。',
    problem: [
      `四个采集插件各自负责「发现事件」，但「事件怎么处理」必须收口到一处，
       否则每个插件都要自己补上下文、自己判采样、自己脱敏 —— 三份重复逻辑，三份不一致的风险。`,
      `所以插件拿到的 <code>PrismClient</code> 接口是<b>能力受限的</b>：
       <code>captureMetric</code>、<code>captureNetwork</code>、<code>captureException</code>
       三个方法都只传业务字段，公共上下文由内核统一补。
       插件<b>没有</b>「构造任意事件」的能力。`,
    ],
    blocks: [
      {
        h: '公共上下文在这里统一补齐',
        code: [[96, 106]],
        note: `每个事件都自动带上 <code>sessionId</code>、<code>release</code>、<code>environment</code>、
              <code>url</code>、<code>userAgent</code>。
              这是零后端架构必须付出的代价 —— 没有服务端帮忙补，只能在每次构造事件时写进去。`,
      },
      {
        h: '事件管线：四道工序',
        code: [[120, 147]],
        flow: ['采样闸门', '脱敏兜底', 'beforeSend 钩子', '入队'],
        list: [
          `<b>采样闸门</b>：<code>if (!this.sampled) return;</code> 在最前面，被丢的事件不产生任何后续开销`,
          `<b>脱敏兜底</b>：即使调用方忘了脱敏，<code>applyPrivacy</code> 也会再删一遍`,
          `<b>beforeSend</b>：给业务方最后一道控制权，<b>返回 null 表示丢弃</b>该事件`,
          `<b>入队</b>：队列满 50 条立即 flush，否则排一个空闲任务 —— 防止用户长时间不切后台时内存无限堆积`,
        ],
      },
      {
        h: 'flush 与 flushAsync：为什么要两个版本',
        code: [[244, 273]],
        note: `<code>drain()</code> 被两个方法共用，避免两处行为不一致。
              <b>为什么需要异步版本</b>：transport（写 IndexedDB）是异步的，而 <code>flush</code>
              是同步返回的。演示站「点完按钮立刻跳走看板」这种场景下，
              不等写入完成就离开页面，看板会读到旧数据，用户会以为 SDK 坏了。
              跳转前 <code>await flushAsync()</code> 即可。`,
      },
    ],
    gotchas: [
      {
        t: '最外层那个 <code>try/catch</code> 是硬性要求',
        d: `<code>captureEvent</code> 里所有逻辑都裹在 try/catch 中。
            一个监控 SDK 最严重的错误是什么？<b>它自己崩溃了，然后把业务页面搞挂了。</b>
            同理 <code>setupIntegrations</code> 里每个插件单独 try/catch，
            一个插件挂掉不影响其他插件。`,
      },
      {
        t: '面包屑必须在报错那一刻冻结',
        d: `注意 <code>captureException</code> 里调用的是 <code>this.getBreadcrumbs()</code>
            并把结果存进事件的 <code>breadcrumbs</code> 字段。
            不这么做的话，等看板去读取时，环形缓冲区早就被后续操作覆盖掉了 ——
            <b>你看到的会是「报错之后的 20 个操作」，而不是报错之前的。</b>`,
      },
      {
        t: '<code>createId()</code> 用的是弱随机',
        d: `<code>Date.now() + Math.random()</code>，不是 UUID。
            够用，因为它的唯一职责是当 IndexedDB 主键、避免同一条错误被写两遍，
            不需要抗碰撞强度。用 UUID 会白增体积。`,
      },
    ],
    interview: `「内核是插件和存储之间的中枢，所有事件都走同一条管线：采样、脱敏、beforeSend、入队。
                插件的能力是受限的 —— 只能上报业务字段，公共上下文由内核补，
                拿不到构造任意事件的能力，这样事件结构不会失控。
                另外 flush 有同步和异步两个版本，因为写 IndexedDB 是异步的，
                跳转页面前必须用异步版本等写入真正完成。」`,
  },
];
