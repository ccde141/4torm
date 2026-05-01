import type {
  SandboxNode,
  SandboxEdge,
  SandboxWorkflow,
  ExecutionState,
  Envelope,
  FlowExecStatus,
  ExecutionLog,
  NodeExecStatus,
  SandboxNodeData,
  AgentNodeData,
  EntryNodeData,
  Port,
} from '../../types/sandbox';
import { createEnvelope, createEnvelopeFromUpstream, serializeEnvelope, parseEnvelope, resolveTemplate } from './envelope';
import { setAgentStatus, getAgent } from '../../store/agent';
import { saveExecutionState } from '../../store/sandbox';
import { getToolsByNames } from '../../store/tools';
import { executeTool } from '../../api/tools-executor';
import type { RequestOptions } from '../../llm';
import {
  getProvider,
  getProviderForModel,
  getAllModels,
  type ProviderEntry,
  type ModelOption,
} from '../../llm';
import { request } from '../../llm/client';
import { buildSystemPrompt } from '../prompt';
import { parseStructuredOutput } from '../parser';
import type { ToolDef } from '../../store/tools';

export interface ExecContext {
  signal: AbortSignal;
  onLog: (log: ExecutionLog) => void;
  onNodeStatus: (nodeId: string, status: NodeExecStatus) => void;
  onPause: (payload: { nodeId: string; nodeName: string; envelope: Envelope; prompt: string }) => Promise<Envelope>;
  flowId: string;
  flowName?: string;
  envelopes?: Record<string, Envelope>;
  executionLogs?: ExecutionLog[];
  conditionRoutes?: Record<string, number>;
}

type NodeExecFn = (node: SandboxNode, envelope: Envelope, ctx: ExecContext) => Promise<Envelope>;

const executors: Record<string, NodeExecFn> = {};

function register(type: string, fn: NodeExecFn) {
  executors[type] = fn;
}

function getNodeLabel(data: SandboxNodeData): string {
  if ('label' in data) return data.label || '';
  return '';
}

function buildGraph(nodes: SandboxNode[], edges: SandboxEdge[]) {
  const successors: Record<string, string[]> = {};
  const predecessors: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (const n of nodes) {
    successors[n.id] = [];
    predecessors[n.id] = [];
    inDegree[n.id] = 0;
  }
  for (const e of edges) {
    successors[e.source] = successors[e.source] || [];
    successors[e.source].push(e.target);
    predecessors[e.target] = predecessors[e.target] || [];
    predecessors[e.target].push(e.source);
    inDegree[e.target] = (inDegree[e.target] || 0) + 1;
  }
  return { successors, predecessors, inDegree, nodeMap };
}

export function validateWorkflow(workflow: SandboxWorkflow): string[] {
  const errors: string[] = [];
  for (const node of workflow.nodes) {
    if (node.type !== 'agent') continue;
    const ports = (node.data as AgentNodeData).inputPorts || [{ id: 'in-0', label: '输入' }];
    for (const port of ports) {
      const hasEdge = workflow.edges.some(
        e => e.target === node.id && (e.targetHandle === port.id || (!e.targetHandle && port.id === 'in-0')),
      );
      if (!hasEdge) {
        errors.push(
          `节点「${(node.data as AgentNodeData).label}」的输入口「${port.label || port.id}」未连接，工作流无法执行。`,
        );
      }
    }
  }
  return errors;
}

export async function executeWorkflow(
  workflow: SandboxWorkflow,
  state: ExecutionState,
  ctx: ExecContext,
): Promise<ExecutionState> {
  const { nodes, edges } = workflow;
  const { successors, predecessors, inDegree, nodeMap } = buildGraph(nodes, edges);
  const completed = new Set<string>();
  const errored = new Set<string>();
  let { status, envelopes, logs, variables, currentNodeId } = state;
  envelopes = { ...state.envelopes };
  logs = [...state.logs];
  ctx.envelopes = envelopes;
  ctx.executionLogs = logs;
  ctx.conditionRoutes = {};

  const updateState = async (s: FlowExecStatus) => {
    status = s;
    await saveExecutionState(workflow.name, { status, currentNodeId, envelopes, logs, variables });
  };

  const addLog = (level: ExecutionLog['level'], nodeId: string, nodeName: string, message: string) => {
    const log: ExecutionLog = { timestamp: new Date().toISOString(), nodeId, nodeName, level, message };
    logs.push(log);
    ctx.onLog(log);
  };

  const executeNode = async (nodeId: string): Promise<Envelope | null> => {
    if (ctx.signal.aborted) return null;

    const node = nodeMap.get(nodeId);
    if (!node) return null;
    if (completed.has(nodeId) || errored.has(nodeId)) return null;

    const nodeLabel = getNodeLabel(node.data);

    const upstream = predecessors[nodeId] || [];
    let incomingEnvelope: Envelope;

    if (upstream.length === 0) {
      incomingEnvelope = envelopes[nodeId] || createEnvelope({
        flowId: workflow.id,
        nodeId,
        forkIndex: null,
        iteration: null,
      });
    } else if (node.type === 'agent' && ((node.data as AgentNodeData).inputPorts?.length || 1) > 1) {
      // Agent with multiple input ports: collect per-handle and merge
      const ports = (node.data as AgentNodeData).inputPorts || [{ id: 'in-0', label: '输入' }];
      const portEnvelopes: Envelope[] = [];
      for (const port of ports) {
        const portEdge = edges.find(e =>
          e.target === nodeId &&
          (e.targetHandle === port.id || (!e.targetHandle && port.id === 'in-0'))
        );
        if (portEdge && envelopes[portEdge.source]) {
          portEnvelopes.push(envelopes[portEdge.source]);
        }
      }
      if (portEnvelopes.length === 0) {
        incomingEnvelope = createEnvelope({
          flowId: workflow.id, nodeId, forkIndex: null, iteration: null,
        });
      } else {
        incomingEnvelope = mergeInputEnvelopes(portEnvelopes, ports);
      }
    } else {
      const upstreamEnvelopes: Envelope[] = [];
      for (const uid of upstream) {
        const predNode = nodeMap.get(uid);
        if (predNode?.type === 'fork' && ctx.envelopes) {
          const edge = edges.find(e => e.source === uid && e.target === nodeId);
          if (edge?.sourceHandle) {
            const branchKey = `${uid}:${edge.sourceHandle}`;
            if (ctx.envelopes[branchKey]) {
              upstreamEnvelopes.push(ctx.envelopes[branchKey]);
              continue;
            }
          }
        }
        if (envelopes[uid]) upstreamEnvelopes.push(envelopes[uid]);
      }

      if (upstreamEnvelopes.length === 0) {
        // No upstream output yet (shouldn't happen in normal flow)
        const edge = edges.find(e => e.target === nodeId);
        if (edge && envelopes[edge.source]) {
          incomingEnvelope = createEnvelopeFromUpstream(envelopes[edge.source], {
            flowId: workflow.id,
            nodeId,
            forkIndex: envelopes[edge.source].meta.forkIndex,
            iteration: envelopes[edge.source].meta.iteration,
          }, edge.arrowConfig);
        } else {
          addLog('warn', nodeId, nodeLabel, '无上游信封，使用空信封');
          incomingEnvelope = createEnvelope({
            flowId: workflow.id, nodeId, forkIndex: null, iteration: null,
          });
        }
      } else if (node.type === 'merge') {
        // Merge node: combine all upstream envelopes
        incomingEnvelope = mergeEnvelopesForNode(upstreamEnvelopes, node, {
          flowId: workflow.id, nodeId, forkIndex: null, iteration: null,
        });
      } else if (upstreamEnvelopes.length >= 2) {
        // Multiple upstream sources: merge all into one
        incomingEnvelope = mergeEnvelopesForNode(upstreamEnvelopes, node, {
          flowId: workflow.id, nodeId, forkIndex: null, iteration: null,
        });
      } else {
        // Standard single upstream: use the one
        const edge = edges.find(e => e.target === nodeId && envelopes[e.source]);
        if (edge) {
          incomingEnvelope = createEnvelopeFromUpstream(envelopes[edge.source], {
            flowId: workflow.id,
            nodeId,
            forkIndex: envelopes[edge.source].meta.forkIndex,
            iteration: envelopes[edge.source].meta.iteration,
          }, edge.arrowConfig);
        } else {
          incomingEnvelope = createEnvelopeFromUpstream(upstreamEnvelopes[0], {
            flowId: workflow.id, nodeId, forkIndex: null, iteration: null,
          });
        }
      }
    }

    // Apply global variables
    incomingEnvelope.variables = { ...incomingEnvelope.variables, ...variables };

    // Set node output_schema from Agent node config
    if (node.type === 'agent' && 'outputSchema' in node.data) {
      incomingEnvelope.outputSchema = (node.data as AgentNodeData).outputSchema;
      incomingEnvelope.role = (node.data as AgentNodeData).agentRole || '';
    }

    // Apply arrow inject_role if edge configured (after agent role so it can override)
    const edge = edges.find(e => e.target === nodeId);
    if (edge?.arrowConfig?.injectRole && edge.arrowConfig.extractField) {
      incomingEnvelope.role = incomingEnvelope.input;
    }

    ctx.onNodeStatus(nodeId, 'running');
    currentNodeId = nodeId;
    await updateState('running');

    try {
      const executor = executors[node.type];
      if (!executor) {
        addLog('warn', nodeId, nodeLabel, `未注册的节点类型: ${node.type}`);
        completed.add(nodeId);
        ctx.onNodeStatus(nodeId, 'done');
        return incomingEnvelope;
      }

      const result = await executor(node, incomingEnvelope, ctx);
      envelopes[nodeId] = result;
      completed.add(nodeId);
      addLog('info', nodeId, nodeLabel, `执行成功`);
      ctx.onNodeStatus(nodeId, 'done');
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog('error', nodeId, nodeLabel, msg);
      ctx.onNodeStatus(nodeId, 'error');

      // Route to error handler if exists
      const errorHandler = nodes.find(n => n.type === 'error-handler');
      if (errorHandler && errorHandler.id !== nodeId) {
        const prev = incomingEnvelope.input ? incomingEnvelope.input + '\n\n' : '';
        incomingEnvelope.input = prev + `[${nodeLabel}] ${msg}`;
        envelopes[nodeId] = incomingEnvelope;
        errored.add(nodeId);
        // Let errorHandler execute in next wave
        if (!completed.has(errorHandler.id)) {
          ctx.onNodeStatus(errorHandler.id, 'running');
        }
      } else {
        // No error handler: mark as errored
        errored.add(nodeId);
      }
      return null;
    }
  };

  // Main loop: topological execution
  let progress = true;

  while (progress && !ctx.signal.aborted) {
    progress = false;

    for (const nodeId of Object.keys(inDegree)) {
      if (completed.has(nodeId) || errored.has(nodeId)) continue;

      const node = nodeMap.get(nodeId);
      if (!node) continue;

      const allUpstreamDone = (predecessors[nodeId] || []).every(uid => {
        if (!completed.has(uid) && !errored.has(uid)) return false;

        const predNode = nodeMap.get(uid);
        if (predNode?.type === 'condition' && ctx.conditionRoutes![uid] !== undefined) {
          const edge = edges.find(e => e.source === uid && e.target === nodeId);
          if (!edge?.sourceHandle) return true;
          const matchIdx = ctx.conditionRoutes![uid];
          if (matchIdx === -1) return edge.sourceHandle === 'output-default';
          return edge.sourceHandle === `output-${matchIdx}`;
        }

        return true;
      });
      if (!allUpstreamDone) continue;

      if (node.type === 'merge') {
        const upstreamIds = predecessors[nodeId] || [];
        if (upstreamIds.some(uid => !completed.has(uid))) continue;
      }

      if (node.type === 'error-handler') {
        if (errored.size === 0) {
          completed.add(nodeId);
          continue;
        }
      }

      // Handle loop-while: iterative execution of full body subgraph
      if (node.type === 'loop-while') {
        const loopData = node.data as import('../../types/sandbox').LoopNodeData;
        const maxIter = Math.min(loopData.maxIterations || 10, 20);
        let lastEnv: Envelope | null = null;

        const upstream = predecessors[nodeId] || [];
        if (upstream.length > 0 && envelopes[upstream[0]]) {
          lastEnv = createEnvelopeFromUpstream(envelopes[upstream[0]], {
            flowId: workflow.id, nodeId, forkIndex: null, iteration: 0,
          });
        }

        const bodyEdge = edges.find(e => e.source === nodeId && e.sourceHandle === 'loop-body');
        const exitEdge = edges.find(e => e.source === nodeId && e.sourceHandle === 'loop-exit');

        // Discover exit-path nodes (excluded from body reset)
        const exitNodes = new Set<string>();
        if (exitEdge) {
          const queue = [exitEdge.target];
          const visited = new Set<string>([nodeId]);
          while (queue.length > 0) {
            const id = queue.shift()!;
            if (visited.has(id)) continue;
            visited.add(id);
            exitNodes.add(id);
            for (const child of (successors[id] || [])) {
              if (!visited.has(child)) queue.push(child);
            }
          }
        }

        // Discover all loop-body nodes (BFS from body entry, stopping at exit path)
        const bodyNodes = new Set<string>();
        if (bodyEdge) {
          const queue = [bodyEdge.target];
          const visited = new Set<string>([nodeId]);
          while (queue.length > 0) {
            const id = queue.shift()!;
            if (visited.has(id) || exitNodes.has(id)) continue;
            visited.add(id);
            bodyNodes.add(id);
            for (const child of (successors[id] || [])) {
              if (!visited.has(child) && !exitNodes.has(child)) queue.push(child);
            }
          }
        }

        for (let iter = 0; iter < maxIter; iter++) {
          if (ctx.signal.aborted) break;

          const currentEnv = lastEnv || createEnvelope({
            flowId: workflow.id, nodeId, forkIndex: null, iteration: iter,
          });
          currentEnv.meta.iteration = iter;

          if (iter > 0 && lastEnv) {
            const fieldValue = extractFromEnvelope(lastEnv, loopData.conditionField);
            const shouldContinue = evaluateCondition(fieldValue, loopData.conditionOperator as any, loopData.conditionValue);
            if (!shouldContinue) break;

            // Reset all body nodes for re-execution
            for (const bid of bodyNodes) {
              completed.delete(bid);
              errored.delete(bid);
              delete envelopes[bid];
            }
          }

          envelopes[nodeId] = currentEnv;

          // Execute all body nodes in topological order within this iteration
          if (bodyEdge && bodyNodes.size > 0) {
            let bodyProgress = true;
            while (bodyProgress && !ctx.signal.aborted) {
              bodyProgress = false;
              for (const bid of bodyNodes) {
                if (completed.has(bid) || errored.has(bid)) continue;

                // Check if all predecessors are satisfied
                const preds = predecessors[bid] || [];
                const allReady = preds.every(pid => {
                  if (pid === nodeId) return true;
                  return completed.has(pid) || errored.has(pid);
                });
                if (!allReady) continue;

                const bodyResult = await executeNode(bid);
                if (bodyResult) {
                  lastEnv = createEnvelopeFromUpstream(bodyResult, {
                    flowId: workflow.id, nodeId, forkIndex: null, iteration: iter,
                  });
                }
                bodyProgress = true;
              }
            }
          }

          ctx.onLog({
            timestamp: new Date().toISOString(),
            nodeId,
            nodeName: loopData.label || '条件循环',
            level: 'info',
            message: `第 ${iter + 1} 轮迭代完成`,
          });
        }

        if (lastEnv) {
          envelopes[nodeId] = lastEnv;
        }
        for (const bid of bodyNodes) completed.add(bid);
        completed.add(nodeId);
        progress = true;
        continue;
      }

      // Backward-compatible: loop-count (no longer in palette, but kept for existing workflows)
      if (node.type === 'loop-count') {
        const loopData = node.data as import('../../types/sandbox').LoopNodeData;
        const count = Math.min(loopData.count || 1, 20);
        for (let i = 0; i < count; i++) {
          if (ctx.signal.aborted) break;
          const iterEnvelope = createEnvelope({
            flowId: workflow.id, nodeId, forkIndex: null, iteration: i,
          });
          envelopes[nodeId] = iterEnvelope;
          const children = successors[nodeId] || [];
          for (const child of children) {
            await executeNode(child);
          }
        }
        completed.add(nodeId);
        progress = true;
        continue;
      }

      const result = await executeNode(nodeId);
      if (result) progress = true;

      if (progress) break;
    }

    const allDone = Object.keys(inDegree).every(id => completed.has(id) || errored.has(id));
    if (allDone) {
      if (errored.size === 0) {
        status = 'finished';
      } else {
        status = 'error';
      }
      await updateState(status);
      break;
    }
  }

  if (ctx.signal.aborted) {
    status = 'paused';
    await updateState('paused');
  }

  return { status, currentNodeId, envelopes, logs, variables };
}

function mergeEnvelopesForNode(
  upstreamEnvs: Envelope[],
  node: SandboxNode,
  meta: EnvelopeMeta,
): Envelope {
  const env = createEnvelope(meta);
  env.role = '汇总上游结果';
  env.requirement = '汇总分析上游输出，给出整体结论。';

  env.context = upstreamEnvs.map((e, i) =>
    `[分支 ${e.meta.forkIndex ?? i}]\n${e.context || e.input}`
  ).join('\n\n');

  env.input = upstreamEnvs.map((e, i) =>
    `[分支 ${e.meta.forkIndex ?? i}] ${e.input}`
  ).join('\n\n---\n\n');

  env.variables = deepCopy(upstreamEnvs[0]?.variables || {});
  return env;
}

function mergeInputEnvelopes(
  upstreamEnvs: Envelope[],
  ports: Port[],
): Envelope {
  const meta: EnvelopeMeta = {
    flowId: upstreamEnvs[0]?.meta?.flowId || '',
    nodeId: '',
    forkIndex: null,
    iteration: upstreamEnvs[0]?.meta?.iteration ?? null,
  };
  const env = createEnvelope(meta);

  env.goal = upstreamEnvs[0]?.goal || '';
  env.context = upstreamEnvs[0]?.context || '';

  const variables: Record<string, unknown> = {};
  for (const e of upstreamEnvs) {
    Object.assign(variables, e.variables || {});
  }
  env.variables = variables;

  const inputSections = ports.map((port, i) => {
    const content = upstreamEnvs[i]?.input ?? '(未到达)';
    return `## ${port.label}\n${content}`;
  });
  env.input = inputSections.join('\n\n');

  return env;
}

function deepCopy<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

register('entry', async (node, envelope, ctx) => {
  const data = node.data as EntryNodeData;
  envelope.goal = data.inputContent || '';
  envelope.input = envelope.input || data.inputContent || '';
  envelope.role = data.label || '任务入口';
  return envelope;
});

register('agent', async (node, envelope, ctx) => {
  const data = node.data as AgentNodeData;
  if (!data.agentId) throw new Error('Agent 节点未关联智能体');

  const model = await getAgentModel(data.agentId);
  const provider = await getProviderForModel(model);
  if (!provider) throw new Error(`找不到模型 ${model} 的提供商`);
  const opts = await buildRequestOptions(provider);

  const agent = await getAgent(data.agentId);
  const config = agent?.config;
  const maxLoops = config?.maxToolCalls ?? 100;
  const workspace = data.workspacePath || config?.workspace || `data/agents/${data.agentId}/.workspace/`;
  const resolvedRole = resolveTemplate(data.agentRole || '', envelope);

  let toolDefs: ToolDef[] = [];
  if (config?.tools?.length) {
    toolDefs = await getToolsByNames(config.tools);
  }
  if (config?.skills?.length) {
    const { readSkillToolDefs } = await import('../../store/skills');
    for (const skillId of config.skills) {
      const skillTools = await readSkillToolDefs(skillId);
      if (skillTools) {
        for (const st of skillTools) {
          if (!toolDefs.some(t => t.name === st.name)) {
            toolDefs.push(st as ToolDef);
          }
        }
      }
    }
  }

  try {
    if (toolDefs.length > 0) {
      // ===== 两层套壳：内层 ReAct + 外层信封包装 =====
      envelope = await runReActLoop(node, data, envelope, ctx, toolDefs, resolvedRole, workspace, model, opts, maxLoops);
      envelope = await wrapInEnvelope(data, envelope, ctx, model, opts);
    } else {
      // ===== 无工具：单次调用（原有行为） =====
      envelope.role = resolvedRole;
      const systemPrompt = buildAgentSystemPrompt(data, envelope);
      const res = await request<{ choices: Array<{ message: { content: string } }> }>(
        '/chat/completions', opts, { model: extractModelId(model), messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: serializeEnvelope(envelope) }], temperature: data.outputSchema ? 0.3 : 0.7, max_tokens: 4096, stream: false },
      );
      const content = res.choices?.[0]?.message?.content || '';
      const parsed = parseEnvelope(content);
      if (parsed) {
        envelope.input = data.outputSchema ? safeJsonParse(parsed.input) ?? parsed.input : parsed.input || content;
      } else {
        envelope.input = content;
      }
    }

    envelope.meta.nodeId = node.id;
    return envelope;
  } catch (err) {
    throw new Error(`Agent 执行失败: ${err instanceof Error ? err.message : String(err)}`);
  }
});

register('condition', async (node, envelope, ctx) => {
  const data = node.data as import('../../types/sandbox').ConditionNodeData;
  let matchIndex = -1;

  if (!data.rules || data.rules.length === 0) {
    envelope.input = '无匹配条件';
    if (ctx.conditionRoutes) ctx.conditionRoutes[node.id] = -1;
    return envelope;
  }

  for (const rule of data.rules) {
    const fieldValue = extractFromEnvelope(envelope, rule.field);
    const match = evaluateCondition(fieldValue, rule.operator, rule.value);
    if (match) {
      matchIndex = data.rules.indexOf(rule);
      envelope.input = `条件匹配: ${rule.field} ${rule.operator} ${rule.value}`;
      (envelope as any).__conditionMatchIndex = matchIndex;
      if (ctx.conditionRoutes) ctx.conditionRoutes[node.id] = matchIndex;
      return envelope;
    }
  }

  envelope.input = '无匹配条件，走默认路由';
  (envelope as any).__conditionMatchIndex = -1;
  if (ctx.conditionRoutes) ctx.conditionRoutes[node.id] = -1;
  return envelope;
});

register('merge', async (node, envelope, ctx) => {
  const data = node.data as import('../../types/sandbox').MergeNodeData;

  if (data.strategy === 'agent-summary' && data.summaryAgentId) {
    try {
      const model = await getAgentModel(data.summaryAgentId);
      const provider = await getProviderForModel(model);
      if (!provider) throw new Error('找不到模型提供商');

      const opts = await buildRequestOptions(provider);
      const res = await request<{
        choices: Array<{ message: { content: string } }>;
      }>('/chat/completions', opts, {
        model: extractModelId(model),
        messages: [
          { role: 'system' as const, content: '请对以下内容进行摘要合并，只输出合并后的结果。' },
          { role: 'user' as const, content: envelope.input },
        ],
        temperature: 0.3,
        max_tokens: 2048,
        stream: false,
      });

      envelope.input = res.choices?.[0]?.message?.content || envelope.input;
    } catch (err) {
      ctx.onLog({
        timestamp: new Date().toISOString(),
        nodeId: node.id,
        nodeName: data.label || '合并',
        level: 'warn',
        message: `Agent 摘要失败: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  envelope.input = data.strategy !== 'agent-summary' ? envelope.input.replace(/\n\n---\n\n/g, '\n') : envelope.input;
  return envelope;
});

register('fork', async (node, envelope, ctx) => {
  const data = node.data as import('../../types/sandbox').ForkNodeData;
  const count = Math.min(data.branchCount || 2, 10);

  ctx.onLog({
    timestamp: new Date().toISOString(),
    nodeId: node.id,
    nodeName: data.label || '分叉',
    level: 'info',
    message: `分叉为 ${count} 个分支`,
  });

  for (let i = 0; i < count; i++) {
    const branchEnv = deepCopy(envelope);
    branchEnv.meta.forkIndex = i;
    if (ctx.envelopes) {
      ctx.envelopes[`${node.id}:fork-${i}`] = branchEnv;
    }
  }

  return envelope;
});

register('variable', async (node, envelope, ctx) => {
  const data = node.data as import('../../types/sandbox').VariableNodeData;

  if (data.mode === 'write') {
    const value = extractFromEnvelope(envelope, data.sourceField);
    envelope.variables[data.variableName] = value;
    ctx.onLog({
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      nodeName: data.label || '变量',
      level: 'info',
      message: `写入变量 ${data.variableName} = ${value}`,
    });
  } else {
    const value = envelope.variables[data.variableName];
    if (value) {
      envelope.input = String(value);
      ctx.onLog({
        timestamp: new Date().toISOString(),
        nodeId: node.id,
        nodeName: data.label || '变量',
        level: 'info',
        message: `读取变量 ${data.variableName} = ${value}`,
      });
    }
  }

  return envelope;
});

register('human-gate', async (node, envelope, ctx) => {
  const data = node.data as import('../../types/sandbox').HumanGateNodeData;

  ctx.onLog({
    timestamp: new Date().toISOString(),
    nodeId: node.id,
    nodeName: data.label || '人工确认',
    level: 'info',
    message: '等待人工介入...',
  });

  const result = await ctx.onPause({
    nodeId: node.id,
    nodeName: data.label || '人工确认',
    envelope,
    prompt: data.prompt || '请审阅并选择：',
  });

  return result;
});

register('error-handler', async (node, envelope, ctx) => {
  ctx.onLog({
    timestamp: new Date().toISOString(),
    nodeId: node.id,
    nodeName: '错误处理',
    level: 'info',
    message: `捕获错误: ${envelope.input}`,
  });

  // Passthrough the error info
  return envelope;
});

function buildExecutionReport(
  flowId: string,
  envelopes: Record<string, Envelope>,
  logs: ExecutionLog[],
): string {
  const nodeNames: Record<string, string> = {};
  for (const log of logs) {
    if (log.nodeId && !nodeNames[log.nodeId]) {
      nodeNames[log.nodeId] = log.nodeName || log.nodeId;
    }
  }
  for (const nodeId of Object.keys(envelopes)) {
    if (!nodeNames[nodeId]) nodeNames[nodeId] = nodeId;
  }

  const lines: string[] = [];
  lines.push(`# 工作流执行报告`);
  lines.push('');
  lines.push(`**工作流**: ${flowId}`);
  lines.push(`**节点数**: ${Object.keys(envelopes).length}`);
  lines.push('');

  for (const [nodeId, env] of Object.entries(envelopes)) {
    const name = nodeNames[nodeId] || nodeId;

    lines.push(`---`);
    lines.push('');
    lines.push(`## [${name}]`);
    lines.push('');

    if (env.goal && env.goal !== env.input) {
      lines.push(`**目标**: ${env.goal}`);
      lines.push('');
    }
    if (env.role) {
      lines.push(`**角色**: ${env.role}`);
      lines.push('');
    }

    const outputContent = env.input || '(空)';
    if (outputContent.length <= 2000) {
      lines.push(`**输出**:`);
      lines.push('```');
      lines.push(outputContent);
      lines.push('```');
    } else {
      lines.push(`**输出**: (${outputContent.length} 字符，截取前 2000 字符)`);
      lines.push('```');
      lines.push(outputContent.slice(0, 2000) + '...');
      lines.push('```');
    }
    lines.push('');
  }

  return lines.join('\n');
}

register('output', async (node, envelope, ctx) => {
  const data = node.data as import('../../types/sandbox').OutputNodeData;

  const allEnvelopes = ctx.envelopes || {};
  const allLogs = ctx.executionLogs || [];

  const line = '-'.repeat(60);
  const reportParts: string[] = [];

  reportParts.push(line);
  reportParts.push('风暴沙盒 — 执行报告');
  reportParts.push(line);

  reportParts.push('');
  reportParts.push(buildExecutionReport(ctx.flowId, allEnvelopes, allLogs));

  reportParts.push('');
  reportParts.push(line);
  reportParts.push('最终输出');
  reportParts.push(line);
  reportParts.push('');
  reportParts.push(envelope.input);

  const fullReport = reportParts.join('\n');

  try {
    const flowLabel = (ctx.flowName || ctx.flowId).replace(/[\\/:*?"<>| ]/g, '_');
    const fileName = data.fileNameTemplate
      .replace(/\{timestamp\}/g, Date.now().toString())
      .replace(/\{flow\}/g, flowLabel);
    const path = `${data.filePath || 'workflow_output'}/${fileName}.${data.format}`;
    const content = data.format === 'json'
      ? JSON.stringify({
          flowId: ctx.flowId,
          timestamp: new Date().toISOString(),
          finalOutput: envelope.input,
          nodes: Object.entries(allEnvelopes).map(([id, env]) => ({
            nodeId: id,
            goal: env.goal || '',
            role: env.role || '',
            output: env.input || '',
          })),
        }, null, 2)
      : data.format === 'xml'
        ? serializeEnvelope(envelope)
        : fullReport;

    await fetch('/api/storage/write?path=' + encodeURIComponent(path), {
      method: 'PUT',
      body: content,
    });

    ctx.onLog({
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      nodeName: data.label || '输出',
      level: 'info',
      message: `已输出到 ${path}`,
    });
  } catch (err) {
    ctx.onLog({
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      nodeName: data.label || '输出',
      level: 'error',
      message: `输出失败: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  envelope.input = fullReport;
  return envelope;
});

register('subflow', async (node, envelope, ctx) => {
  const data = node.data as import('../../types/sandbox').SubflowNodeData;

  if (!data.subflowId) throw new Error('子流程未配置');

  ctx.onLog({
    timestamp: new Date().toISOString(),
    nodeId: node.id,
    nodeName: data.label || '子流程',
    level: 'info',
    message: `调用子流程: ${data.subflowName || data.subflowId}`,
  });

  // Subflow execution would recursively call executeWorkflow
  // For now, mark it as passthrough
  envelope.input = `[子流程 ${data.subflowName || data.subflowId} 输出]\n${envelope.input}`;
  return envelope;
});

async function getAgentModel(agentId: string): Promise<string> {
  const { getAgent } = await import('../../store/agent');
  const agent = await getAgent(agentId);
  if (!agent) throw new Error(`找不到 Agent: ${agentId}`);
  return agent.model || (await import('../../llm').then(m => m.getActiveModel())) || '';
}

function extractModelId(fullKey: string): string {
  return fullKey.split(':').slice(1).join(':');
}

async function buildRequestOptions(provider: ProviderEntry): Promise<RequestOptions> {
  return {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey || '',
    headers: provider.headers as Record<string, string> | undefined,
  };
}

function buildTaskPrompt(envelope: Envelope): string {
  const parts: string[] = [];
  if (envelope.goal) parts.push(`## 目标\n${envelope.goal}`);
  if (envelope.context) parts.push(`## 上下文\n${envelope.context}`);
  if (envelope.input) parts.push(`## 当前输入\n${envelope.input}`);
  if (envelope.requirement) parts.push(`## 要求\n${envelope.requirement}`);
  return parts.join('\n\n') || envelope.input || '请开始执行任务。';
}

function buildWrapperSystemPrompt(data: AgentNodeData, envelope: Envelope): string {
  let prompt = `你是一个格式化助手。请将以下研究结果封装成标准信封格式。

## 输出格式
使用以下标签结构响应，不要输出任何标签外的内容：
<envelope>
  <input>完整的最终输出内容</input>
</envelope>

## 规则
- 将原始内容完整保留，放入 <input> 标签内
- 如果原始内容是 JSON，保持 JSON 格式
- 如果原始内容是 Markdown，保持 Markdown 格式
- 可以适当润色和整理，但不得丢失关键信息`;

  if (data.outputSchema) {
    prompt += `\n\n## 输出 Schema
<input> 内的内容必须严格符合以下 JSON schema：
\`\`\`json
${JSON.stringify(data.outputSchema, null, 2)}
\`\`\`
不符合 schema 的内容会被自动过滤。`;
  }

  return prompt;
}

function safeJsonParse(input: string): string | null {
  try {
    const result = JSON.parse(input);
    return JSON.stringify(result, null, 2);
  } catch {
    return null;
  }
}

async function runReActLoop(
  node: SandboxNode,
  data: AgentNodeData,
  envelope: Envelope,
  ctx: ExecContext,
  toolDefs: ToolDef[],
  resolvedRole: string,
  workspace: string,
  model: string,
  opts: RequestOptions,
  maxLoops: number,
): Promise<Envelope> {
  let systemPrompt = buildSystemPrompt(toolDefs, workspace);
  if (resolvedRole) {
    systemPrompt += `\n\n## 角色与任务指令\n${resolvedRole}`;
  }
  systemPrompt += `\n\n## 环境信息\n- 工作区路径: ${workspace}\n- 所有文件读写操作默认基于工作区路径\n- 使用 read_file / write_file / edit_file 时路径相对于工作区`;

  const taskPrompt = buildTaskPrompt(envelope);
  const chatMessages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: taskPrompt },
  ];

  let finalAnswer = '';

  for (let loop = 0; loop < maxLoops; loop++) {
    if (ctx.signal.aborted) throw new Error('执行被中断');

    ctx.onLog({
      timestamp: new Date().toISOString(), nodeId: node.id,
      nodeName: data.label || 'Agent', level: 'info',
      message: `ReAct 第 ${loop + 1} 轮`,
    });

    const res = await request<{ choices: Array<{ message: { content: string } }> }>(
      '/chat/completions', opts, {
        model: extractModelId(model),
        messages: chatMessages as Array<{ role: string; content: string }>,
        temperature: 0.7,
        max_tokens: 4096,
        stream: false,
      },
    );

    const content = res.choices?.[0]?.message?.content || '';
    const parsed = parseStructuredOutput(content, toolDefs);

    // Also check for direct envelope output (LLM might wrap answer in envelope format)
    const directEnvelope = !parsed.answer ? parseEnvelope(content) : null;
    const answerFromEnvelope = directEnvelope?.input;

    if (parsed.answer || answerFromEnvelope) {
      finalAnswer = parsed.answer || answerFromEnvelope || '';
      ctx.onLog({
        timestamp: new Date().toISOString(), nodeId: node.id,
        nodeName: data.label || 'Agent', level: 'info',
        message: `ReAct 完成（${loop + 1} 轮，${parsed.actions.length} 次工具调用）`,
      });
      break;
    }

    if (parsed.actions.length > 0) {
      for (const act of parsed.actions) {
        ctx.onLog({
          timestamp: new Date().toISOString(), nodeId: node.id,
          nodeName: data.label || 'Agent', level: 'info',
          message: `调用工具: ${act.tool}`,
        });

        chatMessages.push({ role: 'assistant', content: content.slice(0, 4000) });

        try {
          const result = await executeTool(act.tool, act.args as Record<string, string>, data.agentId);
          const truncated = String(result).slice(0, 8000);
          chatMessages.push({ role: 'user', content: `<result>${truncated}</result>` });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const toolDef = toolDefs.find(t => t.name.toLowerCase() === act.tool.toLowerCase());
          const paramTip = toolDef
            ? `\n工具 ${act.tool} 的参数定义: ${JSON.stringify((toolDef.parameters as any)?.properties || {}, null, 1)}`
            : '';
          chatMessages.push({ role: 'user', content: `<result>错误: ${errMsg}${paramTip}\n请检查工具参数是否正确，特别是 [必填] 参数和路径格式。</result>` });
          ctx.onLog({
            timestamp: new Date().toISOString(), nodeId: node.id,
            nodeName: data.label || 'Agent', level: 'warn',
            message: `工具 ${act.tool} 执行失败: ${errMsg}`,
          });
        }
      }
      continue;
    }

    // Neither answer nor actions: inject hint
    chatMessages.push({ role: 'assistant', content });
    chatMessages.push({ role: 'user', content: '你的回复缺少 <think> 或 <answer> 标签。每次回复必须同时包含 <think> 和 <answer>，如需调用工具再附加 <action>。请重新回复。' });
  }

  if (!finalAnswer) {
    throw new Error(`ReAct 达到最大轮次（${maxLoops}），未收到最终答案`);
  }

  envelope.input = finalAnswer;
  return envelope;
}

async function wrapInEnvelope(
  data: AgentNodeData,
  envelope: Envelope,
  ctx: ExecContext,
  model: string,
  opts: RequestOptions,
): Promise<Envelope> {
  const wrapperSystem = buildWrapperSystemPrompt(data, envelope);
  const wrapperRes = await request<{ choices: Array<{ message: { content: string } }> }>(
    '/chat/completions', opts, {
      model: extractModelId(model),
      messages: [
        { role: 'system', content: wrapperSystem },
        { role: 'user', content: envelope.input },
      ],
      temperature: data.outputSchema ? 0.3 : 0.3,
      max_tokens: 4096,
      stream: false,
    },
  );

  const wrappedContent = wrapperRes.choices?.[0]?.message?.content || '';
  const wrappedEnvelope = parseEnvelope(wrappedContent);

  if (wrappedEnvelope) {
    envelope.input = data.outputSchema
      ? safeJsonParse(wrappedEnvelope.input) ?? wrappedEnvelope.input
      : wrappedEnvelope.input || wrappedContent;
  } else {
    envelope.input = wrappedContent;
  }

  ctx.onLog({
    timestamp: new Date().toISOString(), nodeId: envelope.meta.nodeId,
    nodeName: data.label || 'Agent', level: 'info',
    message: '外层信封封装完成',
  });

  return envelope;
}

function buildAgentSystemPrompt(
  data: AgentNodeData,
  envelope: Envelope,
): string {
  let prompt = '';

  // role prompt
  if (envelope.role) {
    prompt += `## 角色\n${envelope.role}\n\n`;
  } else if (data.agentRole) {
    prompt += `## 角色\n${data.agentRole}\n\n`;
  }

  // output schema
  if (data.outputSchema) {
    prompt += `## 输出格式\n请严格按照以下 JSON schema 输出，将结果放入 <input> 标签：\n\`\`\`json\n${JSON.stringify(data.outputSchema, null, 2)}\n\`\`\`\n\n`;
  }

  // requirement
  if (envelope.requirement) {
    prompt += `## 要求\n${envelope.requirement}\n\n`;
  }

  // reminder
  if (envelope.reminder) {
    prompt += `## 重要提醒\n${envelope.reminder}\n\n`;
  }

  prompt += '## 输出格式\n使用以下标签结构响应：\n<envelope>\n  <input>你的输出内容</input>\n</envelope>';

  return prompt;
}

function extractFromEnvelope(envelope: Envelope, field: string): string {
  if (field === 'input') return envelope.input;
  if (field === 'context') return envelope.context;
  if (field === 'role') return envelope.role;
  if (envelope.variables && field in envelope.variables) return String(envelope.variables[field] ?? '');
  if (field in envelope.meta) return String((envelope.meta as any)[field] ?? '');
  return '';
}

function evaluateCondition(fieldValue: string, operator: string, value: string): boolean {
  switch (operator) {
    case 'eq': return fieldValue === value;
    case 'neq': return fieldValue !== value;
    case 'gt': return Number(fieldValue) > Number(value);
    case 'gte': return Number(fieldValue) >= Number(value);
    case 'lt': return Number(fieldValue) < Number(value);
    case 'lte': return Number(fieldValue) <= Number(value);
    case 'regex': {
      try { return new RegExp(value).test(fieldValue); } catch { return false; }
    }
    case 'expr': {
      try {
        // eslint-disable-next-line no-new-func
        return new Function('value', `return ${value}`)(fieldValue) === true;
      } catch { return false; }
    }
    default: return false;
  }
}
