import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MAX_FILES = 128;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const GUIDE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.tsv',
  '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.html', '.css']);
const HELP = `Install an external guide skill into 4torm.

Usage:
  npm run skill:install -- --source <directory-or-SKILL.md> --data-dir <existing-data-directory>

This command preserves SKILL.md and its relative Markdown file links, generates
4torm config.json, and refuses to overwrite an installed skill. Source metadata
is not copied. tools.json, executors/, executable references, symbolic links and
references outside the source directory are not supported. Unreferenced files
are not scanned or copied. It does not run scripts, install dependencies, enable
the skill for an Agent, or grant MCP access.
`;

async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function assertNoLinks(file) {
  const absolute = path.resolve(file);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${current}`);
  }
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function metadata(content, fallback) {
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] ?? '';
  const scalar = key => {
    const value = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(frontmatter)?.[1]?.trim();
    if (!value || /^[|>\[{]/.test(value)) return '';
    if (value.startsWith('"')) { try { return JSON.parse(value).slice(0, 300); } catch { return ''; } }
    return value.replace(/^'(.*)'$/, '$1').slice(0, 300);
  };
  return { name: scalar('name') || /^#\s+(.+)$/m.exec(content)?.[1]?.trim() || fallback,
    description: scalar('description') || 'Imported guide skill',
    category: 'Imported', version: '1.0.0', author: 'Imported' };
}

function skillIdFor(directory, content) {
  const normalized = path.basename(directory).normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return normalized || `skill-${createHash('sha256').update(content).digest('hex').slice(0, 12)}`;
}

function localReferences(content) {
  const destinations = [];
  // Inline/image links and reference-style definitions. No remote requests are made.
  for (const match of content.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^\n]*["'])?\s*\)/g)) {
    destinations.push(match[1] ?? match[2]);
  }
  for (const match of content.matchAll(/^\s*\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|([^\s]+))/gm)) {
    destinations.push(match[1] ?? match[2]);
  }
  return destinations;
}

function referencePath(root, parent, reference) {
  if (!reference || reference.startsWith('#')) return null;
  if (/^(?:[a-z]:|file:)/i.test(reference)) throw new Error(`Absolute file reference is not supported: ${reference}`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith('//')) return null;
  const relative = decodeURIComponent(reference.split(/[?#]/, 1)[0]).replace(/\\/g, '/');
  if (!relative || relative.includes('\0') || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) {
    throw new Error(`Invalid local reference: ${reference}`);
  }
  const resolved = path.resolve(path.dirname(parent), relative);
  if (!inside(root, resolved)) throw new Error(`Reference leaves the skill directory: ${reference}`);
  return resolved;
}

async function collectGuideFiles(root, skillFile) {
  const pending = [skillFile];
  const files = new Map();
  let total = 0;
  while (pending.length) {
    const file = pending.pop();
    const relative = path.relative(root, file);
    if (files.has(relative)) continue;
    if (files.size >= MAX_FILES) throw new Error(`Skill references exceed ${MAX_FILES} files`);
    if (!GUIDE_EXTENSIONS.has(path.extname(file).toLowerCase()) || relative === 'config.json') {
      throw new Error(`Only guide documents and static assets can be imported: ${relative}`);
    }
    await assertNoLinks(file);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error(`A referenced path is not a regular file: ${relative}`);
    if (stat.size > MAX_FILE_BYTES || total + stat.size > MAX_TOTAL_BYTES) throw new Error('Skill guide size limit exceeded');
    const content = await fs.readFile(file);
    // Recheck after reading so a changed source cannot silently introduce a link.
    await assertNoLinks(file);
    if (content.length > MAX_FILE_BYTES || total + content.length > MAX_TOTAL_BYTES) throw new Error('Skill guide size limit exceeded');
    files.set(relative, content);
    total += content.length;
    if (path.extname(file).toLowerCase() === '.md') {
      for (const reference of localReferences(content.toString('utf8'))) {
        const resolved = referencePath(root, file, reference);
        if (resolved) pending.push(resolved);
      }
    }
  }
  return files;
}

function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return null;
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--source', '--data-dir'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Expected --source <directory-or-SKILL.md> --data-dir <existing-data-directory>');
    }
    if (flag in options) throw new Error(`Duplicate option: ${flag}`);
    options[flag] = args[i + 1];
  }
  if (!options['--source'] || !options['--data-dir']) throw new Error('Both --source and --data-dir are required');
  return { source: options['--source'], dataDir: options['--data-dir'] };
}

export async function installGuideSkill({ source, dataDir }) {
  const input = path.resolve(source);
  const data = path.resolve(dataDir);
  await Promise.all([assertNoLinks(input), assertNoLinks(data)]);
  if (!(await fs.stat(data)).isDirectory()) throw new Error('--data-dir must be an existing directory');
  const sourceStat = await fs.stat(input);
  const root = sourceStat.isDirectory() ? input : path.dirname(input);
  const skillFile = sourceStat.isDirectory() ? path.join(root, 'SKILL.md') : input;
  if (path.basename(skillFile) !== 'SKILL.md') throw new Error('--source must be a skill directory or SKILL.md');
  for (const name of ['tools.json', 'executors']) {
    if (await exists(path.join(root, name))) throw new Error(`Guide-only import does not support ${name}; review and install executable tools separately`);
  }
  const files = await collectGuideFiles(root, skillFile);
  const skillBytes = files.get('SKILL.md');
  const id = skillIdFor(root, skillBytes);
  const skills = path.join(data, 'skills');
  await fs.mkdir(skills, { recursive: true });
  await assertNoLinks(skills);
  const target = path.join(skills, id);
  if (await exists(target)) throw new Error(`Skill already exists: ${id}`);
  const lockFile = path.join(skills, `.install-${id}.lock`);
  const lock = await fs.open(lockFile, 'wx');
  let stage;
  try {
    if (await exists(target)) throw new Error(`Skill already exists: ${id}`);
    stage = await fs.mkdtemp(path.join(skills, `.install-${id}-`));
    for (const [relative, content] of files) {
      const output = path.join(stage, relative);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, content, { flag: 'wx' });
    }
    await fs.writeFile(path.join(stage, 'config.json'), JSON.stringify(metadata(skillBytes.toString('utf8'), id), null, 2), { flag: 'wx' });
    await assertNoLinks(skills);
    if (await exists(target)) throw new Error(`Skill already exists: ${id}`);
    await fs.rename(stage, target);
    stage = undefined;
    return { skillId: id, directory: target, files: ['config.json', ...files.keys()] };
  } finally {
    try {
      if (stage) {
        if (path.dirname(path.resolve(stage)) !== skills || !path.basename(stage).startsWith(`.install-${id}-`)) {
          throw new Error('Refused cleanup outside the newly created staging directory');
        }
        await fs.rm(stage, { recursive: true, force: true });
      }
    } finally {
      try { await lock.close(); }
      finally { await fs.unlink(lockFile); }
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(options ? JSON.stringify(await installGuideSkill(options), null, 2) : HELP);
  } catch (error) {
    console.error(`Skill import failed: ${error.message}`);
    process.exitCode = 1;
  }
}
