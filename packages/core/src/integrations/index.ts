/**
 * 采集插件统一出口
 *
 * 全部做成「工厂函数」而不是直接导出对象，是为了让调用方能传参数，
 * 也让插件实例之间互不共享状态（同一页面挂两次也不会互相干扰）。
 *
 * 之所以每个插件独立导出、不打包成一个 default 集合：
 * 这样业务方可以只 import 用到的插件，配合 sideEffects: false，
 * 没用到的插件会被 tree-shaking 完整摇掉，这才是守得住 8KB 预算的做法。
 */
export { errorsIntegration } from './errors';
export type { ErrorsIntegrationOptions } from './errors';
export { webVitalsIntegration } from './webVitals';
export { networkIntegration } from './network';
export { breadcrumbsIntegration } from './breadcrumbs';
