import { createRoot } from 'react-dom/client';
import App from './App';

/**
 * 看板入口。
 * 判空而不是用非空断言：这个 JS 可能被嵌进导出的报告 HTML 里，
 * 万一容器 id 对不上，静默失败也好过抛一个满屏的报错。
 */
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
