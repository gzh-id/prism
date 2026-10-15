import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 插件的 include 用相对路径容易匹配不上（取决于调用时的 cwd），一律转绝对路���
const here = dirname(fileURLToPath(import.meta.url));

/**
 * 三种产物，对应三种接入场景：
 * - esm：现代工程 via npm install，可被 tree-shaking
 * - cjs：老工程或 Node 侧（比如 CLI）require 进来
 * - iife：直接 <script src> 引入，全局挂 Prism 对象 —— 这是「一行接入」的关键
 *
 * 为什么用 Rollup 而不是 esbuild/tsup：
 * 打包类库时 Rollup 的产物更干净（没有 esbuild 那种 helper 注入），
 * 而且它是纯 JavaScript 实现，不需要下载平台相关的原生二进制，
 * 在受限环境里也能正常构建。代价是构建速度比 esbuild 慢，
 * 但对一个 8KB 的小库来说这个代价可以忽略。
 *
 * sourcemap 必须产出：阶段 5 的 CLI 就靠它做堆栈还原，正好自证这个能力。
 */
const outputConfigs = [
  { file: 'dist/index.js', format: 'esm' },
  { file: 'dist/index.cjs', format: 'cjs', exports: 'named' },
  { file: 'dist/index.global.js', format: 'iife', name: 'Prism', exports: 'named' },
];

export default outputConfigs.map((output) => ({
  input: 'src/index.ts',
  output: {
    ...output,
    sourcemap: true,
  },
  plugins: [
    // 必须显式装 node-resolve，否则 rollup 会把 @prism/shared 当成外部依赖，
    // 产出的包里会残留 import，浏览器直接报错。
    // extensions 里要带 .ts，因为 shared 包对外暴露的是 TS 源码而不是编译产物。
    nodeResolve({ extensions: ['.ts', '.js'] }),
    typescript({
      tsconfig: './tsconfig.json',
      // 必须把 shared 一起纳进来：它的对外入口是 TS 源码而不是编译产物，
      // 插件默认只转译 tsconfig.include 里的文件，不写这一行就会报
      // "Expected '{', got 'type'" —— rollup 拿到未转译的 TS 去当 JS 解析了。
      include: [
        resolve(here, 'src/**/*.ts'),
        resolve(here, '../shared/src/**/*.ts'),
      ],
      declaration: false,
      sourceMap: true,
      // 覆盖 rootDir 到 packages/ 一级，让 shared 的源码也落在 rootDir 之内，
      // 否则 TS 会因为「shared/src 不在 core/src 下」持续抛 TS6059 警告。
      compilerOptions: { rootDir: resolve(here, '..') },
    }),
    terser({
      format: { comments: false },
      compress: { passes: 2 },
    }),
  ],
}));
