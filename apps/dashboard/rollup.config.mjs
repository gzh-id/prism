import nodeResolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import { dirname, resolve } from 'node:path';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * 生成两份 HTML：
 * 1. dist/index.html —— 常规看板，外链 bundle.js
 * 2. dist/report-template.html —— 单文件报告模板，bundle 与样式已内联，
 *    只差数据。导出时把压缩数据填进占位符，就能产出一个能离线双击打开的 .html。
 *
 * Rollup 只管 JS，HTML 得自己搬，这一步是「单文件离线报告」能成立的前提。
 */
const copyHtml = {
  name: 'copy-html',
  buildEnd() {
    const html = readFileSync(resolve(here, 'index.html'), 'utf-8');
    copyFileSync(resolve(here, 'index.html'), resolve(here, 'dist/index.html'));

    const bundle = readFileSync(resolve(here, 'dist/bundle.js'), 'utf-8');

    // 用正则匹配而不是写死字符串：手写 HTML 时标签里的空格、属性顺序很容易对不上，
    // 写死字符串会静默替换失败（产物里仍留着外链，离线打开就是白屏）
    // 内联后 map 文件不在旁边了，留着引用只会让浏览器报 404
    const withoutSourceMap = bundle.replace(/\/\/#\s*sourceMappingURL=.*$/m, '');

    /**
     * 必须转义 bundle 里出现的 </script>：
     * 内联脚本内容一旦出现这个字面量，HTML 解析器会提前结束 <script> 块，
     * 整个报告直接白屏。这是内联 JS 最经典的坑。
     */
    const safeBundle = withoutSourceMap.replace(/<\/script>/gi, '<\\/script>');

    /**
     * 替换值必须写成函数，不能直接传字符串。
     *
     * String.replace 的替换字符串里 $ 有特殊含义：$& 是「匹配到的内容」、
     * $' 是「匹配之后的内容」。React 压缩后的代码里恰好含这些序列，
     * 直接传字符串会让 HTML 片段被注入进 bundle 内部，
     * 表现为：产物里莫名出现 <script src="..."> 字面量，其中的 </script>
     * 会提前结束内联脚本块，报告直接白屏。
     * 用函数形式返回值就绕过了这个替换规则。
     */
    const template = html
      .replace(
        /<script[^>]+src=["'][^"']*bundle\.js["'][^>]*>\s*<\/script>/i,
        () => `<script>${safeBundle}</script>`,
      )
      .replace(
        '<div id="root"></div>',
        '<div id="root"></div>\n<script>window.__PRISM_PAYLOAD__=/*__PRISM_DATA__*/null;</script>',
      );

    writeFileSync(resolve(here, 'dist/report-template.html'), template, 'utf-8');
  },
};

/**
 * 看板构建。用 Rollup 而不是 Vite —— 同样是 esbuild 原生二进制装不上的原因。
 *
 * 产出 IIFE 单文件是有意为之：阶段 3 的「单文件离线报告」需要把整个看板
 * 内联进一个 HTML，产出的 JS 越集中越好处理。
 */
export default {
  input: 'src/main.tsx',
  output: {
    file: 'dist/bundle.js',
    format: 'iife',
    sourcemap: true,
  },
  plugins: [
    // React 的 production 构建靠这个变量做死代码消除，不替换会打进一堆开发警告
    replace({
      preventAssignment: true,
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
    nodeResolve({ extensions: ['.tsx', '.ts', '.js'], browser: true }),
    // React 与 ReactDOM 发布的是 CommonJS，Rollup 默认只认 ESM，
    // 不转换就会报 "useState is not exported by react/index.js"
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      include: [resolve(here, 'src/**/*.ts'), resolve(here, 'src/**/*.tsx')],
    }),
    terser({ format: { comments: false } }),
    copyHtml,
  ],
};
