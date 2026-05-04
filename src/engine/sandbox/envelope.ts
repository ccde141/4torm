import type { Envelope, EnvelopeMeta, ArrowConfig } from '../../types/sandbox';

export function createEnvelope(meta: EnvelopeMeta): Envelope {
  return {
    meta,
    goal: '',
    role: '',
    context: '',
    input: '',
    variables: {},
    requirement: '深刻理解目标，严谨执行，按 output_schema 输出，不得增减字段。',
    outputSchema: null,
    reminder: '严格按照 output_schema 输出，不得附加自由文本。',
  };
}

export function createEnvelopeFromUpstream(
  upstream: Envelope,
  meta: EnvelopeMeta,
  arrowConfig?: ArrowConfig,
): Envelope {
  const env = createEnvelope(meta);
  env.goal = upstream.goal;
  env.variables = deepCopy(upstream.variables);

  if (arrowConfig?.contextMode !== false) {
    env.context = summarizeEnvelope(upstream);
  }

  if (arrowConfig?.extractField) {
    env.input = extractField(upstream, arrowConfig.extractField);
  } else {
    env.input = upstream.input || '';
  }

  return env;
}

export function parseEnvelope(xml: string): Envelope | null {
  try {
    const extract = (tag: string): string =>
      (xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '').trim();

    const metaRaw = extract('meta');
    const meta: EnvelopeMeta = {
      flowId: extractInner(metaRaw, 'flow_id'),
      nodeId: extractInner(metaRaw, 'node_id'),
      forkIndex: parseMaybeInt(extractInner(metaRaw, 'fork_index')),
      iteration: parseMaybeInt(extractInner(metaRaw, 'iteration')),
    };

    let outputSchema: Record<string, unknown> | null = null;
    const schemaRaw = extract('output_schema');
    if (schemaRaw) {
      try { outputSchema = JSON.parse(schemaRaw); } catch { /* xml embedded */ }
    }

    let variables: Record<string, unknown> = {};
    const varsRaw = extract('variables');
    if (varsRaw) {
      try { variables = JSON.parse(varsRaw); } catch { /* ok */ }
    }

    return {
      meta,
      goal: extract('goal'),
      role: extract('role'),
      context: extract('context'),
      input: extract('input'),
      variables,
      requirement: extract('requirement') || '深刻理解目标，严谨执行。',
      outputSchema,
      reminder: extract('reminder') || '严格按照 output_schema 输出。',
    };
  } catch {
    return null;
  }
}

export function serializeEnvelope(env: Envelope): string {
  const m = env.meta;
  return `<envelope>
  <meta>
    <flow_id>${esc(m.flowId)}</flow_id>
    <node_id>${esc(m.nodeId)}</node_id>
    <fork_index>${m.forkIndex ?? ''}</fork_index>
    <iteration>${m.iteration ?? ''}</iteration>
  </meta>
  <goal>${esc(env.goal)}</goal>
  <role>${esc(env.role)}</role>
  <context>${esc(env.context)}</context>
  <input>${esc(env.input)}</input>
  <variables>${esc(JSON.stringify(env.variables))}</variables>
  <requirement>${esc(env.requirement)}</requirement>
  <output_schema>${esc(env.outputSchema ? JSON.stringify(env.outputSchema, null, 2) : '')}</output_schema>
  <reminder>${esc(env.reminder)}</reminder>
</envelope>`;
}

export function extractField(env: Envelope, field: string): string {
  if (field === 'input') return env.input;
  if (field === 'context') return env.context;
  if (field === 'role') return env.role;
  if (env.variables && field in env.variables) return String(env.variables[field] ?? '');
  return env.input || '';
}

export function summarizeEnvelope(env: Envelope): string {
  const rolePrefix = env.role ? `[上游角色: ${env.role.slice(0, 80)}]\n` : '';
  const text = env.input || '';
  if (!text) return env.context || '';
  if (text.length <= 1000) return rolePrefix + text;
  const chunk = text.slice(0, 1000);
  const lastBreak = Math.max(
    chunk.lastIndexOf('\n\n'),
    chunk.lastIndexOf('。'),
    chunk.lastIndexOf('\n'),
    500,
  );
  return rolePrefix + chunk.slice(0, lastBreak) + '\n...(完整内容见「上游交付内容」)';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractInner(xml: string, tag: string): string {
  return (xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '').trim();
}

function parseMaybeInt(v: string): number | null {
  if (v === '' || v === 'null') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function deepCopy<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function resolveTemplate(template: string, envelope: Envelope): string {
  return template
    .replace(/\{\{goal\}\}/g,        envelope.goal        ?? '')
    .replace(/\{\{context\}\}/g,     envelope.context     ?? '')
    .replace(/\{\{input\.([^}]+)\}\}/g, (_, label) => {
      const full = envelope.input ?? '';
      const sectionHeader = `## ${label}`;
      const idx = full.indexOf(sectionHeader);
      if (idx === -1) return '';
      const after = full.slice(idx + sectionHeader.length);
      const nextHeader = after.indexOf('\n## ');
      return (nextHeader === -1 ? after : after.slice(0, nextHeader)).trim();
    })
    .replace(/\{\{input\}\}/g,       envelope.input       ?? '')
    .replace(/\{\{iteration\}\}/g,   String(envelope.meta?.iteration ?? ''))
    .replace(/\{\{fork_index\}\}/g,  String(envelope.meta?.forkIndex ?? ''))
    .replace(/\{\{variables\.(\w+)\}\}/g, (_, key) =>
      envelope.variables?.[key] != null ? String(envelope.variables[key]) : ''
    );
}
