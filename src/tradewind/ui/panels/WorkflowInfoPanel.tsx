/**
 * 信风工作流信息侧板
 *
 * 采用与季风任务板 / 气旋会长条 / 对流一致的「右缘竖条 rail + 玻璃抽屉 drawer」样式：
 * - 收起态：右缘常驻竖标签「工作流 · 进度」，运行中发光；点击展开。
 * - 展开态：玻璃抽屉覆盖右侧，左缘可拖宽，右上「收起 ›」。
 *
 * 数据：一条 unified /stream（subscribeAll）聚合全部节点事件，实时展现
 *       节点进度 + 当前信封（条目增删）+ 交接/最终产出。
 * 生命周期：开始新一轮清空、结束冻结保留（配合 TradeWindPage 封存逻辑）。零流成本（静态后流关，state 留存）。
 */

import { useEffect, useRef, useState } from 'react';
import { subscribeAll, unsubscribeAll } from '../stream/unified-client';

interface NodeRef { id: string; label: string }
interface Info { envelope?: string; answer?: string }

interface Props {
  nodes: NodeRef[];
  outputSourceId: string | null;
  running: boolean;
  sessionEnded: boolean;
  /** 循环模式下当前第几圈（1 起）；非循环运行为 null → 不显示圈数 */
  lap: number | null;
}

const RAIL_W = 42;
const MIN_W = 280, MAX_W = 620, DEFAULT_W = 360;

export function WorkflowInfoPanel({ nodes, outputSourceId, running, sessionEnded, lap }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [width, setWidth] = useState(() => {
    const s = Number(localStorage.getItem('tw-info.width'));
    return s >= MIN_W && s <= MAX_W ? s : DEFAULT_W;
  });
  const widthRef = useRef(width);
  useEffect(() => { widthRef.current = width; }, [width]);

  const [info, setInfo] = useState<Record<string, Info>>({});
  const [status, setStatus] = useState<Record<string, { busy: boolean; envelopePending: boolean }>>({});

  // 一条 unified /stream 收全部节点事件 → 每节点最新信封 / 产出
  useEffect(() => {
    const handler = (ev: any) => {
      const id = ev?.nodeId;
      if (!id) return;
      if (ev.type === 'tool-result' && typeof ev.tool === 'string' && ev.tool.startsWith('envelope')) {
        setInfo(prev => ({ ...prev, [id]: { ...prev[id], envelope: String(ev.result ?? '') } }));
      } else if (ev.type === 'answer') {
        setInfo(prev => ({ ...prev, [id]: { ...prev[id], answer: String(ev.rawContent || ev.content || '') } }));
      }
    };
    subscribeAll(handler);
    return () => unsubscribeAll(handler);
  }, []);

  useEffect(() => {
    const h = () => setStatus({ ...((window as any).__tw_node_status || {}) });
    window.addEventListener('tw-node-status', h);
    h();
    return () => window.removeEventListener('tw-node-status', h);
  }, []);

  // 开始新一轮清空（结束不清 → 冻结保留）
  const prevRunning = useRef(false);
  useEffect(() => {
    if (!prevRunning.current && running) setInfo({});
    prevRunning.current = running;
  }, [running]);

  const total = nodes.length;
  const doneCount = nodes.filter(n => info[n.id]?.answer).length;
  const glow = running && !expanded;

  const badge = (id: string) => {
    const s = status[id];
    if (s?.busy) return { text: '进行中', color: 'var(--color-accent)' };
    if (s?.envelopePending) return { text: '待接收', color: 'var(--color-warning)' };
    if (info[id]?.answer) return { text: '已完成', color: 'var(--color-success)' };
    return { text: '空闲', color: 'var(--color-text-tertiary)' };
  };
  const curEnvelope = (id: string) => {
    const e = info[id]?.envelope;
    if (!e) return null;
    return e.split('当前信封：')[1]?.trim() || e;
  };
  const finalOutput = outputSourceId ? info[outputSourceId]?.answer : undefined;

  // ── 收起态：右缘凸出竖标签 ──
  if (!expanded) {
    return (
      <div className="mo-enter-fade" style={railWrapStyle} onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
        <button onClick={() => setExpanded(true)} title="工作流信息：节点进度 / 当前信封 / 最终产出"
          className={glow ? 'tw-info-rail--glow' : undefined} style={railBtnStyle}>
          {glow && <span style={dotStyle} />}
          <span style={{ fontSize: '16px', lineHeight: 1 }}>📊</span>
          <span style={railLabelStyle}>工作流 · 进度</span>
          {total > 0 && <span style={railCountStyle}>{doneCount}/{total}</span>}
        </button>
        {hovering && (
          <div style={hintStyle}>工作流信息 · 节点进度 / 信封 / 产出{total > 0 ? ` · ${doneCount}/${total}` : ''}</div>
        )}
      </div>
    );
  }

  // ── 展开态：抽屉 ──
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = widthRef.current;
    const move = (ev: MouseEvent) => setWidth(Math.min(MAX_W, Math.max(MIN_W, startW + (startX - ev.clientX))));
    const up = () => {
      try { localStorage.setItem('tw-info.width', String(widthRef.current)); } catch { /* ignore */ }
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  return (
    <div className="tw-info-drawer mo-slide-in-right" style={{ ...drawerStyle, width }}>
      <div onMouseDown={onDragStart} style={dragHandleStyle} title="拖动调整宽度" />
      <div style={headerStyle}>
        <span style={{ fontSize: '14px' }}>📊</span>
        <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>工作流信息</span>
        <span style={{ fontSize: 'var(--text-xs)', color: running ? 'var(--color-success)' : sessionEnded ? 'var(--color-warning)' : 'var(--color-text-tertiary)' }}>
          {running ? '● 执行中' : sessionEnded ? '已结束·只读' : '就绪'}
        </span>
        {lap !== null && (
          <span
            style={{
              fontSize: 'var(--text-xs)', fontWeight: 'var(--font-semibold)',
              color: 'var(--color-accent, #6366f1)', padding: '1px 6px',
              borderRadius: '4px', background: 'var(--color-accent-soft, rgba(99,102,241,0.12))',
            }}
            title="循环运行：当前圈数"
          >第 {lap} 圈</span>
        )}
        <button onClick={() => setExpanded(false)} style={actionBtnStyle} title="收起">收起 ›</button>
      </div>

      <div style={bodyStyle}>
        <div style={sectionTitleStyle}>节点进度</div>
        {total === 0 && <div style={emptyStyle}>（无 Agent 节点）</div>}
        <div className="mo-stagger" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {nodes.map(n => {
            const b = badge(n.id);
            const env = curEnvelope(n.id);
            const ans = info[n.id]?.answer;
            return (
              <div key={n.id} style={nodeCardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)' }}>{n.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: '11px', padding: '1px 8px', borderRadius: 'var(--radius-full)', border: `1px solid ${b.color}`, color: b.color }}>{b.text}</span>
                </div>
                {env && (
                  <details style={{ marginTop: 'var(--space-2)' }}>
                    <summary style={summaryStyle}>当前信封</summary>
                    <pre style={preStyle}>{env}</pre>
                  </details>
                )}
                {ans && (
                  <details style={{ marginTop: 'var(--space-2)' }}>
                    <summary style={summaryStyle}>交接产出</summary>
                    <pre style={preStyle}>{ans}</pre>
                  </details>
                )}
              </div>
            );
          })}
        </div>
        {finalOutput && (
          <>
            <div style={sectionTitleStyle}>最终产出</div>
            <pre style={preStyle}>{finalOutput}</pre>
          </>
        )}
      </div>
    </div>
  );
}

// ── 样式（对齐季风任务板 TaskBoardDrawer 的 rail/drawer 结构） ──
const railWrapStyle: React.CSSProperties = { position: 'absolute', right: 0, top: 0, bottom: 0, width: RAIL_W, zIndex: 4, display: 'flex' };
const railBtnStyle: React.CSSProperties = { position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 'var(--space-2)', padding: 'var(--space-3) 0', appearance: 'none', border: '1px solid var(--glass-border)', borderRight: 'none', borderTopLeftRadius: 'var(--radius-md)', borderBottomLeftRadius: 'var(--radius-md)', background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', cursor: 'pointer', boxShadow: '-4px 0 16px -10px rgba(0,0,0,0.35)' };
const railLabelStyle: React.CSSProperties = { writingMode: 'vertical-rl', letterSpacing: '0.2em', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-secondary)', textShadow: 'var(--text-halo)' };
const railCountStyle: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: 'auto' };
const dotStyle: React.CSSProperties = { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: '0 0 6px var(--color-accent-glow)' };
const hintStyle: React.CSSProperties = { position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 'var(--space-2)', whiteSpace: 'nowrap', padding: 'var(--space-1) var(--space-3)', background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', boxShadow: 'var(--glass-shadow)', pointerEvents: 'none', zIndex: 6 };
const drawerStyle: React.CSSProperties = { position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: 5, display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--glass-border)', background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', boxShadow: '-8px 0 28px -12px rgba(0,0,0,0.45)' };
const dragHandleStyle: React.CSSProperties = { position: 'absolute', left: -3, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 1 };
const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--glass-border)' };
const actionBtnStyle: React.CSSProperties = { marginLeft: 'auto', height: 24, display: 'flex', alignItems: 'center', gap: 3, padding: '0 var(--space-2)', appearance: 'none', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' };
const bodyStyle: React.CSSProperties = { flex: 1, overflowY: 'auto', padding: 'var(--space-3)' };
const sectionTitleStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', margin: 'var(--space-3) 0 var(--space-2)' };
const emptyStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' };
const nodeCardStyle: React.CSSProperties = { border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) var(--space-3)' };
const summaryStyle: React.CSSProperties = { cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' };
const preStyle: React.CSSProperties = { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 'var(--text-xs)', lineHeight: 1.5, background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)', margin: 'var(--space-1) 0 0', maxHeight: 280, overflowY: 'auto' };
