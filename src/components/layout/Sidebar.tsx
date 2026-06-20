/**
 * ============================================================
 *  Sidebar Component
 * ============================================================
 *  左侧导航栏。包含品牌、导航项、用户信息。
 * ============================================================
 */

import { memo, useState, useEffect } from 'react';
import type { NavItem } from '../../types';
import { getSkinConfig, subscribeSkin, type SkinConfig } from '../../store/skin';
import '../../styles/components/sidebar.css';

const NAV_ITEMS: NavItem[] = [
  { id: 'agent', label: '控制台', icon: 'agents' },
  { id: 'chat', label: '季风  对话', icon: 'chat' },
  { id: 'convection', label: '对流  会议室', icon: 'convection' },
  { id: 'cyclone', label: '气旋  工作室', icon: 'cyclone' },
  { id: 'tradewind', label: '信风  工作流', icon: 'tradewind' },
  { id: 'tide', label: '潮汐  自动化', icon: 'tide' },
];

const CAPABILITY_ITEMS: NavItem[] = [
  { id: 'tools', label: '工具', icon: 'tools' },
  { id: 'skills', label: '技能', icon: 'skills' },
];

const MANAGE_ITEMS: NavItem[] = [
  { id: 'model', label: '模型', icon: 'settings' },
  { id: 'mcp', label: 'MCP', icon: 'mcp' },
];

// SVG icon components (no external deps)
const ICONS: Record<string, React.FC<{ className?: string }>> = {
  dashboard: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  agents: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-7 8-7s8 3 8 7" />
      <circle cx="18" cy="6" r="2.5" />
    </svg>
  ),
  chat: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  // 对流：上升与下沉的循环气流，呼应"多方持续交换"
  convection: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17V7m0 0L4 10m3-3l3 3" />
      <path d="M17 7v10m0 0l3-3m-3 3l-3-3" />
      <path d="M4 12h16" />
    </svg>
  ),
  // 信风：三道平行流动弧线，呼应"风带 + 信件传递"的隐喻
  tradewind: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8 Q 9 5, 14 8 T 21 8" />
      <path d="M3 13 Q 10 10, 16 13 T 21 13" />
      <path d="M3 18 Q 8 15, 13 18 T 19 18" />
    </svg>
  ),
  // 气旋：螺旋气流，呼应"团队围绕一处旋转协作"
  cyclone: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12 m0 0 a3 3 0 1 1 -2.5 -2.9 a5.5 5.5 0 1 1 -4.2 6.8 a8 8 0 1 1 9.7 -9.4" />
    </svg>
  ),
  // 潮汐：波浪线 + 时钟指针，呼应"定时 + 海潮涨落"
  tide: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 18 Q 5 14, 8 18 T 14 18 T 20 18" />
      <circle cx="17" cy="9" r="5" />
      <path d="M17 7v2l1.5 1" />
    </svg>
  ),
  skills: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  tools: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  settings: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  mcp: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  ),
};

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
}

const Sidebar = memo(function Sidebar({ activePage, onNavigate }: SidebarProps) {
  const [skin, setSkin] = useState<SkinConfig>(getSkinConfig());
  useEffect(() => subscribeSkin(setSkin), []);
  const badge = skin.badge;
  const showBadge = badge?.enabled && (badge.text.trim() || badge.subtitle.trim());

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar__brand">
        <div className="sidebar__brand-icon">
          <img className="sidebar__brand-logo" src="/4TORM.png" alt="4torm" />
        </div>
        <span className="sidebar__brand-text">4TORM</span>
      </div>

      {/* Navigation */}
      <nav className="sidebar__nav">
        <div className="sidebar__nav-group">
          <div className="sidebar__nav-label">工作台</div>
          {NAV_ITEMS.map(item => {
            const Icon = ICONS[item.icon];
            return (
              <button
                key={item.id}
                className={`sidebar__nav-item${activePage === item.id ? ' sidebar__nav-item--active' : ''}`}
                onClick={() => onNavigate(item.id)}
                aria-current={activePage === item.id ? 'page' : undefined}
              >
                <Icon className="sidebar__nav-icon" />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span className="sidebar__nav-badge">{item.badge}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="sidebar__nav-group">
          <div className="sidebar__nav-label">能力</div>
          {CAPABILITY_ITEMS.map(item => {
            const Icon = ICONS[item.icon];
            return (
              <button
                key={item.id}
                className={`sidebar__nav-item${activePage === item.id ? ' sidebar__nav-item--active' : ''}`}
                onClick={() => onNavigate(item.id)}
                aria-current={activePage === item.id ? 'page' : undefined}
              >
                <Icon className="sidebar__nav-icon" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="sidebar__nav-group">
          <div className="sidebar__nav-label">配置</div>
          {MANAGE_ITEMS.map(item => {
            const Icon = ICONS[item.icon];
            return (
              <button
                key={item.id}
                className={`sidebar__nav-item${activePage === item.id ? ' sidebar__nav-item--active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                <Icon className="sidebar__nav-icon" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Footer / Links Placeholder */}
      <div className="sidebar__footer">
        <div className="sidebar__links-label">链接</div>
        <div className="sidebar__links">
          <a className="sidebar__link" href="https://github.com/ccde141/4torm/issues" target="_blank" rel="noopener noreferrer" title="Bug 反馈">
            <svg className="sidebar__link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <span>[Bug 反馈]</span>
          </a>
          <a className="sidebar__link" href="https://github.com/ccde141/4torm" target="_blank" rel="noopener noreferrer" title="项目地址">
            <svg className="sidebar__link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
            </svg>
            <span>[项目地址]</span>
          </a>
          <a className="sidebar__link" href="https://space.bilibili.com/406091025" target="_blank" rel="noopener noreferrer" title="个人博客">
            <svg className="sidebar__link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>[B站空间]</span>
          </a>
        </div>

        <div className="sidebar__footer-logo-box">
          <span className="sidebar__footer-logo-placeholder">By Ccde141</span>
        </div>

        {showBadge && (
          <div className="sidebar__badge">
            {badge!.text.trim() && (
              <div className="sidebar__badge-title">{badge!.text}</div>
            )}
            {badge!.subtitle.trim() && (
              <div className="sidebar__badge-subtitle">{badge!.subtitle}</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
});

export default Sidebar;
