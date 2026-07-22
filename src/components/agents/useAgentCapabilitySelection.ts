import { useEffect, useRef, useState } from 'react';
import { getTools, seedTools, type ToolDef } from '../../store/tools';
import { listSkills, readSkillFile } from '../../store/skills';
import type { AgentConfig, SkillMeta } from '../../types';
import { getDefaultSkillSelection, getInitialToolSelection } from './agent-tool-selection';

export function useToolSelection(config: AgentConfig | undefined, isCreate: boolean) {
  const initial = useRef({ names: config?.tools ?? [], mode: config?.toolMode, isCreate });
  const [allTools, setAllTools] = useState<ToolDef[]>([]);
  const [checkedTools, setCheckedTools] = useState<Set<string>>(
    () => new Set(config?.tools ?? []),
  );

  useEffect(() => {
    let active = true;
    seedTools().then(() => getTools()).then(tools => {
      if (!active) return;
      setAllTools(tools);
      const seed = initial.current;
      setCheckedTools(getInitialToolSelection(tools, seed.names, seed.mode, seed.isCreate));
    });
    return () => { active = false; };
  }, []);

  return { allTools, checkedTools, setCheckedTools };
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
