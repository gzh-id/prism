/**
 * 代码导览数据 · 采集插件（packages/core/src/integrations）
 *
 * 四个插件各自独立、互不依赖，业务方可以只引入需要的那个，
 * 配合 sideEffects: false 让没用的插件被 tree-shaking 完整摇掉。
 */
export default [
  {
    id: 'errors',
    group: '采集插件',
    title: 'errors.ts',
    nav: 'errors.ts 错误采集',
    file: 'packages/core/src/integrations/errors.ts',
    loc: 122,
    pitch: '覆盖四类错误来源。其中「资源加载失败」和「白屏」是最容易被忽略、但线上最常见的两类。',
    problem: [
      `很多人自己写监控只会想到 <code>window.onerror</code>。
       但线上真正高发的两类故障，<b>根本不产生 JS 异常</b>，用 try/catch 也永远抓不到：`,
      {
        list: [
          `<b>图片、脚本加载失败</b> —— 用户看到的是裂图或者交互失效，控制台一片安静`,
          `<b>白屏</b> —— 页面结构完整、没有报错，但用户就是什么都看不到`,
        ],
      },
      `这两类恰恰是用户投诉最多、而你最没有数据支撑的故障。所以这个插件把它们单独实现了。`,
    ],
    blocks: [
      {
        h: 'JS 错误和资源错误，共用一个监听器',
        code: [[56, 83]],
        note: `<b>最关键的是第 82 行那个 <code>true</code>。</b>
              <code>addEventListener</code> 的第三个参数是「是否在捕获阶段监听」。
              资源加载失败的 error 事件<b>不会冒泡</b>，所以如果你写成
              <code>window.onerror = fn</code> 或者用默认的冒泡阶段，
              <b>你永远拿不到图片和脚本的加载失败。</b>`,
        list: [
          `区分两类错误靠 <code>event.target</code>：JS 错误时 target 是 <code>window</code>，资源错误时是具体的 DOM 元素`,
          `JS 错误优先用 <code>event.error</code> 拿真实的 Error 对象（有完整堆栈），拿不到再退化成 <code>event.message</code>`,
          `每个监听器内部都单独 try/catch —— 采集逻辑自身出错时静默，绝不向上抛`,
        ],
      },
      {
        h: 'Promise 未捕获必须单独监听',
        code: [[85, 92]],
        note: `<code>unhandledrejection</code> 是一个独立事件，
              <b>不会触发上面的 error 事件</b>。
              现在前端代码大量使用 async/await，漏掉这个监听等于放弃了半壁江山。`,
      },
      {
        h: '白屏检测：等 3 秒，然后看第一层子节点',
        code: [[29, 45]],
        note: `<code>hasVisibleContent()</code> 只看 <code>body.children</code> 第一层，不递归 ——
              因为如果首屏有任何内容渲染出来，它一定会出现在这一层。
              不递归是为了控制开销（白屏只检测一次）。`,
      },
      {
        h: '计时时机：必须在 load 之后',
        code: [[94, 118]],
        note: `这是白屏检测最容易写错的地方。<b>如果在 DOMContentLoaded 或更早就开始计时，
              SPA 的异步渲染还没完成，会被大量误报成白屏。</b>
              等 <code>load</code> 之后再等 3 秒，才是合理的判定窗口。
              <code>reported</code> 标记保证一个页面只报一次。`,
      },
    ],
    gotchas: [
      {
        t: '<code>getClientRects()</code> 不能换成 <code>offsetHeight</code>',
        d: `判断元素是否真的占据布局空间时，用了 <code>el.getClientRects().length &gt; 0</code>。
            看起来绕，但必要：<b><code>display: contents</code> 的元素高度是 0，内容却是可见的</b>。
            用 <code>offsetHeight</code> 判断会把这个页面误判成白屏。`,
      },
      {
        t: '三个常量都是「取舍」而不是「真理」',
        d: `<code>BLANK_SCREEN_DELAY = 3000</code>：太短会误报 SPA 的异步渲染，太长就失去了预警意义。
            <code>INVISIBLE_TAGS</code>：这些标签即使存在也不算「页面有内容」——
            不然一个只有 <code>&lt;script&gt;</code> 的白屏页会被判为正常。`,
      },
      {
        t: 'resource 错误的 source 字段存的是资源 URL',
        d: `和 JS 错误的 <code>source</code>（存来源文件）语义不同，
            但复用了同一个字段。看板展示时需要按 <code>kind</code> 区分理解。`,
      },
    ],
    interview: `「错误采集有四类，其中资源加载失败和白屏最容易被忽略，
                因为它们都不产生 JS 异常、try/catch 抓不到。
                资源错误的关键点在于 error 事件不冒泡，只能在捕获阶段监听，
                也就是 addEventListener 第三个参数传 true —— 写成 window.onerror 是拿不到的。
                白屏检测必须等 load 之后再计时，否则 SPA 的异步渲染会大量误报。」`,
  },

  {
    id: 'webVitals',
    group: '采集插件',
    title: 'webVitals.ts',
    nav: 'webVitals.ts 性能采集',
    file: 'packages/core/src/integrations/webVitals.ts',
    loc: 202,
    pitch: '采集五个核心性能指标。这个文件里有一个「真实踩过并被修掉的缺陷」，是本项目最好的面试素材。',
    problem: [
      `性能指标不像错误那样是「事件发生」——它们是<b>持续累积</b>的。
       LCP 每出现一个更大的元素就更新一次，CLS 是不断累加的，
       INP 要取所有交互里最慢的那一次。`,
      `所以这个文件真正要解决的不是「怎么拿到数据」，而是
       <b>「拿到之后什么时候上报、上报哪一个值」</b>。这两件事必须分开处理。`,
      {
        table: [
          ['指标', '含义', '累积方式'],
          ['FCP', '屏幕上第一次出现内容', '一条定终身'],
          ['LCP', '最大那块内容出现的时间', '反复更新，取最新'],
          ['CLS', '布局偏移累计量（页面乱跳程度）', '持续累加'],
          ['INP', '点击到屏幕有反应的时间', '取最差的一次'],
          ['TTFB', '服务器吐出第一个字节的耗时', '一条定终身'],
        ],
      },
    ],
    blocks: [
      {
        h: '订阅：每个 entryType 单独兜 try/catch',
        code: [[26, 43]],
        note: `<b><code>buffered: true</code> 不能漏。</b>SDK 通常是异步加载的，
              等它起来时 FCP 早就算完了。不加这个参数就只能拿到空数据，
              而且这种 bug 在开发环境下很难复现。
              <br /><br />
              <b>每个类型单独 try/catch 也不能省。</b>
              Safari 对 <code>'layout-shift'</code>、<code>'event'</code> 的支持落后于 Chrome，
              <code>observer.observe({ type })</code> 遇到不支持的类型会<b>直接抛错</b>。
              不逐个兜住的话，一个不支持的类型会让后面所有指标都采集不到。`,
      },
      {
        h: '三种合并语义：不同指标的天性不一样',
        code: [[45, 93]],
        table: [
          ['模式', '用在哪', '为什么'],
          ['<code>once</code>', 'FCP、TTFB', '一条就定终身，重复的 entry 不能覆盖首次值'],
          ['<code>max</code>', 'LCP、INP', '关心的是<b>最差</b>那一次，比已有值小的候选直接丢'],
          ['<code>sum</code>', 'CLS', '布局偏移是累加的'],
        ],
        note: `<b>为什么要有 <code>pending</code> 这一层缓存，而不是在 Observer 回调里直接上报：</b>
              回调的触发频率由浏览器决定，LCP 在一次加载里可能触发十几次。
              逐条上报会把队列灌满，趋势图上也会出现一堆同一个加载过程的中间值，
              真实分布反而看不出来。<b>先在内存里合并，再由调度器决定交出去的时机。</b>`,
      },
      {
        h: '上报调度：空闲时合并，隐藏时兜底',
        code: [[105, 150]],
        note: `这段代码是<b>一次缺陷修复的产物</b>，注释里保留了完整的推理过程。
              核心是最后那个 <code>onPageHide</code> —— 见下面的坑。`,
      },
      {
        h: '五个指标各自的订阅',
        code: [[152, 195]],
        list: [
          `<code>'paint'</code> 类型里同时有 first-paint 和 first-contentful-paint，<b>只要后者</b>`,
          `LCP 顺手记下命中的元素标签名（<code>attribution.element</code>），有助于定位「到底是哪张图慢」`,
          `CLS 里 <code>if (shift.hadRecentInput) continue</code> 排除用户交互后 500ms 内的位移 —— <b>那是用户自己点出来的，不算布局不稳定</b>`,
          `INP 官方定义近似取第 98 百分位，MVP 阶段用最大值代替`,
        ],
      },
    ],
    gotchas: [
      {
        t: '⚠️ 真实缺陷：只靠空闲上报会丢数据',
        d: `<b>症状</b>：演示流程是「打开演示站 → 点几个按钮 → 立刻点打开看板」，
            结果性能页一张图都没有；但在页面上多停留几秒再走，数据又正常。
            <br /><br />
            <b>根因</b>：原来每个指标是「收到 entry → 排一个空闲任务 → 空闲时才上报」。
            用户 1 秒内点击跳转时，<code>requestIdleCallback</code> 还没轮到执行，页面就销毁了，
            pending 里的 LCP/CLS/INP 永久丢失。`,
      },
      {
        t: '⚠️ 第二层更难：加了兜底还是会丢',
        d: `<code>client</code> 在<b>构造函数</b>里就注册了自己的 <code>pagehide → flush</code>，
            而插件的 <code>setup()</code> 在 <code>init()</code> 里晚一步调用。
            事件监听<b>按注册顺序触发</b>，所以 client 的 flush 一定跑在插件上报之前 ——
            那一刻指标还没进队列，flush 等于什么都没做。
            <br /><br />
            <b>修法</b>：插件在兜底上报之后自己再补一次 <code>client.flush(true)</code>。
            这条顺序依赖写进了注释，因为它不读代码根本看不出来。`,
      },
      {
        t: 'CLS 等于 0 也必须上报',
        d: `第 132 行那个 <code>if (mode !== 'sum' &amp;&amp; !(value &gt; 0)) return</code> 里，
            <b>CLS 是唯一的例外</b>。因为「这一路没发生布局偏移」本身就是个有价值的结论
            —— 是绿灯而不是没数据。其余指标为 0 说明没取到值，报上去只会污染趋势图。`,
      },
      {
        t: '为什么不用现成的 web-vitals 库',
        d: `两个原因：一是要守 8KB 体积预算；
            二是<b>这些指标的算法本身就是面试考点</b>，自己实现才讲得清。
            用库的话，面试官问「LCP 怎么算的」你只能答「库里有」。`,
      },
    ],
    interview: `「性能指标的难点不在采集而在上报时机：它们是持续累积的，
                LCP 一次加载要更新十几次，所以我在内存里按 once/max/sum 三种语义合并，
                再由空闲调度统一上报。
                另外这里踩过一个真实缺陷 —— 只靠空闲上报的话，
                用户点完立刻跳走会丢最后一批数据，而且因为 client 的 pagehide 监听比插件先注册，
                补兜底时还得自己再 flush 一次才会生效。」`,
  },

  {
    id: 'network',
    group: '采集插件',
    title: 'network.ts',
    nav: 'network.ts 网络采集',
    file: 'packages/core/src/integrations/network.ts',
    loc: 161,
    pitch: '记录每一次请求的耗时和阶段拆分。做法是「代理」而不是「替换」。',
    problem: [
      `网络瀑布图的价值在于<b>把「慢」拆成可归因的几段</b>：
       是 DNS 慢、建连慢、服务器响应慢，还是资源太大下载慢？
       只看总耗时的话，你只能猜。`,
      `但拦截请求是 SDK 里<b>最具侵入性</b>的操作 —— 你要替换掉浏览器原生的
       <code>fetch</code> 和 <code>XMLHttpRequest</code>。
       做错了，宿主页面直接崩。`,
    ],
    blocks: [
      {
        h: '阶段耗时怎么取：拿不到就返回 undefined',
        code: [[14, 54]],
        note: `数据来自 Resource Timing API 的原始时间点，
              这里把绝对时间点<b>换算成各阶段的自身耗时</b>，看板才能直接画。
              <br /><br />
              <b>关键是第 40 行那个判断</b>：跨域资源如果没返回
              <code>Timing-Allow-Origin</code> 响应头，浏览器会把除
              <code>startTime</code>/<code>duration</code> 外的<b>所有字段置 0</b>。
              这是浏览器的隐私设计，绕不过去。这时候<b>返回 undefined，而不是返回一堆 0</b>
              —— 看板会据此画一条整条的灰条，而不是画出一堆长度为 0 的分段假装自己知道。`,
      },
      {
        h: '代理 fetch：必须保留 this 和返回值',
        code: [[69, 103]],
        list: [
          `<b>必须用 <code>function</code> 而不是箭头函数</b>：需要保留 <code>this</code> 指向，某些库依赖它`,
          `<code>originalFetch.call(this, ...)</code> 原样调用原生方法，<b>不改任何参数</b>`,
          `<b>请求失败也要记一笔</b>（<code>status: 0</code>）——
           否则看板上只看到成功的请求，慢接口反而从数据里消失了`,
          `记录完成后 <code>return response</code>，业务代码拿到的必须是原生 Response 对象`,
        ],
      },
      {
        h: '代理 XHR：元信息挂实例，收尾用 loadend',
        code: [[105, 158]],
        note: `<code>open</code> 时把 url 和 method 挂到实例的 <code>__prism</code> 属性上，
              <code>send</code> 时取出来用。因为这两个方法调用时机不同，
              状态只能存在实例上才不会串。
              <br /><br />
              <b>为什么监听 <code>loadend</code> 而不是 <code>load</code> 或 <code>error</code>：</b>
              <code>loadend</code> 在成功、失败、中止三种情况下<b>都会触发</b>，
              是唯一可靠的收尾时机。监听 <code>load</code> 会漏掉失败请求。`,
      },
    ],
    gotchas: [
      {
        t: '🔴 绝不读响应体 —— 这是绝对不能做的事',
        d: `响应体必须读流才能拿到，而<b>流只能读一次</b>。
            一旦 SDK 读了，业务代码再读拿到就是空数据。
            这是 SDK 放弃第三方页面时最容易踩的坑，而且症状极其诡异 ——
            页面看起来正常，但某个接口的数据莫名变成空。
            <br /><br />
            所以这个插件的隐私红线是：<b>只取 URL、方法与时序，绝不碰请求体和响应体。</b>`,
      },
      {
        t: '「代理」和「替换」的区别',
        d: `代理的意思是：包一层壳记录耗时，然后<b>原样调用</b>浏览器原生方法。
            任何对原生 API 的行为改变（哪怕只是少传一个参数、改一下返回值的类型）
            都可能让宿主页面直接崩掉。这是 SDK 侵入第三方页面时最基本的礼貌。`,
      },
      {
        t: '同一个 URL 被请求多次时取最后一个 entry',
        d: `<code>performance.getEntriesByName(url, 'resource')</code> 返回的是数组，
            取 <code>entries[entries.length - 1]</code>。
            因为性能条目是按时间累积的，最后一次才是刚发出去的那次请求。`,
      },
    ],
    interview: `「网络采集我做的是代理而不是替换 —— 包一层记录耗时，然后原样调用原生方法，
                不做任何行为改变。fetch 用 function 保留 this 指向，XHR 监听 loadend
                因为它在成功失败中止时都会触发。
                有一条红线是绝不读响应体 —— 流只能读一次，读了业务代码再读就是空数据。
                另外跨域资源没有 Timing-Allow-Origin 时，浏览器会把阶段字段置 0，
                我选择返回 undefined 而不是编造数据。」`,
  },

  {
    id: 'breadcrumbs',
    group: '采集插件',
    title: 'breadcrumbs.ts',
    nav: 'breadcrumbs.ts 行为轨迹',
    file: 'packages/core/src/integrations/breadcrumbs.ts',
    loc: 109,
    pitch: '记录用户报错前做过什么。这是整个项目最实用的功能。',
    problem: [
      `只有堆栈时，你知道的是「哪里错了」；
       有了面包屑，你才知道<b>「用户是怎么走到这一步的」</b>。后者才是能复现问题的关键。`,
      `举个具体的例子：堆栈告诉你 <code>Cannot read property 'price' of undefined</code>
       发生在结算页。但用户是怎么到结算页的、有没有先改过数量、有没有重复提交 ——
       这些信息决定了你能不能复现。`,
    ],
    blocks: [
      {
        h: '把 DOM 元素压成一段可读的选择器',
        code: [[15, 25]],
        note: `<code>tag#id.class1.class2</code> 这种形式，<b>体积优先，够用就行</b>。
              class 只取前两个 —— 因为很多框架（CSS Modules、Tailwind）
              会生成一长串 class，全记下来体积会爆，而且对定位帮助不大。`,
      },
      {
        h: '点击：必须用捕获阶段',
        code: [[44, 57]],
        note: `第二个参数传 <code>true</code>，在<b>捕获阶段</b>监听。
              因为业务代码经常在组件内部调用 <code>stopPropagation()</code> 阻止冒泡，
              如果用默认的冒泡阶段，这些点击就全漏掉了。`,
      },
      {
        h: 'SPA 路由：必须自己 patch history',
        code: [[59, 89]],
        note: `这是本文件的另一个关键点：<b>SPA 切换路由不会触发任何原生事件</b>，
              必须 monkey patch <code>history.pushState</code> 和 <code>replaceState</code>。
              <code>popstate</code> 是原生事件，用来管浏览器后退。
              <br /><br />
              patch 的写法要注意：用 <code>function</code> 保留 <code>this</code>，
              记录完之后 <code>original.apply(this, args)</code> <b>必须原样调用原方法</b>，
              否则路由直接不工作。`,
      },
      {
        h: '生命周期：用来判断报错发生在哪个阶段',
        code: [[91, 106]],
        note: `记录 «DOM 解析完成»、«页面加载完成»、«页面隐藏» 三个时间点。
              目的是回答一个排障时很关键的问题：
              <b>这个报错是发生在首屏渲染期间，还是用户已经在页面上操作了很久之后？</b>`,
      },
    ],
    gotchas: [
      {
        t: '绝不记录 DOM 内容',
        d: `只记录「发生了什么」的元信息（点了哪个元素、导航到哪个 URL），
            <b>不记录 input 的值、不记录页面文本</b>。
            用户的输入内容属于隐私 —— 这和 <code>sanitize.ts</code> 是同一条原则的两个面。
            <br /><br />
            如果记了用户输入的手机号、密码，那你前面费劲做的脱敏全白费了。`,
      },
      {
        t: '记面包屑失败要静默',
        d: `<code>add()</code> 里裹了 try/catch。面包屑是辅助信息，
            <b>记不上无所谓，绝不能因此影响用户操作</b>。`,
      },
    ],
    interview: `「面包屑记录的是用户报错前的操作轨迹 —— 只有堆栈的时候你知道哪里错了，
                有面包屑才知道用户怎么走到这一步的。
                实现上点击用捕获阶段监听，因为业务代码经常 stopPropagation，
                用冒泡阶段会漏。
                SPA 路由变化不触发原生事件，所以必须 monkey patch history 的
                pushState 和 replaceState。
                隐私上只记元信息不记 DOM 内容，input 的值一律不碰。」`,
  },
];
