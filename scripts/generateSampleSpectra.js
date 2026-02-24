#!/usr/bin/env node
/**
 * Scans sample-spectra folder for .jdx, .jcamp, .dx files and generates
 * src/data/sampleSpectra.js. Run before build to include new spectra.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE_FOLDER = path.join(__dirname, '..', 'sample-spectra')
const OUTPUT_FILE = path.join(__dirname, '..', 'src', 'data', 'sampleSpectra.js')
const EXTENSIONS = ['.jdx', '.jcamp', '.dx']

const DATA_START_PATTERNS = [/^##XYDATA=/i, /^##PEAK TABLE=/i, /^##XYPOINTS=/i, /^##DATA TABLE=/i]

function extractLabelValue(content, label) {
  const lines = content.split(/\r?\n/)
  const labelRe = new RegExp(`^##${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=(.*)$`, 'i')
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(labelRe)
    if (match) {
      const parts = [match[1].trim()]
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j]
        if (DATA_START_PATTERNS.some((p) => p.test(line)) || line.startsWith('##')) break
        const cont = /^\s*\+/.test(line) ? line.replace(/^\s*\+/, '').trimEnd() : line
        parts.push(cont)
      }
      return parts.join('\n').trim() || null
    }
  }
  return null
}

function extractMetadata(content, filename) {
  const casMatch = content.match(/##CAS REGISTRY NO=\s*(\S+)/i)
  const titleMatch = content.match(/##TITLE=(.+?)(?:\r?\n|$)/i)
  const namesMatch = extractLabelValue(content, 'NAMES')
  const functionalGroupsMatch = extractLabelValue(content, 'FUNCTIONAL GROUPS')
  const ownerMatch = extractLabelValue(content, 'OWNER')
  const originMatch = extractLabelValue(content, 'ORIGIN')
  const citationMatch = extractLabelValue(content, 'CITATION')
  const casFromFilename = filename.match(/(\d+-\d+-\d+)/)
  const functionalGroups = functionalGroupsMatch
    ? functionalGroupsMatch.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  return {
    casNumber: (casMatch?.[1] ?? casFromFilename?.[1] ?? '').trim(),
    name: (titleMatch?.[1] ?? path.basename(filename, path.extname(filename))).trim(),
    names: namesMatch?.trim() || null,
    functionalGroups,
    owner: ownerMatch?.trim() || null,
    origin: originMatch?.trim() || null,
    citation: citationMatch?.trim() || null,
  }
}

function toId(casNumber, filename) {
  if (casNumber) return casNumber.replace(/\s+/g, '')
  return path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9-]/g, '-')
}

function main() {
  if (!fs.existsSync(SAMPLE_FOLDER)) {
    console.warn(`sample-spectra folder not found at ${SAMPLE_FOLDER}`)
    fs.writeFileSync(OUTPUT_FILE, `/**
 * Sample spectra library. Populate sample-spectra/ with .jdx, .jcamp, .dx files
 * and run: npm run generate:samples (or npm run build)
 */
export const SAMPLE_SPECTRA = []
`)
    return
  }

  const files = fs.readdirSync(SAMPLE_FOLDER)
    .filter((f) => EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .sort()

  const entries = []
  const seenIds = new Set()

  for (const file of files) {
    const filePath = path.join(SAMPLE_FOLDER, file)
    const content = fs.readFileSync(filePath, 'utf-8')
    const { casNumber, name, names, functionalGroups, owner, origin, citation } = extractMetadata(content, file)
    const id = toId(casNumber, file)
    const uniqueId = seenIds.has(id) ? `${id}-${file}` : id
    if (!seenIds.has(id)) seenIds.add(id)

    const importVar = `spectrum_${entries.length}`
    const importPath = path.relative(path.dirname(OUTPUT_FILE), filePath).replace(/\\/g, '/')
    entries.push({
      importVar,
      importPath,
      id: uniqueId.replace(/[^a-zA-Z0-9-]/g, '-'),
      name: name || path.basename(file, path.extname(file)),
      casNumber: casNumber || '-',
      names: names || null,
      functionalGroups,
      owner: owner || null,
      origin: origin || null,
      citation: citation || null,
    })
  }

  const importLines = entries
    .map((e) => `import ${e.importVar} from '${e.importPath}?raw'`)
    .join('\n')
  const arrayEntries = entries
    .map(
      (e) => `  {
    id: '${e.id}',
    name: '${e.name.replace(/'/g, "\\'")}',
    casNumber: '${e.casNumber}',
    names: ${e.names ? `'${String(e.names).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '')}'` : 'null'},
    functionalGroups: [${e.functionalGroups.map((g) => `'${String(g).replace(/'/g, "\\'")}'`).join(', ')}],
    owner: ${e.owner ? `'${String(e.owner).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '')}'` : 'null'},
    origin: ${e.origin ? `'${String(e.origin).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '')}'` : 'null'},
    citation: ${e.citation ? `'${String(e.citation).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '')}'` : 'null'},
    jdxContent: ${e.importVar},
  }`
    )
    .join(',\n')

  const output = `/**
 * Sample spectra library. Add .jdx, .jcamp, .dx files to sample-spectra/
 * and run "npm run generate:samples" or "npm run build" to include them.
 * Auto-generated - do not edit manually.
 */
${importLines}

export const SAMPLE_SPECTRA = [
${arrayEntries}
]
`

  fs.writeFileSync(OUTPUT_FILE, output)
  console.log(`Generated sampleSpectra.js with ${entries.length} spectra`)
}

main()
