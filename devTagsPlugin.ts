// Local tag edit mode (SPEC 5.5): a dev-server-only endpoint that reads and appends
// rows of data/own/tags.csv. `apply: 'serve'` keeps it out of production builds.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const FILE = fileURLToPath(new URL('./data/own/tags.csv', import.meta.url))
const HEADER = 'bar_id,tag,value,source,evidence,reviewed'
const TAGS = new Set(['essen', 'urig', 'modern', 'preiswert', 'gehoben', 'gastgarten', 'lang_offen', 'live_musik', 'absteige'])

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [header, ...body] = rows
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

function quote(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function devTagsPlugin(): Plugin {
  return {
    name: 'dev-tags',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/tags', (req, res) => {
        if (!existsSync(FILE)) writeFileSync(FILE, HEADER + '\n')
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(parseCsv(readFileSync(FILE, 'utf8'))))
          return
        }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          const { bar_id, tag, value, evidence } = JSON.parse(body) as Record<string, string>
          if (!bar_id || !TAGS.has(tag) || !['0', '1'].includes(value)) { res.statusCode = 400; res.end(); return }
          const row = [bar_id, tag, value, 'manual', (evidence || 'Manuell gesetzt').slice(0, 120), '1']
          appendFileSync(FILE, row.map(quote).join(',') + '\n')
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        })
      })
    },
  }
}
