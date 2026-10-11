import { useCallback, useEffect, useState } from 'react';
import { getAllModels } from '../../llm';
import { getAgents, getOfflineAgentIds } from '../../store/agent';
import { AGENTS_CHANGED_EVENT } from '../../store/agent-events';
import type { Agent } from '../../types';

export function useMonsoonCatalog(active: boolean, selectedAgent: Agent | null,
  setSelectedAgent: (agent: Agent | null) => void) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<{ key: string; label: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState('');

  const refreshAgents = useCallback(async () => {
    const list = await getAgents();
    setAgents(list);
    setOfflineIds(await getOfflineAgentIds(list));
  }, []);
  const refreshModels = useCallback(async () => {
    const list = await getAllModels();
    setModels(list);
    setSelectedModel(previous => list.length && !list.some(model => model.key === previous)
      ? list[0]!.key : previous);
  }, []);

  useEffect(() => { void refreshModels(); }, [refreshModels]);
  useEffect(() => { if (active) void refreshModels(); }, [active, refreshModels]);
  useEffect(() => {
    if (!active) return;
    void refreshAgents();
    const changed = () => { void refreshAgents(); };
    window.addEventListener(AGENTS_CHANGED_EVENT, changed);
    const timer = setInterval(changed, 2000);
    return () => { clearInterval(timer); window.removeEventListener(AGENTS_CHANGED_EVENT, changed); };
  }, [active, refreshAgents]);
  useEffect(() => {
    if (!selectedAgent) return;
    const fresh = agents.find(agent => agent.id === selectedAgent.id);
    if (fresh?.model !== selectedAgent.model && fresh?.model
      && models.some(model => model.key === fresh.model)) {
      setSelectedAgent(fresh); setSelectedModel(fresh.model);
    }
  }, [agents, selectedAgent, models, setSelectedAgent]);

  return { agents, offlineIds, models, selectedModel, setSelectedModel, refreshAgents };
}
