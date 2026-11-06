// Tour export: an Excel sheet (one row per stop) and a GPX file for hiking and map apps
// (waypoints per bar, the tour as a route, and the paths as a track). No libraries: .xlsx is
// a zip of a few XML files, written uncompressed here.

import { clock, WEEKDAYS } from './hours'
import type { SlotView } from './tour'
import { googleMapsPlace, legLabel } from './travel'
import { VENUE_TYPE_LABEL } from './types'

export type Cell = string | number | null

export interface ExportTable {
  header: string[]
  rows: Cell[][]
  /** Column widths in characters. */
  widths: number[]
}

/** The tour as a table; transit lines come from the real routes where known. */
export function tourTable(slots: SlotView[], lines: (string[] | undefined)[]): ExportTable {
  const header = ['Nr.', 'Ankunft', 'Weiter um', 'Lokal', 'Typ', 'Bezirk', 'Adresse', 'Weg hierher', 'Öffnungszeiten',
    'Website', 'Google Maps', 'Breite', 'Länge']
  const rows: Cell[][] = []
  let n = 0
  slots.forEach((sl, i) => {
    const s = sl.stop
    if (!s) {
      rows.push([null, null, null, `(offen: ${sl.district}. Bezirk)`, null, sl.district, null, null, null, null, null, null, null])
      return
    }
    n++
    const way = !s.legIn ? 'Start' : sl.afterGap ? '–' : `${legLabel(s.legIn)}${lines[i]?.length ? ` (${lines[i]!.join(' → ')})` : ''}`
    rows.push([n, clock(s.arrival), clock(s.departure), s.bar.name, VENUE_TYPE_LABEL[s.bar.venueType], s.bar.district,
      s.bar.address ?? null, way, s.bar.openingHoursText ?? null, s.bar.website ?? null, googleMapsPlace(s.bar), s.bar.lat, s.bar.lon])
  })
  return { header, rows, widths: [5, 8, 9, 28, 20, 7, 30, 30, 34, 30, 40, 10, 10] }
}

// ---- xlsx -------------------------------------------------------------------------------

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Control characters are not allowed in XML.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

function sheetXml(t: ExportTable, title: string | null): string {
  const out: string[] = []
  let r = 0
  const row = (cells: Cell[], style: number) => {
    r++
    const cs = cells.map((c, i) => {
      if (c === null || c === '') return ''
      const ref = `${colName(i)}${r}`
      return typeof c === 'number'
        ? `<c r="${ref}" s="${style}"><v>${c}</v></c>`
        : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(c)}</t></is></c>`
    }).join('')
    out.push(`<row r="${r}">${cs}</row>`)
  }
  if (title) {
    row([title], 2)
    r++
  }
  const headerRow = r + 1
  row(t.header, 1)
  for (const cells of t.rows) row(cells, 0)
  const cols = t.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  // Freeze everything above the first data row.
  const pane = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `${pane}<cols>${cols}</cols><sheetData>${out.join('')}</sheetData></worksheet>`
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>'
  + '<font><b/><sz val="14"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFEFFFB8"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>'

let crcTable: Uint32Array | null = null
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** An uncompressed ("stored") zip archive. */
export function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint32(14, crc, true)
    local.setUint32(18, f.data.length, true)
    local.setUint32(22, f.data.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, f.data)
    const cd = new DataView(new ArrayBuffer(46))
    cd.setUint32(0, 0x02014b50, true)
    cd.setUint16(4, 20, true)
    cd.setUint16(6, 20, true)
    cd.setUint16(8, 0x0800, true)
    cd.setUint32(16, crc, true)
    cd.setUint32(20, f.data.length, true)
    cd.setUint32(24, f.data.length, true)
    cd.setUint16(28, name.length, true)
    cd.setUint32(42, offset, true)
    central.push(new Uint8Array(cd.buffer), name)
    offset += 30 + name.length + f.data.length
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of all) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** A one-sheet .xlsx workbook. */
export function xlsx(t: ExportTable, sheetName: string, title: string | null = null): Uint8Array {
  const enc = new TextEncoder()
  const f = (name: string, s: string) => ({ name, data: enc.encode(s) })
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  return zip([
    f('[Content_Types].xml', `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>'),
    f('_rels/.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'),
    f('xl/workbook.xml', `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + `<sheets><sheet name="${xml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    f('xl/_rels/workbook.xml.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>'),
    f('xl/worksheets/sheet1.xml', sheetXml(t, title)),
    f('xl/styles.xml', STYLES),
  ])
}

// ---- gpx --------------------------------------------------------------------------------

/**
 * GPX 1.1: a numbered waypoint per bar, the tour as a route through them, and the paths as a
 * track (one segment per leg). `paths[i]` is the way into stop i as [lon, lat] points; legs
 * without one are drawn straight.
 */
export function tourGpx(slots: SlotView[], paths: ([number, number][] | null | undefined)[], name: string): string {
  const stops = slots.flatMap((sl, i) => (sl.stop ? [{ stop: sl.stop, i, afterGap: sl.afterGap }] : []))
  const pt = (tag: string, lat: number, lon: number, inner = '') =>
    `<${tag} lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${inner}</${tag}>`
  const wpts = stops.map(({ stop }, k) => {
    const b = stop.bar
    const desc = [`${clock(stop.arrival)}–${clock(stop.departure)}`, VENUE_TYPE_LABEL[b.venueType], b.address].filter(Boolean).join(' · ')
    return pt('wpt', b.lat, b.lon, `<name>${xml(`${k + 1}. ${b.name}`)}</name><desc>${xml(desc)}</desc>`
      + (b.website ? `<link href="${xml(b.website)}"/>` : '') + '<sym>Bar</sym>')
  })
  const rte = stops.map(({ stop }, k) => pt('rtept', stop.bar.lat, stop.bar.lon, `<name>${xml(`${k + 1}. ${stop.bar.name}`)}</name>`))
  const segs = stops.slice(1).map(({ stop, i }, k) => {
    const prev = stops[k].stop.bar
    const coords = paths[i]?.length ? paths[i]! : [[prev.lon, prev.lat], [stop.bar.lon, stop.bar.lat]] as [number, number][]
    return `<trkseg>${coords.map(([lon, lat]) => pt('trkpt', lat, lon)).join('')}</trkseg>`
  })
  const first = stops[0]?.stop
  const when = first ? `${WEEKDAYS[Math.floor(first.arrival / (24 * 60)) % 7]} ab ${clock(first.arrival)}` : ''
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<gpx version="1.1" creator="Wiener Durst" xmlns="http://www.topografix.com/GPX/1/1">'
    + `<metadata><name>${xml(name)}</name><desc>${xml(`${stops.length} Lokale${when ? `, ${when}` : ''}`)}</desc></metadata>`
    + wpts.join('')
    + `<rte><name>${xml(name)}</name>${rte.join('')}</rte>`
    + (segs.length ? `<trk><name>${xml(name)}</name>${segs.join('')}</trk>` : '')
    + '</gpx>\n'
}

/** Save bytes or text as a file in the browser. */
export function download(data: Uint8Array | string, filename: string, type: string) {
  const part: BlobPart = typeof data === 'string' ? data
    : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
  const blob = new Blob([part], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
