import { useState } from 'react';
import { usePrismEvents } from './hooks';
import { Errors, Network, Overview, Performance } from './views';
import { exportCompressedReport } from '@prism/core';

type Tab = 'overview' | 'errors' | 'performance' | 'network';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'errors', label: '错误' },
  { key: 'performance', label: '性能' },
  { key: 'network', label: '网络' },
];

/**
 * 模板里的占位符，构建时写死在 report-template.html 中，导出时替换成真实数据。
 *
 * 必须写成完整的赋值语句而不是只写 `/*__PRISM_DATA__*\/null`：
 * 这个字符串同时作为常量存在于打包后的 bundle 里，只匹配片段的话
 * 会误把 bundle 内部的常量也替换掉，直接破坏代码。
 */
const DATA_PLACEHOLDER = 'window.__PRISM_PAYLOAD__=/*__PRISM_DATA__*/null';

export default function App(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('overview');
  const { events, loading, fromReport, reload } = usePrismEvents();
  const [exporting, setExporting] = useState(false);
  const [exportInfo, setExportInfo] = useState<string | null>(null);

  /**
   * 导出单文件离线报告 —— 这是整个项目的杀手锏功能。
   *
   * 做法是「模板 + 数据」：模板里已经内联了看板运行时的 JS 与样式，
   * 导出时只要把压缩后的数据填进占位符，产出的就是一个
   * 不需要服务器、不需要联网、双击即可查看的完整 HTML 文件。
   */
  const handleExport = async (): Promise<void> => {
    setExporting(true);
    setExportInfo(null);
    try {
      const { payload, rawBytes, compressedBytes } = await exportCompressedReport();

      const template = await fetch('./report-template.html').then((r) => r.text());
      if (!template.includes(DATA_PLACEHOLDER)) {
        throw new Error('报告模板里找不到数据占位符，请重新执行 npm run build');
      }
      // 用 JSON.stringify 生成带引号的字符串字面量，避免数据里的引号破坏 JS 语法。
      // 替换值用函数形式：String.replace 会把字符串里的 $&、$' 当成特殊替换模式
      const html = template.replace(
        DATA_PLACEHOLDER,
        () => `window.__PRISM_PAYLOAD__=${JSON.stringify(payload)}`,
      );

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prism-report-${new Date().toISOString().slice(0, 10)}.html`;
      a.click();
      URL.revokeObjectURL(url);

      const saved = rawBytes > 0 ? ((1 - compressedBytes / rawBytes) * 100).toFixed(1) : '0';
      setExportInfo(
        `已导出 ${(html.length / 1024).toFixed(0)}KB 的离线报告；数据压缩省了 ${saved}%`,
      );
    } catch (error) {
      setExportInfo(`导出失败：${error instanceof Error ? error.message : error}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <span className="dot" />
          Prism
        </div>
        <div className="nav">
          {TABS.map((item) => (
            <button
              key={item.key}
              className={tab === item.key ? 'on' : ''}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        {fromReport ? (
          <span style={{ fontSize: 12, color: '#6b7280' }}>离线报告模式</span>
        ) : (
          <button className="btn" onClick={reload}>
            刷新
          </button>
        )}
        <button
          className="btn primary"
          onClick={handleExport}
          disabled={exporting || fromReport || events.length === 0}
        >
          {exporting ? '导出中…' : '导出离线报告'}
        </button>
      </div>

      {exportInfo ? (
        <div style={{ padding: '10px 28px', fontSize: 13, color: '#0f6e56' }}>{exportInfo}</div>
      ) : null}

      {fromReport ? (
        <div style={{ padding: '0 28px', fontSize: 13, color: '#6b7280' }}>
          当前展示的是报告文件里内嵌的数据，与本机 IndexedDB 无关。
        </div>
      ) : null}

      <div className="wrap">
        {loading ? (
          <div className="empty">正在读取数据…</div>
        ) : events.length === 0 ? (
          <div className="empty">
            本地还没有数据。先在你的页面里接入 SDK：
            <br />
            <code>{'<script src="/dist/index.global.js"></script>'}</code>
            <br />
            <code>Prism.init({"{ release: '1.0.0' }"})</code>
          </div>
        ) : tab === 'overview' ? (
          <Overview events={events} />
        ) : tab === 'errors' ? (
          <Errors events={events} />
        ) : tab === 'performance' ? (
          <Performance events={events} />
        ) : (
          <Network events={events} />
        )}
      </div>
    </>
  );
}
