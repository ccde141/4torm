/**
 * 气旋会长私聊抽屉 —— 每场会议（room）的场外参谋，右侧可折叠抽屉
 *
 * - 会长按会议隔离：私聊落 room.chairMessages，只读本 room 会议快照，换会议不串台（对齐对流）
 * - 贝塞尔曲线动画：外壳宽度走 --ease-out-expo 平滑伸缩，面板淡入 + 轻微回弹滑入（--ease-out-back），不僵硬
 * - 头部 <select> 设置/更换/清空会长（工作室级 chairAgentId，对齐对流配置栏）
 * - 已设会长 → 内嵌 SeatChat（纯文本私聊，端点指向本 room 的 chair）；未设 → 引导选会长
 * - 流按 roomId 独立键（__chair__:roomId），切会议不串台
 */

import type { Agent } from '../../../types';
import SeatChat from './SeatChat';
import type { SeatStreamRunners } from './useSeatStreamRunners';

/** 会长流在注册表里的键（按会议/room 隔离，避免跨会议串台） */
export function chairStreamKey(roomId: string): string {
  return `__chair__:${roomId}`;
}

/** 会长端点前缀（按会议/room 隔离） */
function chairBaseUrl(workshopId: string, roomId: string): string {
  return `/api/cyclone/workshop/${workshopId}/room/${roomId}/chair`;
}

const PANEL_W = 360;
const TAB_W = 34;

export default function ChairDrawer({
  workshopId, roomId, roomTitle, chairAgentId, agents, runners, open, onToggle, onSetChair, onReloaded,
}: {
  workshopId: string;
  roomId: string;
  roomTitle?: string;
  chairAgentId: string | null;
  agents: Agent[];
  runners: SeatStreamRunners;
  open: boolean;
  onToggle: () => void;
  onSetChair: (agentId: string) => void;
  onReloaded?: () => void;
}) {
  const chairName = chairAgentId ? (agents.find(a => a.id === chairAgentId)?.name ?? chairAgentId) : '';

  return (
    <div style={{ ...wrapperStyle, width: open ? PANEL_W : TAB_W }}>
      {/* 收起态竖条 tab：展开时淡出并让出点击 */}
      <button
        onClick={onToggle}
        title="展开会长私聊"
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        style={{ ...tabStyle, opacity: open ? 0 : 1, pointerEvents: open ? 'none' : 'auto' }}
      >
        <span style={{ writingMode: 'vertical-rl', letterSpacing: '0.15em' }}>会长 · 参谋</span>
      </button>

      {/* 展开态面板：右锚定固定宽度，随外壳揭开 + 淡入 + 轻微回弹滑入 */}
      <div
        aria-hidden={!open}
        style={{
          ...panelStyle,
          opacity: open ? 1 : 0,
          transform: open ? 'translateX(0)' : `translateX(16px)`,
          pointerEvents: open ? 'auto' : 'none',
          boxShadow: open ? '-8px 0 24px -12px rgba(0,0,0,0.35)' : 'none',
        }}
      >
        <div style={headerStyle}>
          <span
            style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={roomTitle ? `会长 · ${roomTitle}` : '会长'}
          >
            会长{chairName ? ` · ${chairName}` : ''}
          </span>
          <div style={{ flex: 1 }} />
          <select
            value={chairAgentId ?? ''}
            onChange={e => onSetChair(e.target.value)}
            style={selectStyle}
            title="设置 / 更换 / 清空会长"
          >
            <option value="">未设会长</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button onClick={onToggle} style={collapseBtnStyle} title="收起">×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {chairAgentId ? (
            <SeatChat
              key={chairStreamKey(roomId)}
              workshopId={workshopId}
              seatId={chairStreamKey(roomId)}
              chairBase={chairBaseUrl(workshopId, roomId)}
              runners={runners}
              onReloaded={onReloaded}
            />
          ) : (
            <div style={{ margin: 'auto', padding: 'var(--space-5)', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
              从上方选择一个 agent 作为会长。<br />
              会长不进群聊，<br />只在这里和你单独私聊，<br />俯瞰这场会议的快照给你出主意。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 外壳：宽度在 TAB_W↔PANEL_W 间用 ease-out-expo 平滑伸缩，overflow 裁掉未揭开的面板 */
const wrapperStyle: React.CSSProperties = {
  position: 'relative',
  flexShrink: 0,
  height: '100%',
  overflow: 'hidden',
  borderLeft: '1px solid var(--border-color)',
  background: 'var(--color-bg)',
  transition: 'width var(--duration-slow) var(--ease-out-expo)',
};
/** 收起态竖条 tab：绝对定位贴右缘，不参与外壳宽度 */
const tabStyle: React.CSSProperties = {
  position: 'absolute', top: 0, right: 0, bottom: 0, width: TAB_W,
  background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 'var(--text-sm)', border: 'none',
  transition: 'opacity var(--duration-normal) var(--ease-out-expo)',
};
/** 展开态面板：右锚定固定宽度，淡入用 expo、滑入用 back（轻微回弹的「弹出」感） */
const panelStyle: React.CSSProperties = {
  position: 'absolute', top: 0, right: 0, height: '100%', width: PANEL_W,
  display: 'flex', flexDirection: 'column', minWidth: 0,
  background: 'var(--color-bg)',
  transition: 'opacity var(--duration-normal) var(--ease-out-expo), transform var(--duration-spring) var(--ease-out-back)',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
  padding: 'var(--space-2) var(--space-3)', borderBottom: '1px solid var(--border-color)',
  flexShrink: 0,
};
const selectStyle: React.CSSProperties = {
  maxWidth: 130, fontSize: 'var(--text-xs)', padding: '2px 4px',
  background: 'var(--color-surface)', color: 'var(--color-text-secondary)',
  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
};
const collapseBtnStyle: React.CSSProperties = {
  width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', color: 'var(--color-text-tertiary)', border: 'none',
  borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-md)', cursor: 'pointer', lineHeight: 1, flexShrink: 0,
};
