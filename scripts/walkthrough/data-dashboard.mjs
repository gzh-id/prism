/**
 * 代码导览数据 · 分析看板（apps/dashboard/src）
 *
 * 看板是个 React 应用，但它读的是本机 IndexedDB 里的数据，
 * 所以打开速度极快；导出报告时又能整份内联进一个 HTML 文件。
 */
export default [
  {
    id: 'hooks',
    group: '分析看板',
    title: 'hooks.ts',
    nav: 'hooks.ts 数据源',
    file: 'apps/dashboard/src/hooks.ts',
    loc: 79,
    pitch: '唯一的数据入口。79 行解决了「同一个界面要能读两种数据源」的问题。',
    problem: [
      `这个看板有两种打开方式，数据来源完全不同：`,
      {
        table: [
          ['打开方式', '数据在哪', '典型场景'],
          [
            `<code>localhost:5173/apps/dashboard/</code>`,
            '本机 IndexedDB',
            '开发时实时观察自己页面的数据',
          ],
          [
            '双击别人发来的 <code>prism-report-xxx.html</code>',
            '<b>文件内嵌的压缩数据</b>',
            '同事在他电脑上、断网状态下看你的报告',
          ],
        ],
      },
      `第二种情况下，数据在<b>导出者的浏览器</b>里，接收方的 IndexedDB 是空的。
       没有对应分支的话，导出的报告打开就是一片空白 —— 功能等于没做。`,
    ],
    blocks: [
      {
        h: '先试内嵌数据：读全局变量并解压',
        code: [[5, 26]],
        note: `导出的报告模板里已经内联了看板的 JS，同时在页面里写了一个全局变量
              <code>window.__PRISM_PAYLOAD__</code>，值是压缩 + Base64 后的数据。
              这里读它、解压、还原成事件数组。
              <br /><br />
              <b>注意 try/catch</b>：数据损坏或版本不匹配时降级为「没有数据」，
              而不是白屏崩溃。一份报告发给别人，宁可显示「暂无数据」也不能崩。`,
      },
      {
        h: '两个数据源的优先级',
        code: [[28, 79]],
        note: `顺序很明确：<b>有内嵌数据就用内嵌数据，否则读 IndexedDB。</b>
              <br /><br />
              另外三个细节：<br />
              ① <code>cancelled</code> 标记防止组件卸载后 setState —— 那是 React 警告和内存泄漏的常见来源<br />
              ② <code>fromReport</code> 状态传给 UI，让它能显示「离线报告模式」并禁用导出按钮<br />
              ③ <code>reload</code> 用一个自增的 <code>nonce</code> 触发重新读取，简单可靠`,
      },
    ],
    gotchas: [
      {
        t: '为什么不在报告里内嵌「原始 JSON」而要压缩+Bash64',
        d: `一份真实站点的监控数据轻松上 MB，直接内嵌会让 HTML 文件大到发不出去。
            实测这个项目的数据压缩后只剩 <b>10.6%</b>（14.8KB → 1.6KB）。
            Base64 则是必须的 —— 二进制字节流不能直接塞进 HTML 文本里。`,
      },
      {
        t: '<code>fromReport</code> 是被 UI 真正用到的',
        d: `不只是一个标记：<code>App.tsx</code> 用它显示「离线报告模式」徽标、
            显示一句说明「当前展示的是报告文件里内嵌的数据」、
            并且<b>禁用导出按钮</b>（避免对报告再导出报告）。`,
      },
    ],
    interview: `「看板有两种数据源：开发时读本机 IndexedDB，
                打开导出的报告时读文件里内嵌的压缩数据。
                hooks 里优先读内嵌数据，这个分支不做的话导出的报告打开就是空白。
                两种情况下 UI 完全一样，区别只是右上角会显示离线报告模式。」`,
  },

  {
    id: 'App',
    group: '分析看板',
    title: 'App.tsx',
    nav: 'App.tsx 框架与导出',
    file: 'apps/dashboard/src/App.tsx',
    loc: 141,
    pitch: '看板的框架层，以及「单文件离线报告」的核心实现 —— 这是整个项目的杀手锏功能。',
    problem: [
      `这个文件承担两件事。第一件很普通：四个页签的切换。
       第二件是这个项目最有辨识度的功能：<b>把数据导出成一份自包含的 HTML</b>，
       断网双击就能看，可以直接发给别人。`,
      `它的做法是「<b>模板 + 数据</b>」：
       构建时产出一份已经把看板 JS 和样式全部内联好的 <code>report-template.html</code>，
       里面留了一个占位符；导出时只要把压缩后的数据填进占位符，
       就得到一份完整可用的报告。`,
    ],
    blocks: [
      {
        h: '页签配置：数据驱动而不是写四段 if',
        code: [[6, 13]],
        note: `页签定义成一个数组，渲染时 <code>map</code> 出来，
              切换时只改 <code>tab</code> 状态。加页签只要往数组里加一项。`,
      },
      {
        h: '占位符：必须写成完整赋值语句',
        code: [[15, 22]],
        note: `这段注释记录的是一次真实踩坑。<b>占位符不能只写片段
              （比如只写 <code>/*__PRISM_DATA__*/null</code>），
              必须写成完整的赋值语句。</b>
              <br /><br />
              原因：这个字符串<b>同时作为常量存在于打包后的 bundle 里</b>
              （因为 <code>App.tsx</code> 自己引用了它）。
              只匹配片段的话，替换时会把 bundle 内部的那份常量也一起换掉，
              <b>直接把代码破坏掉</b>。`,
      },
      {
        h: '导出流程：取数据 → 读模板 → 替换 → 下载',
        code: [[30, 71]],
        list: [
          `<code>exportCompressedReport()</code> 读空 IndexedDB、压缩、Base64 编码，<b>同时返回压缩率数据</b>用于 UI 展示`,
          `用 <code>fetch</code> 读同目录下的 <code>report-template.html</code>`,
          `<b>先校验占位符存在</b>，找不到就直接抛错并提示「请重新执行 npm run build」——
           这比默默生成一个白屏报告好得多`,
          `<code>String.replace</code> 的替换值<b>必须写成函数形式</b>（见下面的坑）`,
          `用 <code>Blob</code> + <code>URL.createObjectURL</code> 触发下载，用完立刻 <code>revokeObjectURL</code> 释放`,
          `导出后展示「已导出 xxKB；数据压缩省了 xx%」—— 让用户看到压缩效果`,
        ],
      },
      {
        h: '离线报告模式下的 UI 差异',
        code: [[92, 116]],
        note: `这是「离线报告」和「实时看板」<b>唯一的差别</b>。
              界面上其余部分完全一致，因为跑的是同一份 bundle。
              <br /><br />
              差别有三处：右上角显示「离线报告模式」而不是「刷新」按钮；
              导出按钮被禁用；多一行说明文字。`,
      },
    ],
    gotchas: [
      {
        t: '⚠️ <code>String.replace</code> 的 <code>$&amp;</code> 陷阱',
        d: `替换字符串里 <code>$</code> 是有特殊含义的：
            <code>$&amp;</code> 表示「匹配到的内容」、<code>$'</code> 表示「匹配之后的内容」。
            <b>React 压缩后的代码里恰好含这些序列</b>，直接传字符串会让 HTML 片段被注入到
            代码内部，症状是产物里莫名出现 <code>&lt;script src="..."&gt;</code> 字面量，
            其中的 <code>&lt;/script&gt;</code> 会提前结束内联脚本块 —— <b>报告直接白屏。</b>
            <br /><br />
            <b>修法</b>：把替换值写成 <code>() =&gt; ...</code> 函数形式，返回值不参与替换模式解析。`,
      },
      {
        t: '空格子元素要判空而不是断言',
        d: `「本地还没有数据」那个分支里用了 <code>{'&lt;script src=...&gt;'}</code>
            这种写法把代码当字符串渲染。因为压缩后的 JS 里直接写
            <code>&lt;script&gt;</code> 标签会被 HTML 解析器误认，必须转义或用字符串包起来。`,
      },
      {
        t: '导出前要确认数据不为空',
        d: `<code>disabled={exporting || fromReport || events.length === 0}</code>
            —— 三个条件都要判。数据为空时导出一份空报告没有意义，
            还会让用户以为功能坏了。`,
      },
    ],
    interview: `「导出功能用的是模板加数据的思路：构建时产出一份已经把看板 JS 和样式
                全部内联好的模板，留一个数据占位符，导出时填进去就是一份能离线双击打开的 HTML。
                这里有两个坑：占位符必须写成完整赋值语句，
                因为它同时作为常量存在于 bundle 里，只匹配片段会误伤代码；
                另外 String.replace 的替换值必须写成函数，
                因为 React 压缩后的代码里含 $& 这类序列，会被当成替换模式。』`,
  },

  {
    id: 'views',
    group: '分析看板',
    title: 'views.tsx',
    nav: 'views.tsx 四个页签',
    file: 'apps/dashboard/src/views.tsx',
    loc: 217,
    pitch: '四个页签的实现：概览、错误、性能、网络。全部是纯函数组件，数据由 props 传进来。',
    problem: [
      `从事件数组到「人能看懂的结论」，中间要做三件事：
       把混在一起的三类事件分开、把一堆原始值算成有意义的统计量、
       在数据缺失时给出合理的空状态而不是一堆空图。`,
    ],
    blocks: [
      {
        h: '类型守卫：把联合类型收窄成具体类型',
        code: [[8, 10]],
        note: `<code>PrismEvent</code> 是三种事件的联合类型。用这种
              <code>(e): e is ErrorEvent =&gt; ...</code> 的写法，
              <code>filter(isError)</code> 之后 TypeScript 才知道剩下的都是 <code>ErrorEvent</code>，
              后面访问 <code>item.stack</code> 才不会报错。`,
      },
      {
        h: '中位数，而不是平均数',
        code: [[18, 24]],
        note: `这是本文件最值得讲的一个选择。<b>一次偶发的 5 秒 LCP 会把平均值整个拉歪</b>，
              而中位数代表的是「用户平时感受到的速度」。
              <br /><br />
              监控数据天然有长尾（少数极慢的请求），用平均数会让一个异常值毁掉整块图表的可读性。`,
      },
      {
        h: '概览页：四个关键数字',
        code: [[28, 97]],
        list: [
          `错误总数、会话数（<code>new Set</code> 去重）、LCP 中位数、慢请求数`,
          `<b>颜色即结论</b>：LCP 中位数超过达标线显示橙色，否则绿色；有错误时错误数显示粉色`,
          `LCP 趋势图前面有一层 <code>length &gt; 0</code> 判断，没数据时显示「还没有 LCP 数据」而不是一张空图`,
        ],
      },
      {
        h: '错误页：列表用虚拟滚动，详情展示面包屑',
        code: [[101, 165]],
        note: `列表按时间<b>倒序</b>（最新的在最上面），点击某一条后在下方展开详情：
              完整堆栈 + 报错前的操作轨迹。
              <br /><br />
              面包屑为空时显示提示「启用 breadcrumbsIntegration 后可以回溯用户操作」——
              <b>这种引导性空状态比一个空白区域有用得多。</b>`,
      },
      {
        h: '性能页：只渲染有数据的指标',
        code: [[169, 201]],
        note: `注意 <code>if (series.length === 0) return null;</code> 这一行。
              <b>五个指标不是每次都采得到的</b>（Safari 上 CLS/INP 可能全程为空），
              无条件渲染五张图会得到三张空图，看起来很糟糕。
              <br /><br />
              标题里直接带上中位数，用户不用看图就能知道结论。`,
      },
    ],
    gotchas: [
      {
        t: '空状态必须显式处理',
        d: `四个页签都有各自的空状态：没有错误显示「还没有捕获到错误」、
            没有性能数据显示「还没有性能数据」、没有网络数据显示提示。
            <b>这比让用户看到一片空白或者一张坐标轴都没有的图要好得多。</b>`,
      },
      {
        t: '排序方向是相反的',
        d: `错误列表用<b>倒序</b>（<code>b.timestamp - a.timestamp</code>），因为排障时最关心最新的错误；
            而网络瀑布图用<b>正序</b>（<code>a.timestamp - b.timestamp</code>），因为瀑布图必须按时间先后画。`,
      },
      {
        t: '阈值来自 shared，不在这里硬编码',
        d: `<code>METRIC_THRESHOLDS[name][0]</code> 直接引用共用常量。
            内核算评级用的是同一份数据 —— 如果两处各写一份，
            会出现「内核标红但看板画在绿线以下」这种自相矛盾。`,
      },
    ],
    interview: `「看板四个页签都是纯函数组件，数据从 props 进来。
                一个细节是汇总统计我用中位数不用平均数 —— 监控数据有长尾，
                一次偶发的 5 秒 LCP 会把平均值整个拉歪，中位数才代表用户的典型体验。
                另外五个性能指标不是都采得到，所以只渲染有数据的那些，
                空状态也都有明确的提示文案。』`,
  },

  {
    id: 'VirtualList',
    group: '分析看板',
    title: 'VirtualList.tsx',
    nav: 'VirtualList.tsx 虚拟滚动',
    file: 'apps/dashboard/src/VirtualList.tsx',
    loc: 124,
    pitch: '手写虚拟滚动，支持变高行。错误列表上千条也不卡。',
    problem: [
      `错误列表可能有几千条。全部渲染成 DOM 的话，
       光是创建节点就要几秒，滚动时每一帧还要重排全部节点。`,
      `<b>虚拟滚动的思路</b>：只渲染可视区域内的那几条，
       用「撑高的空 div」让滚动条长度保持正确。
       DOM 节点数就被恒定在「可视区条数 + overscan」这个量级。`,
      `难点在于<b>行高不固定</b> —— 错误消息有长有短。
       变高行没法直接用 <code>index × 行高</code> 算出位置，必须另想办法。`,
    ],
    blocks: [
      {
        h: '前缀和 + 二分查找：把「滚动位置」换算成「第几条」',
        code: [[44, 73]],
        list: [
          `<b>前缀和</b>：<code>offsets[i]</code> 表示第 i 条之前的累计高度。有了它，任意行的顶部位置都是 O(1) 查表`,
          `<b>行高缓存</b>：<code>measured.current</code> 存测过的真实高度，没测过的用估算值兜底。不缓存的话每次滚动都要重算全部`,
          `<b>二分查找</b>：找到滚动位置落在哪一行。<b>不能用遍历</b>，万行数据下每帧遍历一次会直接掉帧`,
          `<code>(lo + hi + 1) &gt;&gt; 1</code> 这种写法求的是「上中位数」，保证循环一定会收敛，不会死循环`,
        ],
      },
      {
        h: 'useLayoutEffect 测量：必须在绘制前完成',
        code: [[75, 90]],
        note: `<b>为什么是 <code>useLayoutEffect</code> 而不是 <code>useEffect</code>：</b>
              它会在浏览器绘制<b>之前</b>同步执行，此时修正测量结果不会让用户看到
              「位置错乱再跳回来」的一帧闪烁。<code>useEffect</code> 是异步的，会闪。`,
      },
      {
        h: 'overscan 与渲染结构',
        code: [[92, 124]],
        note: `<b>overscan 是「在可视区上下各多渲染几条」。</b>
              因为滚动不是逐像素触发的，一次可能跳几十像素，
              不预留缓冲的话用户会先看到白块、再看到内容补上。
              <br /><br />
              结构上是一个 <code>overflow: auto</code> 的容器，
              里面放一个高度等于总高度的相对定位 div，可见行用 <code>position: absolute</code>
              配合 <code>top: offsets[i]</code> 定位。`,
      },
    ],
    gotchas: [
      {
        t: '<code>measureTick</code> 是刻意的额外依赖',
        d: `<code>offsets</code> 的 <code>useMemo</code> 依赖数组里放了 <code>measureTick</code>，
            看起来是多余的。但它必要：<b>测量会修改 <code>measured.current</code> 这个 ref，
            而 ref 变化不会触发重新渲染</b>，所以需要一个 state 变化来强制重算前缀和。`,
      },
      {
        t: '行高是边渲染边测的，第一帧一定不准',
        d: `所以 <code>estimatedHeight</code> 这个估算值必须给得合理
            （默认 62px）。给得太离谱会导致第一帧滚动位置跳动明显。
            这也是为什么叫「估算值」而不是「默认值」。`,
      },
      {
        t: '为什么不用现成的库',
        d: `<code>react-window</code> 之类的库很成熟，但这个项目
            <b>刻意手写</b> —— 因为虚拟滚动是实现难度和面试价值都最高的部分之一，
            用库的话面试时讲不出东西。`,
      },
    ],
    interview: `「错误列表我手写了虚拟滚动，因为几千条数据全渲染会让创建 DOM 和滚动重排都很慢。
                难点在行高不固定 —— 错误消息长短不一，没法直接算位置。
                我的做法是渲染后测量真实高度缓存起来，同时维护一个前缀和数组，
                把滚动位置通过二分查找换算成起始行号。
                测量用 useLayoutEffect 而不是 useEffect，
                因为要在浏览器绘制前修正，否则会看到一帧位置错乱的闪烁。』`,
  },

  {
    id: 'LineChart',
    group: '分析看板',
    title: 'LineChart.tsx',
    nav: 'LineChart.tsx 折线图',
    file: 'apps/dashboard/src/LineChart.tsx',
    loc: 195,
    pitch: '手写 Canvas 时序折线图，带达标参考线。难点在降采样和高分屏清晰度。',
    problem: [
      `为什么用 Canvas 而不是 SVG：<b>数据量上千以后，SVG 的每个点都是一个 DOM 节点</b>，
       浏览器光是维护这些节点就会卡住。Canvas 只有 1 个节点，
       绘制成本和数据量线性相关。`,
      `两个必须处理的细节：高分屏清晰度、以及「点太多但屏幕没那么宽」的浪费。`,
    ],
    blocks: [
      {
        h: 'LTTB 降采样：保留峰值，而不是简单抽稀',
        code: [[22, 73]],
        note: `<b>屏幕横向只有几百个像素，却要画上万个点，绝大部分点是浪费的。</b>
              但抽稀不能乱抽 —— 监控图表里<b>尖峰恰恰是你要看的东西</b>。
              <br /><br />
              <b>LTTB</b>（Largest-Triangle-Three-Buckets）的做法是：
              把数据分桶，每桶选一个点，选择标准是「与前后两点构成的三角形面积最大」。
              面积最大意味着这个点最能代表局部的形状特征。
              <br /><br />
              第 57 行的注释点出了实现要点：<b>用叉积算三角形面积，省掉开方</b>。
              我们只需要比较面积大小，不需要知道具体数值，所以免掉 √ 运算。`,
      },
      {
        h: 'devicePixelRatio：不处理就会糊',
        code: [[93, 122]],
        note: `<b>Canvas 的 CSS 尺寸和绘图缓冲区尺寸是两回事。</b>
              <code>canvas.clientWidth</code> 是 CSS 宽度，
              而 <code>canvas.width</code> 是缓冲区像素宽度。
              <br /><br />
              在 2 倍屏上如果不把缓冲区放大 2 倍再用 CSS 缩回去，
              浏览器会拉伸缓冲区里的低分辨率图像 —— <b>画出来的线和字都是模糊的</b>。
              <br /><br />
              <code>ctx.setTransform(dpr, 0, 0, dpr, 0, 0)</code> 之后，
              后续所有绘制坐标都按 CSS 像素来写，不用自己乘 dpr，清爽很多。`,
      },
      {
        h: '达标线 + 面积填充 + 折线',
        code: [[148, 192]],
        list: [
          `<b>达标参考线</b>用虚线画在阈值处，让用户一眼看出「哪些点超标了」`,
          `<b>面积填充</b>用半透明渐变，视觉上把「线的下方」强调出来`,
          `Y 轴范围取 <code>max(数据最大值, 阈值) × 1.15</code>，保证达标线始终在可视范围内，且顶部留一点空间`,
          `<code>maxX === minX</code> 时把点画在正中间 —— 只有一个数据点时不能除以 0`,
        ],
      },
    ],
    gotchas: [
      {
        t: '简单抽稀会抹掉峰值',
        d: `如果按固定间隔取点（比如每 10 个取 1 个），一个持续 1 分钟的性能尖峰
            很可能<b>刚好落在被丢掉的那 9 个点里</b>。
            LTTB 的核心价值就是「保留视觉形状」，尖峰一定会被选中。`,
      },
      {
        t: '数据点只有一个时也要能画',
        d: `<code>toX</code> 里对 <code>maxX === minX</code> 做了特判。
            这类边界在真实数据里经常出现 —— 用户第一次打开页面时，
            某个指标就可能只有一个数据点。`,
      },
      {
        t: '阈值线不参与 Y 轴压缩',
        d: `<code>Math.max(...ys, threshold ?? 0) * 1.15</code>
            —— 阈值也要参与最大值计算。否则当所有数据都远低于阈值时，
            达标线会被画到画布外面去，图表就失去了参照。`,
      },
    ],
    interview: `「折线图我用 Canvas 手写的，因为数据量上千后 SVG 每个点都是一个 DOM 节点，
                维护这些节点会卡。
                两个关键实现：一是要按 devicePixelRatio 放大绘图缓冲区再用 CSS 缩回去，
                否则 2 倍屏上画出来是模糊的；
                二是降采样我用了 LTTB 算法，它不是简单抽稀，
                而是按三角形面积选点，能保留峰值 —— 这点对监控图表很关键，
                因为尖峰恰恰是你要看的东西。』`,
  },

  {
    id: 'Waterfall',
    group: '分析看板',
    title: 'Waterfall.tsx',
    nav: 'Waterfall.tsx 资源瀑布图',
    file: 'apps/dashboard/src/Waterfall.tsx',
    loc: 181,
    pitch: '手写资源瀑布图，把每个请求拆成 DNS / TCP / SSL / 等待响应 / 下载 五段。',
    problem: [
      `这个图是整个看板里<b>最能直接指导优化</b>的一张。
       看到一条请求慢，你立刻能知道是 DNS 慢、建连慢、
       服务器响应慢，还是资源太大下载慢。<b>只看总耗时的话，你只能猜。</b>`,
      `用 Canvas 而不是 DOM：一个页面几百个请求，每个请求 5 段，
       用 DOM 就是上千个节点，滚动会掉帧。`,
    ],
    blocks: [
      {
        h: '五段配色，就是图例',
        code: [[19, 25]],
        note: `每段一个颜色，下方用同样的颜色画图例。
              颜色是跟着「归因」走的：橙色永远是「等待响应」（服务器慢），
              绿色永远是「下载」（资源太大）。`,
      },
      {
        h: '开始时间要反推',
        code: [[51, 61]],
        note: `这是个容易被忽略的点：<b>事件里记录的是请求「结束」的时刻</b>
              （<code>timestamp</code>），不是开始时刻。
              要画瀑布图必须反推：<code>start = timestamp - duration</code>。
              <br /><br />
              横向比例尺用「最早开始」到「最晚结束」的总跨度来算，
              这样每个请求在时间轴上的相对位置才是真实的。`,
      },
      {
        h: '分段绘制：拿不到阶段数据就画整条',
        code: [[84, 105]],
        note: `遍历五个分段，宽度按耗时换算，<code>cursor</code> 依次累加形成堆叠效果。
              <br /><br />
              <b>注意第 89 行那个分支：</b>当 <code>event.timing</code> 不存在时
              （跨域资源没有 <code>Timing-Allow-Origin</code>，阶段数据拿不到），
              画一条整条的灰色条，<b>而不是编造五段</b>。
              「不知道」和「知道是 0」必须区分开。`,
      },
    ],
    gotchas: [
      {
        t: 'hover 提示用 React state 触发 canvas 重绘',
        d: `鼠标移动时算出悬停行的下标存进 state，state 变化触发
            <code>useEffect</code> 重跑、整张 canvas 重绘（悬停行会被高亮）。
            <b>这比用 DOM 叠一层 tooltip 简单得多，也快得多。</b>`,
      },
      {
        t: '时间刻度线要和内容对齐',
        d: `顶部画了 5 条刻度，横向位置用和条形完全相同的
            <code>LABEL_WIDTH + value × scale</code> 公式计算，
            这样刻度线和条形才是同一套坐标系。`,
      },
      {
        t: 'URL 要截断',
        d: `<code>event.url.replace(/^https?:\\/\\//, '').slice(0, 34)</code>
            —— 去掉协议前缀再截断到 34 个字符。
            左侧标签区宽度固定 210px，不截断的话长 URL 会盖住右边的图形。`,
      },
    ],
    interview: `「瀑布图也是 Canvas 画的，因为几百个请求乘以五个分段就是上千个 DOM 节点。
                它把每个请求拆成 DNS、TCP、SSL、等待响应、下载五段，
                这样看到慢请求能直接归因 —— 橙色段长说明服务器慢，绿色段长说明资源太大。
                有个细节是事件记录的是请求结束时刻，所以要反推开始时刻才能画。
                另外拿不到阶段数据时（跨域没开 Timing-Allow-Origin）我画一条整条的灰条，
                不会编造分段数据。』`,
  },
];
