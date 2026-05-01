import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const DATA_DIR = path.resolve(__dirname, 'data')

async function resolvePath(filePath: string): Promise<string> {
  // 禁止空路径、绝对路径起始和 UNC 路径
  if (!filePath || filePath.startsWith('/') || filePath.startsWith('\\') || filePath.match(/^[a-zA-Z]:\\/)) {
    throw new Error('路径越界: 不允许的路径格式')
  }
  // URL 解码后的 .. 也应拦截
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.includes('..')) {
    throw new Error('路径越界: 不允许使用相对路径跳转')
  }
  const resolved = path.resolve(DATA_DIR, normalized)
  // 标准化后比较，避免大小写问题（Windows）
  const dataDirNormalized = path.resolve(DATA_DIR).toLowerCase()
  const resolvedNormalized = resolved.toLowerCase()
  if (!resolvedNormalized.startsWith(dataDirNormalized)) {
    throw new Error('路径越界')
  }
  return resolved
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'llm-proxy',
      configureServer(server) {
        server.middlewares.use('/api/llm', async (req, res) => {
          const match = req.url?.match(/^\/(\d+)(\/.*)$/)
          if (!match) { res.statusCode = 400; res.end('Invalid proxy path'); return }
          const [, port, targetPath] = match
          try {
            const body = await readBody(req)
            const proxyRes = await fetch(`http://localhost:${port}${targetPath}`, {
              method: req.method,
              headers: { 'Content-Type': req.headers['content-type'] || 'application/json' },
              body,
            })
            proxyRes.headers.forEach((v, k) => {
              if (!['content-encoding', 'transfer-encoding'].includes(k.toLowerCase())) {
                res.setHeader(k, v)
              }
            })
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.statusCode = proxyRes.status
            const buf = await proxyRes.arrayBuffer()
            res.end(Buffer.from(buf))
          } catch {
            res.statusCode = 502
            res.end(JSON.stringify({ error: '无法连接到 LLM 服务' }))
          }
        })
      },
    },
    {
      name: 'storage-api',
      configureServer(server) {
        server.middlewares.use('/api/storage', async (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const filePath = url.searchParams.get('path') || ''
          const action = url.pathname.replace('/api/storage', '')

          try {
            res.setHeader('Content-Type', 'application/json')
            const resolved = await resolvePath(filePath)

            if (action === '/read') {
              try {
                const raw = await fs.readFile(resolved, 'utf-8')
                if (resolved.endsWith('.json')) {
                  res.end(raw)
                } else {
                  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
                  res.end(raw)
                }
              } catch {
                res.statusCode = 404
                res.end(JSON.stringify({ error: '文件不存在' }))
              }
            } else if (action === '/write') {
              const body = await readBody(req)
              await fs.mkdir(path.dirname(resolved), { recursive: true })
              await fs.writeFile(resolved, body ? Buffer.from(body).toString('utf-8') : '', 'utf-8')
              res.end(JSON.stringify({ ok: true }))
            } else if (action === '/upload') {
              const body = await readBody(req)
              if (!body) { res.statusCode = 400; res.end(JSON.stringify({ error: '缺少文件数据' })); return }
              await fs.mkdir(path.dirname(resolved), { recursive: true })
              await fs.writeFile(resolved, Buffer.from(body.toString(), 'base64'))
              res.end(JSON.stringify({ ok: true }))
            } else if (action === '/delete') {
              try {
                await fs.rm(resolved, { recursive: true, force: true })
                res.end(JSON.stringify({ ok: true }))
              } catch (e) {
                res.statusCode = 500
                res.end(JSON.stringify({ error: `删除失败: ${(e as Error).message}` }))
              }
            } else if (action === '/mkdir') {
              await fs.mkdir(resolved, { recursive: true })
              res.end(JSON.stringify({ ok: true }))
            } else {
              res.statusCode = 400
              res.end(JSON.stringify({ error: '未知操作' }))
            }
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: (e as Error).message }))
          }
        })
      },
    },
    {
      name: 'skin-static',
      configureServer(server) {
        server.middlewares.use('/skin/', async (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const filePath = path.join(DATA_DIR, url.pathname)
          try {
            const content = await fs.readFile(filePath)
            const ext = path.extname(filePath).toLowerCase()
            const mime: Record<string, string> = {
              '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
              '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
            }
            res.setHeader('Content-Type', mime[ext] || 'application/octet-stream')
            res.end(content)
          } catch {
            res.statusCode = 404
            res.end('Not found')
          }
        })
      },
    },
    {
      name: 'sandbox-custom-nodes',
      configureServer(server) {
        const CUSTOM_NODES_DIR = path.resolve(__dirname, 'custom_nodes')

        async function scanCustomNodes() {
          const nodes: Array<{
            type: string; label: string; category: string; color: string;
            inputs: number; outputs: number;
            config_schema: Array<{ key: string; label: string; type: string; options?: string[]; default?: unknown }>;
            hasPanel: boolean;
          }> = []
          const entries = await fs.readdir(CUSTOM_NODES_DIR, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
          for (const entry of entries) {
            if (!entry.isDirectory()) continue
            try {
              const nodeJsonPath = path.join(CUSTOM_NODES_DIR, entry.name, 'node.json')
              const raw = await fs.readFile(nodeJsonPath, 'utf-8')
              const config = JSON.parse(raw)
              if (!config.type || !config.label) { console.warn(`[custom-nodes] ${entry.name}: node.json 缺少 type 或 label，跳过`); continue }
              const hasPanel = await fs.access(path.join(CUSTOM_NODES_DIR, entry.name, 'ConfigPanel.jsx')).then(() => true).catch(() => false)
              nodes.push({ ...config, hasPanel })
            } catch { /* skip invalid */ }
          }
          return nodes
        }

        // Expose custom nodes list
        server.middlewares.use('/api/custom-nodes', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          try {
            const nodes = await scanCustomNodes()
            res.end(JSON.stringify(nodes))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: (e as Error).message }))
          }
        })

        // Serve custom node assets (executor.js, ConfigPanel.jsx)
        server.middlewares.use('/api/custom-nodes/asset', async (req, res) => {
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const nodeType = url.searchParams.get('type') || ''
          const file = url.searchParams.get('file') || 'executor.js'
          if (!nodeType) { res.statusCode = 400; res.end('Missing type'); return }
          const assetPath = path.join(CUSTOM_NODES_DIR, nodeType, file)
          try {
            const content = await fs.readFile(assetPath, 'utf-8')
            res.setHeader('Content-Type', 'application/javascript')
            res.end(content)
          } catch {
            res.statusCode = 404
            res.end('File not found')
          }
        })

        // Hot reload: watch custom_nodes/ for changes
        if (server.watcher && server.ws) {
          server.watcher.add(CUSTOM_NODES_DIR)
          server.watcher.on('change', (filePath) => {
            if (filePath.includes('custom_nodes')) {
              server.ws.send({ type: 'custom', event: 'custom-nodes-changed' })
            }
          })
          server.watcher.on('add', (filePath) => {
            if (filePath.includes('custom_nodes')) {
              server.ws.send({ type: 'custom', event: 'custom-nodes-changed' })
            }
          })
          server.watcher.on('unlink', (filePath) => {
            if (filePath.includes('custom_nodes')) {
              server.ws.send({ type: 'custom', event: 'custom-nodes-changed' })
            }
          })
        }
      },
    },
    {
      name: 'sandbox-exec',
      configureServer(server) {
        server.middlewares.use('/api/sandbox/exec', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          if (req.method === 'POST') {
            try {
              const body = await readBody(req)
              if (!body) { res.statusCode = 400; res.end(JSON.stringify({ error: '缺少请求体' })); return }
              const { workflowId } = JSON.parse(body.toString())
              const wfDir = path.join(DATA_DIR, 'sandbox', workflowId)
              const wfData = JSON.parse(await fs.readFile(path.join(wfDir, 'workflow.json'), 'utf-8'))
              const config = JSON.parse(await fs.readFile(path.join(wfDir, 'config.json'), 'utf-8'))
              const wf = { id: workflowId, ...config, ...wfData }
              const results = await runWorkflow(wf)
              res.end(JSON.stringify(results))
            } catch (e) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: (e as Error).message }))
            }
          } else if (req.method === 'GET') {
            const url = new URL(req.url!, `http://${req.headers.host}`)
            const wfId = url.searchParams.get('workflowId') || ''
            try {
              const runsDir = wfId
                ? path.join(DATA_DIR, 'sandbox', wfId, 'runs')
                : path.join(DATA_DIR, 'sandbox', 'runs')
              const indexFile = path.join(runsDir, '_index.json')
              const index = JSON.parse(await fs.readFile(indexFile, 'utf-8').catch(() => '[]'))
              const runs = []
              for (const f of index.slice(-20)) {
                try {
                  const raw = await fs.readFile(path.join(runsDir, f), 'utf-8')
                  runs.push(JSON.parse(raw))
                } catch { /* skip corrupted */ }
              }
              res.end(JSON.stringify(runs))
            } catch (e) {
              res.statusCode = 500
              res.end(JSON.stringify({ error: (e as Error).message }))
            }
          }
        })
      },
    },
    {
      name: 'skills-api',
      configureServer(server) {
        server.middlewares.use('/api/skills/list', async (_req, res) => {
          res.setHeader('Content-Type', 'application/json')
          try {
            const skillsDir = path.join(DATA_DIR, 'skills')
            const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
            const skills = []
            for (const entry of entries) {
              if (!entry.isDirectory()) continue
              try {
                const configRaw = await fs.readFile(path.join(skillsDir, entry.name, 'config.json'), 'utf-8')
                const meta = JSON.parse(configRaw)
                const hasTools = await fs.access(path.join(skillsDir, entry.name, 'tools.json')).then(() => true).catch(() => false)
                skills.push({ id: entry.name, ...meta, hasTools })
              } catch { /* skip invalid skill dirs */ }
            }
            res.end(JSON.stringify(skills))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: (e as Error).message }))
          }
        })
      },
    },
    {
      name: 'tool-executor',
      configureServer(server) {
        server.middlewares.use('/api/tools/exec', async (req, res) => {
          const body = await readBody(req)
          if (!body) { res.statusCode = 400; res.end(JSON.stringify({ error: '缺少请求体' })); return }

          let params: { tool: string; args: Record<string, string>; agentId?: string }
          try { params = JSON.parse(body.toString()) } catch {
            res.statusCode = 400; res.end(JSON.stringify({ error: 'JSON 格式错误' })); return
          }

          res.setHeader('Content-Type', 'application/json')

          try {
            const result = await executeTool(params.tool, params.args, params.agentId || '')
            res.end(JSON.stringify({ result }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ error: (e as Error).message }))
          }
        })
      },
    },
    {
      name: 'tool-permissions',
      configureServer(server) {
        server.middlewares.use('/api/tools/permissions', async (req, res) => {
          res.setHeader('Content-Type', 'application/json')
          const url = new URL(req.url!, `http://${req.headers.host}`)
          const agentId = url.searchParams.get('agentId') || ''

          if (req.method === 'GET') {
            try {
              const p = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'tools/permissions.json'), 'utf-8'))
              res.end(JSON.stringify(p[agentId] || {}))
            } catch {
              res.end(JSON.stringify({}))
            }
          } else if (req.method === 'PUT') {
            const body = await readBody(req)
            if (body) {
              let all: Record<string, Record<string, string>> = {}
              try { all = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'tools/permissions.json'), 'utf-8')) } catch { /* new file */ }
              all[agentId] = JSON.parse(body.toString())
              await fs.mkdir(path.dirname(path.join(DATA_DIR, 'tools/permissions.json')), { recursive: true })
              await fs.writeFile(path.join(DATA_DIR, 'tools/permissions.json'), JSON.stringify(all, null, 2))
              res.end(JSON.stringify({ ok: true }))
            }
          }
        })
      },
    },
  ],
})

function readBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined))
  })
}

const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+-rf/i, /rmdir\s+\/s/i, /del\s+\/f/i,
  /shutdown/i, /reboot/i, /halt/i, /poweroff/i,
  /mkfs/i, /format/i, /fdisk/i,
  /dd\s+if=/i,
];
const MAX_CMD_LENGTH = 1000;

function checkBlockedCommand(cmd: string): string | null {
  if (cmd.length > MAX_CMD_LENGTH) {
    return `命令过长 (${cmd.length} > ${MAX_CMD_LENGTH} 字符)`;
  }
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(cmd)) {
      return `命令包含被禁止的操作: ${pattern}`;
    }
  }
  return null;
}

async function getAgentWorkspace(agentId: string): Promise<string> {
  try {
    const registry = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'agents/registry.json'), 'utf-8'))
    const agent = registry[agentId]
    if (agent?.config?.workspace) return path.resolve(DATA_DIR, '..', agent.config.workspace)
  } catch { /* use default */ }
  return path.resolve(DATA_DIR, 'agents', agentId, '.workspace')
}

interface ToolDefWithSource {
  name: string
  description: string
  executorType: string
  executorFile?: string
  executorTemplate?: string
  _skillId?: string
}

async function findToolInRegistry(tool: string): Promise<ToolDefWithSource | undefined> {
  try {
    const registry = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'tools/registry.json'), 'utf-8'))
    return registry.find((t: { name: string }) => t.name === tool)
  } catch { return undefined }
}

async function findToolInSkills(tool: string): Promise<ToolDefWithSource | undefined> {
  try {
    const skillsDir = path.join(DATA_DIR, 'skills')
    const entries = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const toolsPath = path.join(skillsDir, entry.name, 'tools.json')
        const toolsRaw = await fs.readFile(toolsPath, 'utf-8')
        const tools: ToolDefWithSource[] = JSON.parse(toolsRaw)
        const found = tools.find(t => t.name === tool)
        if (found) {
          found._skillId = entry.name
          return found
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return undefined
}

async function executeTool(tool: string, args: Record<string, string>, agentId: string): Promise<string> {
  let toolDef = await findToolInRegistry(tool)
  if (!toolDef) toolDef = await findToolInSkills(tool)
  if (!toolDef) throw new Error(`未知工具: ${tool}`)

  const workspaceDir = agentId
    ? await getAgentWorkspace(agentId)
    : path.resolve(DATA_DIR, '..')
  const projectDir = path.resolve(DATA_DIR, '..')
  const ctx = { dataDir: DATA_DIR, workspaceDir, projectDir }

  if (toolDef.executorType === 'template' && toolDef.executorTemplate) {
    let cmd = toolDef.executorTemplate
    for (const [k, v] of Object.entries(args)) {
      cmd = cmd.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v)
    }
    const blocked = checkBlockedCommand(cmd)
    if (blocked) {
      return `(安全拦截) ${blocked}`
    }
    try {
      return execSync(cmd, { encoding: 'utf-8', timeout: 15000, cwd: ctx.workspaceDir, maxBuffer: 1024 * 1024 }) || '(执行完毕)'
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string; message: string; signal?: string; killed?: boolean }
      if (err.signal === 'SIGTERM' || err.killed) {
        return '(命令执行超时，已自动终止)'
      }
      return err.stdout || err.stderr || err.message
    }
  }

  if (toolDef.executorType === 'builtin' || toolDef.executorType === 'custom') {
    const fileName = toolDef.executorFile || tool
    const source = (toolDef as { _skillId?: string })._skillId

    const candidates = source
      ? [path.join(DATA_DIR, 'skills', source, 'executors', `${fileName}.js`)]
      : []
    candidates.push(path.join(DATA_DIR, 'tools/executors', `${fileName}.js`))

    let lastError: unknown
    for (const filePath of candidates) {
      try {
        const fileUrl = pathToFileURL(filePath).href
        const mod = await import(`${fileUrl}?r=${Date.now()}`)
        const fn = mod.default
        if (typeof fn !== 'function') {
          throw new Error(`执行器未导出 default 函数: ${filePath}`)
        }
        return await fn(args, ctx)
      } catch (e) {
        lastError = e
      }
    }
    const errCode = (lastError as NodeJS.ErrnoException)?.code
    if (errCode === 'MODULE_NOT_FOUND' || errCode === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(`执行器文件不存在: ${fileName}.js (请在 data/tools/executors/ 或 data/skills/{skillId}/executors/ 下创建)`)
    }
    throw lastError
  }

  throw new Error(`未知执行器类型: ${toolDef.executorType}`)
}

interface WfNode { id: string; type: string; data: { label: string; agentId?: string; inputContent?: string; outputPath?: string; logicType?: string; logicConfig?: Record<string, unknown> } }
interface WfEdge { id: string; source: string; target: string }
interface WfWorkflow { id: string; nodes: WfNode[]; edges: WfEdge[] }

async function runWorkflow(wf: WfWorkflow): Promise<Array<{ nodeId: string; status: 'done' | 'error'; output?: string; error?: string }>> {
  const results: Array<{ nodeId: string; status: 'done' | 'error'; output?: string; error?: string }> = []
  const outputs = new Map<string, string>()

  const sorted = topologicalSort(wf.nodes, wf.edges)

  for (const node of sorted) {
    try {
      const inputContent = collectInputs(node.id, wf.edges, outputs)
      const startTime = Date.now()

      switch (node.type) {
        case 'annotation':
        case 'group':
          outputs.set(node.id, '')
          results.push({ nodeId: node.id, status: 'done', output: '' })
          break
        case 'input': {
          const val = node.data.inputContent || inputContent.join('\n') || ''
          outputs.set(node.id, val)
          results.push({ nodeId: node.id, status: 'done', output: val.slice(0, 500) })
          break
        }
        case 'agent': {
          if (!node.data.agentId) throw new Error('未指定 Agent')
          const agentRegistry = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'agents/registry.json'), 'utf-8'))
          const agent = agentRegistry[node.data.agentId]
          if (!agent) throw new Error(`Agent ${node.data.agentId} 不存在`)

          const [providerId, ...modelIdParts] = (agent.model || '').split(':')
          const modelId = modelIdParts.join(':')
          const providers = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'providers.json'), 'utf-8'))
          const provider = providers[providerId]
          if (!provider || !modelId) throw new Error('Agent 模型未配置')

          const agentDir = path.join(DATA_DIR, 'agents', node.data.agentId)
          const mp = await fs.readFile(path.join(agentDir, '.workspace/master-prompt.md'), 'utf-8').catch(() => '')
          const rp = await fs.readFile(path.join(agentDir, '.workspace/role-prompt.md'), 'utf-8').catch(() => '')

          const systemContent = [mp, rp].filter(Boolean).join('\n\n')
          const userContent = inputContent.join('\n') || '请开始处理'

          const llmRes = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` },
            body: JSON.stringify({
              model: modelId,
              messages: [
                { role: 'system', content: systemContent },
                { role: 'user', content: userContent },
              ],
              temperature: agent.config?.temperature ?? 0.7,
              max_tokens: 4096,
            }),
          })
          const llmJson: { choices?: Array<{ message?: { content?: string } }>; error?: { message: string } } = await llmRes.json()
          if (llmJson.error) throw new Error(llmJson.error.message)
          const output = llmJson.choices?.[0]?.message?.content || '(无响应)'
          outputs.set(node.id, output)
          results.push({ nodeId: node.id, status: 'done', output: output.slice(0, 500), duration: Date.now() - startTime })
          break
        }
        case 'merge': {
          const merged = inputContent.join('\n\n')
          outputs.set(node.id, merged)
          results.push({ nodeId: node.id, status: 'done', output: merged.slice(0, 500) })
          break
        }
        case 'branch': {
          const content = inputContent.join('\n')
          const condition = (node.data.logicConfig?.condition as string) || ''
          if (condition && content.includes(condition)) {
            outputs.set(`${node.id}-true`, content)
            results.push({ nodeId: node.id, status: 'done', output: `分支匹配: "${condition}"` })
          } else {
            outputs.set(`${node.id}-false`, content)
            results.push({ nodeId: node.id, status: 'done', output: `分支未匹配: "${condition}"` })
          }
          break
        }
        case 'output': {
          const finalContent = inputContent.join('\n')
          if (node.data.outputPath) {
            const outPath = path.resolve(DATA_DIR, '..', node.data.outputPath)
            await fs.mkdir(path.dirname(outPath), { recursive: true })
            await fs.writeFile(outPath, finalContent, 'utf-8')
          }
          outputs.set(node.id, finalContent)
          results.push({ nodeId: node.id, status: 'done', output: finalContent.slice(0, 500) })
          break
        }
        case 'loop': {
          const maxIter = (node.data.logicConfig?.maxIterations as number) || 3
          let loopOutput = inputContent.join('\n')
          for (let i = 0; i < maxIter; i++) {
            loopOutput = `[迭代 ${i + 1}/${maxIter}] ${loopOutput}`
          }
          outputs.set(node.id, loopOutput)
          results.push({ nodeId: node.id, status: 'done', output: loopOutput.slice(0, 500) })
          break
        }
        case 'custom': {
          const customId = node.data.logicType || node.type
          const executorPath = path.join(DATA_DIR, 'sandbox', 'nodes', customId, 'executor.js')
          try {
            const fileUrl = pathToFileURL(executorPath).href
            const mod = await import(`${fileUrl}?r=${Date.now()}`)
            const executor = mod.default
            if (typeof executor !== 'function') {
              throw new Error(`自定义节点执行器未导出 default 函数: ${executorPath}`)
            }
            const customArgs: Record<string, string> = {}
            for (const [k, v] of Object.entries(node.data?.logicConfig || {})) {
              customArgs[k] = String(v)
            }
            for (const [k, v] of Object.entries(args || {})) {
              customArgs[k] = String(v)
            }
            const output = await executor(customArgs, ctx)
            outputs.set(node.id, output)
            results.push({ nodeId: node.id, status: 'done', output: String(output).slice(0, 500) })
          } catch (e) {
            const errCode = (e as NodeJS.ErrnoException).code
            if (errCode === 'MODULE_NOT_FOUND' || errCode === 'ERR_MODULE_NOT_FOUND') {
              throw new Error(`自定义节点执行器不存在: ${executorPath}`)
            }
            throw e
          }
          break
        }
        default:
          const content = inputContent.join('\n') || node.data.inputContent || ''
          outputs.set(node.id, content)
          results.push({ nodeId: node.id, status: 'done', output: content.slice(0, 500) })
      }
    } catch (e) {
      results.push({ nodeId: node.id, status: 'error', error: (e as Error).message })
    }
  }

  // Persist run history per workflow
  try {
    const runsDir = path.join(DATA_DIR, 'sandbox', wf.id, 'runs')
    await fs.mkdir(runsDir, { recursive: true })
    const runFile = path.join(runsDir, `run-${Date.now().toString(36)}.json`)
    await fs.writeFile(runFile, JSON.stringify({
      workflowId: wf.id,
      workflowName: (wf as { name?: string }).name || wf.id,
      timestamp: new Date().toISOString(),
      results,
    }, null, 2), 'utf-8')
    const indexFile = path.join(runsDir, '_index.json')
    let index: string[] = []
    try { index = JSON.parse(await fs.readFile(indexFile, 'utf-8')) } catch { /* new */ }
    index.push(path.basename(runFile))
    await fs.writeFile(indexFile, JSON.stringify(index.slice(-50)), 'utf-8')
  } catch { /* non-critical */ }

  return results
}

function topologicalSort(nodes: WfNode[], edges: WfEdge[]): WfNode[] {
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  const nodeMap = new Map<string, WfNode>()

  for (const n of nodes) {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
    nodeMap.set(n.id, n)
  }
  for (const e of edges) {
    adj.get(e.source)?.push(e.target)
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1)
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const result: WfNode[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    const node = nodeMap.get(id)
    if (node) result.push(node)
    for (const next of adj.get(id) || []) {
      const deg = (inDegree.get(next) || 1) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }

  return result
}

function collectInputs(nodeId: string, edges: WfEdge[], outputs: Map<string, string>): string[] {
  const incoming = edges.filter(e => e.target === nodeId)
  return incoming.map(e => {
    const val = outputs.get(e.source)
    return val || outputs.get(`${e.source}-true`) || outputs.get(`${e.source}-false`) || ''
  }).filter(Boolean)
}
