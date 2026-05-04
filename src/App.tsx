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

import { useState } from 'react';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import ErrorBoundary from './components/layout/ErrorBoundary';
import DashboardPage from './components/agents/DashboardPage';
import ChatPage from './components/chat/ChatPage';
import SettingsPage from './components/layout/SettingsPage';
import ToolsPage from './components/tools/ToolsPage';
import SkillsPage from './components/skills/SkillsPage';
import SandboxPage from './components/sandbox/SandboxPage';
import './styles/index.css';

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  agent:     { title: '智能体', subtitle: '智能体实例管理' },
  chat:      { title: '对话', subtitle: '与 Agent 实时交互' },
  tools:     { title: '工具', subtitle: '全局工具注册与管理' },
  skills:    { title: '技能', subtitle: '管理与安装 Agent 能力包' },
  sandbox:   { title: '风暴沙盒', subtitle: '可视化多 Agent 协作工作流' },
  model:     { title: '模型', subtitle: '模型提供商与 API 配置' },
};

function PageContent({ page, preselectSession, onClearPreselect }: { page: string; preselectSession?: string | null; onClearPreselect?: () => void }) {
  const show = (p: string): React.CSSProperties => ({
    display: page === p ? undefined : 'none',
    height: '100%',
  });
  const scrollArea: React.CSSProperties = { height: '100%', overflowY: 'auto' };

  return (
    <>
      <div style={show('agent')}><div style={scrollArea}><DashboardPage /></div></div>
      <div style={show('chat')}><div style={scrollArea}><ChatPage preselectSession={preselectSession ?? undefined} onClearPreselect={onClearPreselect} /></div></div>
      <div style={show('tools')}><div style={scrollArea}><ToolsPage /></div></div>
      <div style={show('skills')}><div style={scrollArea}><SkillsPage /></div></div>
      <div style={show('sandbox')}><div style={scrollArea}><SandboxPage /></div></div>
      <div style={show('model')}><div style={scrollArea}><SettingsPage /></div></div>
    </>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState('agent');
  const [preselectSession, setPreselectSession] = useState<string | null>(null);
  const pageInfo = PAGE_TITLES[activePage] ?? PAGE_TITLES.agent;

  const handleNavigate = (page: string, sessionId?: string) => {
    setActivePage(page);
    setPreselectSession(sessionId ?? null);
  };

  return (
    <ErrorBoundary>
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
