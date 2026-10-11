import { useEffect, useRef, useState } from 'react';
import { getTools, type ToolDef } from '../../store/tools';
import { listSkills, readSkillFile } from '../../store/skills';
import type { AgentConfig, SkillMeta } from '../../types';
import { getDefaultSkillSelection, getInitialToolSelection } from './agent-tool-selection';
import { normalizeCapabilitySelection } from './agent-capability-groups';

export function useToolSelection(config: AgentConfig | undefined, isCreate: boolean, toolsTabOpen: boolean) {
  const initial = useRef({ names: config?.tools ?? [], mode: config?.toolMode, isCreate });
  const initialized = useRef(false);
  const [allTools, setAllTools] = useState<ToolDef[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [checkedTools, setCheckedTools] = useState<Set<string>>(
    () => new Set(config?.tools ?? []),
  );

  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      getTools().then(tools => {
        if (!active || current !== request) return;
        setAllTools(tools);
        setCatalogError('');
        if (initialized.current) return;
        initialized.current = true;
        const seed = initial.current;
        setCheckedTools(normalizeCapabilitySelection(tools,
          getInitialToolSelection(tools, seed.names, seed.mode, seed.isCreate)));
      }).catch(error => {
        if (active && current === request) {
          setCatalogError(error instanceof Error ? error.message : String(error));
        }
      });
    };
    refresh();
    if (toolsTabOpen) {
      window.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', refreshOnVisible);
    }
    function refreshOnVisible() { if (!document.hidden) refresh(); }
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshOnVisible);
    };
  }, [toolsTabOpen]);

  return { allTools, checkedTools, setCheckedTools, catalogError };
}

export function useSkillSelection(config: AgentConfig | undefined, isCreate: boolean) {
  const initial = useRef({ ids: config?.skills ?? [], isCreate });
  const [allSkills, setAllSkills] = useState<SkillMeta[]>([]);
  const [checkedSkills, setCheckedSkills] = useState<Set<string>>(
    () => new Set(config?.skills ?? []),
  );
  const [skillPreviews, setSkillPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    listSkills().then(skills => {
      if (!active) return;
      setAllSkills(skills);
      const seed = initial.current;
      setCheckedSkills(getDefaultSkillSelection(skills, seed.ids, seed.isCreate));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const ids = [...checkedSkills];
    if (ids.length === 0) return;
    Promise.all(ids.map(async id => ({
      id,
      content: await readSkillFile(id, 'SKILL.md') || '(空)',
    }))).then(results => setSkillPreviews(Object.fromEntries(
      results.map(result => [result.id, result.content]),
    )));
  }, [checkedSkills]);

  return { allSkills, checkedSkills, setCheckedSkills, skillPreviews };
}
