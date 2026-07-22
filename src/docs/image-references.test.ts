import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const docsRoot = join(process.cwd(), 'docs')
const publicRoot = join(docsRoot, 'public')
const imagePattern = /!\[[^\]]*\]\((\/[^)\s]+)\)/g

async function listMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && entry.name !== '.vitepress') return listMarkdownFiles(path)
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
  }))
  return files.flat()
}

test('local documentation images resolve from docs/public', async () => {
  const markdownFiles = await listMarkdownFiles(docsRoot)
  const missing: string[] = []

  for (const markdownFile of markdownFiles) {
    const markdown = await readFile(markdownFile, 'utf8')
    for (const match of markdown.matchAll(imagePattern)) {
      const publicPath = join(publicRoot, decodeURIComponent(match[1].slice(1)))
      try {
        await readFile(publicPath)
      } catch {
        missing.push(`${markdownFile}: ${match[1]}`)
      }
    }
  }

  assert.deepEqual(missing, [])
})
