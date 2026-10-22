import { Toolbar } from '../panels/Toolbar';
import { ProfilePanel } from '../panels/ProfilePanel';
import { WorkflowSidebar } from '../workspace/WorkflowSidebar';
import { WorkflowRunDock } from '../workspace/WorkflowRunDock';
import { WorkspaceTabs } from '../workspace/WorkspaceTabs';
import { WorkflowEditor } from '../workspace/WorkflowEditor';
import { WorkflowRuntimeView } from '../workspace/WorkflowRuntimeView';
import { WorkflowPanels } from '../workspace/useWorkflowPanels';
import { RecordsPanel } from '../workspace/records/RecordsPanel';
import { useTradeWindWorkspace, type TradeWindWorkspace } from '../workspace/useTradeWindWorkspace';
import { useLocale } from '../../../i18n/LocaleContext';
import { ValidationReport } from '../workspace/ValidationReport';
import '../workspace/workspace.css';
import '../workspace/workspace-layout.css';

export default function TradeWindPage() {
  const model = useTradeWindWorkspace();
  const { store, execution, sync, nav, commands, runView } = model;
  return <div className="tw-page tw-workspace-page">
    <WorkflowRunDock runs={model.runs} selectedId={store.workflowId} onSelect={model.openRun} />
    <div className="tw-workspace-layout">
      {model.sidebarVisible && <WorkflowSidebar items={model.items}
        selectedId={store.workflowId} selectedType={nav.selectedType} supportedTypes={['strict', 'handoff']}
        loading={model.catalog.loading || nav.switching} error={model.catalog.error}
        onSelect={id => void nav.selectWorkflow(id)} onTypeChange={type => void nav.selectType(type)}
        onCreate={type => void commands.create(type)} onDelete={commands.remove} onRefresh={() => void model.catalog.refresh()} />}
      <main className="tw-workspace-main">
        {nav.visible ? <WorkspaceContent model={model} /> : <EmptyMode model={model} />}
      </main>
    </div>
    {nav.visible && <WorkflowPanels key={`${store.workflowId}:${nav.tab === 'design' ? execution.executionId : runView.executionId}`} workflowId={store.workflowId}
      executionId={nav.tab === 'design' ? execution.executionId : runView.executionId}
      sealed={nav.tab === 'design' ? !execution.running : !model.selectedRunLive} />}
    <WorkspaceErrors model={model} />
    {(execution.error || sync.saveError) && <span className="sr-only" role="status">{execution.error || sync.saveError}</span>}
  </div>;
}

function WorkspaceContent({ model }: { model: TradeWindWorkspace }) {
  const { store, execution, sync, commands, nav, runView } = model;
  return <>
    <Toolbar key={store.workflowId} workflowId={store.workflowId} workflowName={store.workflowName} orchestration={store.orchestration}
      activeWorkflowId={execution.workflowId} running={execution.running} phase={execution.phase} saveTime={sync.saveTime}
      saving={store.revisionState.saving} openingWorkspace={sync.openingWorkspace}
      onRun={mode => { runView.latest(); void commands.run(mode); }} onOpenProfiles={() => model.setProfileVisible(true)}
      onStop={() => void execution.stop()} onSave={() => void sync.handleSave()} onOpenWorkspace={() => void sync.handleOpenWorkspace()}
      onSetWorkflowName={store.setWorkflowName} onLoadList={() => model.setSidebarVisible(!model.sidebarVisible)} />
    <WorkspaceTabs value={nav.tab} onChange={tab => nav.selectTab(tab)} />
    <ValidationReport result={commands.validation} onLocate={(nodeId, edgeId) => {
      nav.selectTab('design');
      store.selectNode(nodeId ?? store.edges.find(edge => edge.id === edgeId)?.target ?? null);
    }} />
    <div className="tw-workspace-content">
      <div hidden={nav.tab !== 'design'} className="tw-workspace-design"><WorkflowEditor key={store.workflowId} model={model} /></div>
      {nav.tab === 'run' && <WorkflowRuntimeView key={`runtime:${store.workflowId}`} run={runView.run}
        loading={runView.loading} error={runView.error} live={model.selectedRunLive}
        viewports={model.viewports.current} phase={runView.executionId === execution.executionId ? execution.phase : undefined}
        handoff={runView.executionId === execution.executionId ? execution.handoff : undefined}
        nodes={runView.executionId === execution.executionId ? execution.nodes : {}}
        onRecords={() => nav.selectTab('records')} onLatest={() => runView.latest()} />}
      {nav.tab === 'records' && <RecordsPanel key={`records:${store.workflowId}`} workflowId={store.workflowId} refreshKey={execution.phase}
        initialExecutionId={runView.executionId}
        onOpenRun={run => { runView.select(run); nav.selectTab('run'); }} />}
      <ProfilePanel key={`profiles:${store.workflowId}`} visible={model.profileVisible} workflowId={store.workflowId}
        workflowName={store.workflowName} onClose={() => model.setProfileVisible(false)} onRun={(mode, profile) => {
          model.setProfileVisible(false); runView.latest(); void commands.run(mode, profile);
        }} />
    </div>
  </>;
}

function EmptyMode({ model }: { model: TradeWindWorkspace }) {
  const { locale } = useLocale();
  const hasWorkflows = model.items.some(item => item.workflowType === model.nav.selectedType);
  return <div className="tw-workspace-empty"><p>{hasWorkflows
    ? (locale === 'zh-CN' ? '选择一个工作流，或新建工作流' : 'Select a workflow or create a new one')
    : (locale === 'zh-CN' ? '这个模式还没有工作流' : 'No workflows in this mode')}</p>
    {hasWorkflows && !model.sidebarVisible && <button type="button" onClick={() => model.setSidebarVisible(true)}>
      {locale === 'zh-CN' ? '显示工作流列表' : 'Show workflows'}</button>}
    <button type="button" onClick={() => void model.commands.create(model.nav.selectedType)}>
      {locale === 'zh-CN' ? '新建工作流' : 'Create workflow'}</button></div>;
}

function WorkspaceErrors({ model }: { model: TradeWindWorkspace }) {
  const { sync } = model;
  const error = model.execution.error || sync.saveError || model.nav.error;
  return <>{error && <div className="tw-page__error" role="alert">{error}</div>}
    {model.store.revisionState.conflict && <div className="tw-page__error" role="alert">
      <span>{sync.conflictText} </span>
      <button type="button" onClick={() => void sync.handleReload()}>{sync.reloadLabel}</button>
      <button type="button" onClick={() => void sync.handleSaveCopy()}>{sync.copyLabel}</button>
    </div>}
  </>;
}
