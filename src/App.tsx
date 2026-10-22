/**
 * ============================================================
 *  App — Agent Dashboard
 * ============================================================
 *  主应用组件。负责页面路由（纯前端状态切换）。
 *
 *  页面结构：
 *  ┌─────────────────────────────────────────────┐
 *  │  Sidebar  │  Header                         │
 *  │           │  ┌───────────────────────────┐  │
 *  │  Nav      │  │  Page Content             │  │
 *  │           │  │  (Dashboard/Agents/Chat)  │  │
 *  │  User     │  └───────────────────────────┘  │
 *  └─────────────────────────────────────────────┘
 *
 *  【后端对接说明】
 *  功能区 API 通过 lib/backend-client 共用地址和身份。
 *  默认同源；远程桌面直接载入后端托管的前端。
 * ============================================================
 */

import { useState, useEffect, useRef } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import ErrorBoundary from './components/layout/ErrorBoundary';
import { ConfirmProvider } from './components/common/ConfirmDialog';
import DashboardPage from './components/agents/DashboardPage';
import ChatPage from './components/chat/ChatPage';
import SettingsPage from './components/layout/SettingsPage';
import ToolsPage from './components/tools/ToolsPage';
import SkillsPage from './components/skills/SkillsPage';
import TradeWindPage from './tradewind/ui/pages/TradeWindPage';
import TidePage from './tide/ui/TidePage';
import ConvectionPage from './convection/ui/pages/ConvectionPage';
import CyclonePage from './cyclone/ui/pages/CyclonePage';
import { McpPage } from './components/mcp/McpPage';
import ContourBackground from './components/layout/ContourBackground';
import WindBackground from './components/layout/WindBackground';
import VideoBackground from './components/layout/VideoBackground';
import { getSkinConfig, loadSkinConfig, subscribeSkin, type SkinConfig } from './store/skin';
import { freezeBackground } from './components/layout/bgFreeze';
import { useLocale } from './i18n/LocaleContext';
import type { MessageKey } from './i18n/locale';
import './styles/index.css';

const PAGE_TITLES: Record<string, { title: MessageKey; subtitle: MessageKey }> = {
  agent:     { title: 'page.agent.title', subtitle: 'page.agent.subtitle' },
  chat:      { title: 'page.chat.title', subtitle: 'page.chat.subtitle' },
  tools:     { title: 'page.tools.title', subtitle: 'page.tools.subtitle' },
  skills:    { title: 'page.skills.title', subtitle: 'page.skills.subtitle' },
  convection: { title: 'page.convection.title', subtitle: 'page.convection.subtitle' },
  cyclone:   { title: 'page.cyclone.title', subtitle: 'page.cyclone.subtitle' },
  tradewind: { title: 'page.tradewind.title', subtitle: 'page.tradewind.subtitle' },
  tide:      { title: 'page.tide.title', subtitle: 'page.tide.subtitle' },
  model:     { title: 'page.model.title', subtitle: 'page.model.subtitle' },
  mcp:       { title: 'page.mcp.title', subtitle: 'page.mcp.subtitle' },
};

function PageContent({ page, preselectSession, onClearPreselect, onNavigate }: {
  page: string; preselectSession?: string | null;
  onClearPreselect?: () => void;
  onNavigate: (page: string, targetId?: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevPageRef = useRef(page);

  // page 变化时：先冻住背景 canvas（消除玻璃层每帧重采样），再对新激活面板
  // 重播进场动画。用 rAF 重启动画，避免同步读 offsetWidth 触发强制重排。
  useEffect(() => {
    if (page === prevPageRef.current) return;
    prevPageRef.current = page;
    freezeBackground(); // 覆盖进场时长，动画期间背景静止 → 玻璃层不再逐帧重采样
    const active = containerRef.current?.querySelector(`.page-panel[data-page="${page}"]`) as HTMLElement | null;
    if (!active) return;
    active.classList.remove('page-panel--enter');
    const id = requestAnimationFrame(() => active.classList.add('page-panel--enter'));
    return () => cancelAnimationFrame(id);
  }, [page]);

  const show = (p: string): React.CSSProperties => ({
    display: page === p ? undefined : 'none',
    height: '100%',
  });
  const scrollArea: React.CSSProperties = { height: '100%', overflowY: 'auto' };

  return (
    <div ref={containerRef} style={{ height: '100%' }}>
      <div className="page-panel" data-page="agent" style={show('agent')}><div style={scrollArea}><DashboardPage active={page === 'agent'} onNavigate={onNavigate} /></div></div>
      <div className="page-panel" data-page="chat" style={show('chat')}><div style={scrollArea}><ChatPage active={page === 'chat'} preselectSession={preselectSession ?? undefined} onClearPreselect={onClearPreselect} /></div></div>
      <div className="page-panel" data-page="tools" style={show('tools')}><div style={scrollArea}><ToolsPage active={page === 'tools'} /></div></div>
      <div className="page-panel" data-page="skills" style={show('skills')}><div style={scrollArea}><SkillsPage active={page === 'skills'} /></div></div>
      <div className="page-panel" data-page="convection" style={show('convection')}><div style={scrollArea}><ConvectionPage active={page === 'convection'} onNavigate={onNavigate} preselectSession={page === 'convection' ? preselectSession : null} onClearPreselect={onClearPreselect} /></div></div>
      <div className="page-panel" data-page="cyclone" style={show('cyclone')}><div style={scrollArea}><CyclonePage active={page === 'cyclone'} preselectOperation={page === 'cyclone' ? preselectSession : null} onClearPreselect={onClearPreselect} /></div></div>
      <div className="page-panel" data-page="tradewind" style={show('tradewind')}><div style={scrollArea}><TradeWindPage /></div></div>
      <div className="page-panel" data-page="tide" style={show('tide')}><div style={scrollArea}><TidePage active={page === 'tide'} preselectTask={page === 'tide' ? preselectSession : null} onClearPreselect={onClearPreselect} /></div></div>
      <div className="page-panel" data-page="model" style={show('model')}><div style={scrollArea}><SettingsPage /></div></div>
      <div className="page-panel" data-page="mcp" style={show('mcp')}><div style={scrollArea}><McpPage /></div></div>
    </div>
  );
}

export default function App() {
  const { t } = useLocale();
  const [activePage, setActivePage] = useState('agent');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<{
    page: string; id: string;
  } | null>(null);
  const [skin, setSkin] = useState<SkinConfig>(getSkinConfig());
  const pageInfo = PAGE_TITLES[activePage] ?? PAGE_TITLES.agent;

  // 启动时加载皮肤配置 + 订阅变更
  useEffect(() => {
    loadSkinConfig().then(setSkin);
    return subscribeSkin(setSkin);
  }, []);

  const handleNavigate = (page: string, sessionId?: string) => {
    setActivePage(page);
    setNavigationTarget(sessionId ? { page, id: sessionId } : null);
  };

  const bgType = skin.background?.type ?? 'none';
  const contourParams = skin.background?.contour;
  const windParams = skin.background?.wind;

  return (
    <ErrorBoundary>
      <ConfirmProvider>
      {skin.texture?.layers.includes('video') && skin.texture.video && (
        <VideoBackground params={skin.texture.video} />
      )}
      {bgType === 'contour' && contourParams && (
        <ContourBackground params={contourParams} />
      )}
      {bgType === 'wind' && windParams && (
        <WindBackground params={windParams} />
      )}
      <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
        <Sidebar
          activePage={activePage}
          collapsed={sidebarCollapsed}
          onNavigate={page => { setActivePage(page); setNavigationTarget(null); }}
          onToggle={() => setSidebarCollapsed(value => !value)}
        />
        <div className="main-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <Header title={t(pageInfo.title)} subtitle={t(pageInfo.subtitle)} onNavigate={handleNavigate} />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <PageContent page={activePage}
              preselectSession={navigationTarget?.page === activePage ? navigationTarget.id : null}
              onClearPreselect={() => setNavigationTarget(null)} onNavigate={handleNavigate} />
          </div>
        </div>
      </div>
      </ConfirmProvider>
    </ErrorBoundary>
  );
}
