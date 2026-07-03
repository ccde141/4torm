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
    <div style={wrapperStyle}>
      {/* 收起态竖条 tab：常驻细标签，展开时淡出并让出点击 */}
      <button
        onClick={onToggle}
        title="展开会长私聊"
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        style={{ ...tabStyle, opacity: open ? 0 : 1, pointerEvents: open ? 'none' : 'auto' }}
      >
        <span style={{ fontSize: '13px' }}>🗣️</span>
        <span style={{ writingMode: 'vertical-rl', letterSpacing: '0.2em', fontWeight: 'var(--font-semibold)' }}>会长 · 参谋</span>
        <span style={{ writingMode: 'vertical-rl', fontSize: '10px', color: 'var(--color-accent)', marginTop: 'auto' }}>展开‹</span>
      </button>

      {/* 展开态面板：悬浮浮出（绝对定位向左盖在群聊上，不挤占布局），企宣级减速滑入 */}
      <div
        aria-hidden={!open}
        style={{
          ...panelStyle,
          opacity: open ? 1 : 0,
          transform: open ? 'translateX(0) scale(1)' : 'translateX(30px) scale(0.985)',
          pointerEvents: open ? 'auto' : 'none',
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

/** 外壳：固定为细标签宽度，只占 TAB_W；展开面板绝对定位悬浮在它左侧，不撑宽布局 */
const wrapperStyle: React.CSSProperties = {
  position: 'relative',
  flexShrink: 0,
  height: '100%',
  width: TAB_W,
};
/** 收起态竖条 tab：绝对贴右缘，玻璃质感 + 圆角左缘，与季风任务板标签统一 */
const tabStyle: React.CSSProperties = {
  position: 'absolute', top: 0, right: 0, bottom: 0, width: TAB_W, zIndex: 4,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
  gap: 'var(--space-2)', padding: 'var(--space-3) 0',
  background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))',
  color: 'var(--color-text-secondary)', cursor: 'pointer',
  border: '1px solid var(--glass-border)', borderRight: 'none',
  borderTopLeftRadius: 'var(--radius-md)', borderBottomLeftRadius: 'var(--radius-md)',
  boxShadow: '-4px 0 16px -10px rgba(0,0,0,0.35)',
  transition: 'opacity var(--duration-normal) var(--ease-out-expo), background var(--duration-fast) var(--ease-out-expo)',
};
/** 展开态面板：右锚定固定宽度、悬浮盖在群聊上；企宣级强减速滑入（位移 + 极轻缩放） */
const panelStyle: React.CSSProperties = {
  position: 'absolute', top: 0, right: 0, height: '100%', width: PANEL_W, zIndex: 20,
  display: 'flex', flexDirection: 'column', minWidth: 0,
  transformOrigin: 'right center',
  background: 'var(--glass-bg-strong)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))',
  borderLeft: '1px solid var(--glass-border)',
  boxShadow: '-8px 0 28px -12px rgba(0,0,0,0.45)',
  transition: 'opacity var(--duration-normal) var(--ease-out-expo), transform var(--duration-emphasized) var(--ease-emphasized)',
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
