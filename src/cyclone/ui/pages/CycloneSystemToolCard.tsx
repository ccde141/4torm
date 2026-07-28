import { useState } from 'react';
import type { DisplayBlock } from './messageDisplay';
import type { CycloneDispatch } from './dispatch-timeline';
import { describeCycloneSystemTool } from './cyclone-system-tool';
import './cyclone-system-tool.css';

type ToolBlock = Extract<DisplayBlock, { kind: 'tool' }>;

export default function CycloneSystemToolCard({ block, dispatches }: {
  block: ToolBlock;
  dispatches: CycloneDispatch[];
}) {
  const [expanded, setExpanded] = useState(false);
  const detail = describeCycloneSystemTool({
    tool: block.tool, args: block.args, result: block.result,
    status: block.status, dispatches,
  });
  if (!detail) return null;

  const icon = detail.status === 'success' ? '✓'
    : detail.status === 'error' ? '✕'
      : detail.status === 'cancelled' ? '–' : '◌';

  return (
    <div className="chat__message chat__message--assistant chat__message--tool cyclone-system-tool"
      data-status={detail.status}>
      <div className="chat__bubble cyclone-system-tool__bubble">
        <button type="button" className="cyclone-system-tool__trigger"
          aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          <span className="cyclone-system-tool__icon">{icon}</span>
          <span className="cyclone-system-tool__title">{detail.title}</span>
          <span className="cyclone-system-tool__state">{detail.state}</span>
          <span className={`cyclone-system-tool__arrow${expanded ? ' cyclone-system-tool__arrow--open' : ''}`}>▶</span>
        </button>
        {!expanded && detail.preview && <div className="cyclone-system-tool__preview">{detail.preview}</div>}
        {expanded && (
          <div className="cyclone-system-tool__body">
            {Object.keys(block.args).length > 0 && <ToolDetail label="参数" value={JSON.stringify(block.args, null, 2)} />}
            {block.result && <ToolDetail label={detail.status === 'error' ? '错误' : '结果'} value={block.result} />}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolDetail({ label, value }: { label: string; value: string }) {
  return (
    <section className="cyclone-system-tool__detail">
      <div>{label}</div>
      <pre>{value}</pre>
    </section>
  );
}
