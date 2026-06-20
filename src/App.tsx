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
 *  所有数据请求集中在 src/api/service.ts
 *  修改 VITE_API_URL 环境变量即可切换真实 API
 * ============================================================
 */

import { useState, useEffect, useRef } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import ErrorBoundary from './components/layout/ErrorBoundary';
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
import { getSkinConfig, loadSkinConfig, subscribeSkin, type SkinConfig } from './store/skin';
import './styles/index.css';

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  agent:     { title: '控制台', subtitle: 'Agent实例管理' },
  chat:      { title: '季风', subtitle: '与Agent信息交互' },
  tools:     { title: '工具', subtitle: '全局工具注册与管理' },
  skills:    { title: '技能', subtitle: '管理与安装 Agent 能力包' },
  convection: { title: '对流', subtitle: '多 Agent 持续协作会话' },
  cyclone:   { title: '气旋', subtitle: '团队工作室：工位私聊与协作' },
  tradewind: { title: '信风', subtitle: '多 Agent 协作工作流' },
  tide:      { title: '潮汐', subtitle: '定时自动化任务' },
  model:     { title: '模型', subtitle: '模型提供商与 API 配置' },
  mcp:       { title: 'MCP', subtitle: '外部工具服务管理' },
};

function PageContent({ page, preselectSession, onClearPreselect }: { page: string; preselectSession?: string | null; onClearPreselect?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevPageRef = useRef(page);

  // page 变化时，对新激活的面板重触发 animation
  useEffect(() => {
    if (page === prevPageRef.current) return;
    prevPageRef.current = page;
    const container = containerRef.current;
    if (!container) return;
    const active = container.querySelector(`.page-panel[data-page="${page}"]`) as HTMLElement | null;
    if (!active) return;
    active.classList.remove('page-panel--enter');
    void active.offsetWidth; // force reflow
    active.classList.add('page-panel--enter');
  }, [page]);

  const show = (p: string): React.CSSProperties => ({
    display: page === p ? undefined : 'none',
    height: '100%',
  });
  const scrollArea: React.CSSProperties = { height: '100%', overflowY: 'auto' };

  return (
    <div ref={containerRef} style={{ height: '100%' }}>
      <div className="page-panel" data-page="agent" style={show('agent')}><div style={scrollArea}><DashboardPage active={page === 'agent'} /></div></div>
      <div className="page-panel" data-page="chat" style={show('chat')}><div style={scrollArea}><ChatPage active={page === 'chat'} preselectSession={preselectSession ?? undefined} onClearPreselect={onClearPreselect} /></div></div>
      <div className="page-panel" data-page="tools" style={show('tools')}><div style={scrollArea}><ToolsPage /></div></div>
      <div className="page-panel" data-page="skills" style={show('skills')}><div style={scrollArea}><SkillsPage /></div></div>
      <div className="page-panel" data-page="convection" style={show('convection')}><div style={scrollArea}><ConvectionPage active={page === 'convection'} /></div></div>
      <div className="page-panel" data-page="cyclone" style={show('cyclone')}><div style={scrollArea}><CyclonePage active={page === 'cyclone'} /></div></div>
      <div className="page-panel" data-page="tradewind" style={show('tradewind')}><div style={scrollArea}><TradeWindPage /></div></div>
      <div className="page-panel" data-page="tide" style={show('tide')}><div style={scrollArea}><TidePage active={page === 'tide'} /></div></div>
      <div className="page-panel" data-page="model" style={show('model')}><div style={scrollArea}><SettingsPage /></div></div>
      <div className="page-panel" data-page="mcp" style={show('mcp')}><div style={scrollArea}><McpPage /></div></div>
    </div>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState('agent');
  const [preselectSession, setPreselectSession] = useState<string | null>(null);
  const [skin, setSkin] = useState<SkinConfig>(getSkinConfig());
  const pageInfo = PAGE_TITLES[activePage] ?? PAGE_TITLES.agent;

  // 启动时加载皮肤配置 + 订阅变更
  useEffect(() => {
    loadSkinConfig().then(setSkin);
    return subscribeSkin(setSkin);
  }, []);

  const handleNavigate = (page: string, sessionId?: string) => {
    setActivePage(page);
    setPreselectSession(sessionId ?? null);
  };

  const bgType = skin.background?.type ?? 'none';
  const contourParams = skin.background?.contour;
  const windParams = skin.background?.wind;

  return (
    <ErrorBoundary>
      {bgType === 'contour' && contourParams && (
        <ContourBackground params={contourParams} />
      )}
      {bgType === 'wind' && windParams && (
        <WindBackground params={windParams} />
      )}
      <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
        <Sidebar activePage={activePage} onNavigate={setActivePage} />
        <div className="main-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <Header title={pageInfo.title} subtitle={pageInfo.subtitle} onNavigate={handleNavigate} />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <PageContent page={activePage} preselectSession={preselectSession} onClearPreselect={() => setPreselectSession(null)} />
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
