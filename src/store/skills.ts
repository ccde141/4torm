import { readJson, readText, writeJson, writeText, deleteFile, ensureDir } from '../api/storage';
import type { SkillMeta } from '../types';

let cache: SkillMeta[] | null = null;

export async function listSkills(): Promise<SkillMeta[]> {
  const res = await fetch('/api/skills/list');
  if (!res.ok) throw new Error('获取技能列表失败');
  cache = await res.json();
  return cache!;
}

export async function getSkillMeta(skillId: string): Promise<SkillMeta | null> {
  const all = await listSkills();
  return all.find(s => s.id === skillId) ?? null;
}

export async function readSkillFile(skillId: string, file: string): Promise<string | null> {
  return readText(`skills/${skillId}/${file}`);
}

export async function readSkillToolDefs(skillId: string): Promise<Array<{ name: string; description: string; category: string; dangerous: boolean; parameters: Record<string, unknown>; executorType: string; executorFile?: string; executorTemplate?: string }> | null> {
  return readJson(`skills/${skillId}/tools.json`);
}

export async function createSkill(skillId: string, meta: SkillMeta, skillMd: string): Promise<void> {
  await ensureDir(`skills/${skillId}`);
  await writeJson(`skills/${skillId}/config.json`, meta);
  await writeText(`skills/${skillId}/SKILL.md`, skillMd);
  cache = null;
}

export async function deleteSkill(skillId: string): Promise<void> {
  await deleteFile(`skills/${skillId}`);
  cache = null;
}
