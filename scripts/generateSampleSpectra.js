#!/usr/bin/env node
/**
 * Scans sample-spectra folder for .jdx, .jcamp, .dx files and generates
 * src/data/sampleSpectra.js. Run before build to include new spectra.
 *
 * Add mode: node scripts/generateSampleSpectra.js --add <file1> [file2...] [folder/]
 *   Duplicate check order: 1) XYDATA match (perfect), 2) name/cas/names.
 *   Only considers replaceable files (blank origin/owner or owner "College of the Sequoias").
 *   Prompts to replace or skip each duplicate.
 *   Accepted → added/, skipped → skipped/, replaced (old file) → replaced/.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import readline from 'node:readline/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE_FOLDER = path.join(__dirname, '..', 'sample-spectra')
const ADDED_FOLDER = path.join(SAMPLE_FOLDER, 'added')
const SKIPPED_FOLDER = path.join(SAMPLE_FOLDER, 'skipped')
const REPLACED_FOLDER = path.join(SAMPLE_FOLDER, 'replaced')
const OUTPUT_FILE = path.join(__dirname, '..', 'src', 'data', 'sampleSpectra.js')
const EXTENSIONS = ['.jdx', '.jcamp', '.dx']
const REPLACEABLE_OWNER = 'College of the Sequoias'

const DATA_START_PATTERNS = [/^##XYDATA=/i, /^##PEAK TABLE=/i, /^##XYPOINTS=/i, /^##DATA TABLE=/i]

/** Extract data block (XYDATA etc.) from content, normalized for comparison */
function extractDataBlock(content) {
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (DATA_START_PATTERNS.some((p) => p.test(lines[i]))) {
      return lines.slice(i).join('\n').trim()
    }
  }
  return ''
}

function normalizeCas(s) {
  return (s ?? '').toString().replace(/\s+/g, '').toLowerCase()
}

function normalizeStr(s) {
  return (s ?? '').toString().trim().toLowerCase()
}

/** Existing file is replaceable if blank origin/owner or owner is College of the Sequoias */
function isReplaceable(meta) {
  const owner = normalizeStr(meta.owner)
  const origin = normalizeStr(meta.origin)
  const blank = (v) => !v || v === '-' || v === ''
  return blank(origin) || blank(owner) || owner.includes(REPLACEABLE_OWNER.toLowerCase())
}

/** Check if XYDATA blocks match perfectly */
function xydataMatches(newBlock, existingBlock) {
  if (!newBlock || !existingBlock) return false
  return newBlock === existingBlock
}

/** Check if metadata matches (on cas, title/name, or names) */
function metadataMatches(newMeta, existingMeta) {
  const nCas = normalizeCas(newMeta.casNumber)
  const eCas = normalizeCas(existingMeta.casNumber)
  if (nCas && eCas && nCas === eCas) return true

  const nName = normalizeStr(newMeta.name)
  const eName = normalizeStr(existingMeta.name)
  if (nName && eName && nName === eName) return true

  const nNames = normalizeStr(newMeta.names)
  const eNames = normalizeStr(existingMeta.names)
  if (nNames && eNames && nNames === eNames) return true

  return false
}

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
  const casMatch = content.match(/##CAS REGISTRY NO=[ \t]*([^\r\n]*)/i)
  const casValue = casMatch?.[1]?.trim()
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
    casNumber: (casValue || (casFromFilename && casFromFilename[1]) || '').trim(),
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

function loadExistingMetadata() {
  if (!fs.existsSync(ADDED_FOLDER)) return []
  const files = fs.readdirSync(ADDED_FOLDER)
    .filter((f) => EXTENSIONS.includes(path.extname(f).toLowerCase()))
  return files.map((file) => {
    const filePath = path.join(ADDED_FOLDER, file)
    const content = fs.readFileSync(filePath, 'utf-8')
    const meta = extractMetadata(content, file)
    const dataBlock = extractDataBlock(content)
    return { file, filePath, meta, dataBlock }
  })
}

/** Find existing files that match (XYDATA first, then metadata) and are replaceable */
function findReplaceableDuplicates(newMeta, newDataBlock, existing) {
  const replaceable = existing.filter((e) => isReplaceable(e.meta))
  const xydataMatch = replaceable.filter((e) => xydataMatches(newDataBlock, e.dataBlock))
  if (xydataMatch.length > 0) return xydataMatch
  return replaceable.filter((e) => metadataMatches(newMeta, e.meta))
}

/** Expand folder paths to spectrum files; pass through file paths as-is */
function expandPaths(paths) {
  const result = []
  for (const rawPath of paths) {
    const resolved = path.resolve(rawPath)
    if (!fs.existsSync(resolved)) {
      result.push(resolved)
      continue
    }
    const stat = fs.statSync(resolved)
    if (stat.isDirectory()) {
      const files = fs.readdirSync(resolved)
        .filter((f) => EXTENSIONS.includes(path.extname(f).toLowerCase()))
        .sort()
        .map((f) => path.join(resolved, f))
      result.push(...files)
    } else if (EXTENSIONS.includes(path.extname(resolved).toLowerCase())) {
      result.push(resolved)
    }
  }
  return result
}

async function addMode(filePaths) {
  if (!filePaths.length) {
    console.error('Usage: node generateSampleSpectra.js --add <file1.jdx> [file2...] [folder/]')
    process.exit(1)
  }

  const expandedPaths = expandPaths(filePaths)
  if (expandedPaths.length === 0) {
    console.error('No spectrum files found.')
    process.exit(1)
  }
  console.log(`Processing ${expandedPaths.length} file(s)...`)

  const existing = loadExistingMetadata()
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  let added = 0
  let replaced = 0
  let skipped = 0

  for (const rawPath of expandedPaths) {
    const srcPath = path.resolve(rawPath)
    if (!fs.existsSync(srcPath)) {
      console.warn(`Skipping (not found): ${srcPath}`)
      skipped++
      continue
    }
    const ext = path.extname(srcPath).toLowerCase()
    if (!EXTENSIONS.includes(ext)) {
      console.warn(`Skipping (wrong extension): ${srcPath}`)
      skipped++
      continue
    }

    const content = fs.readFileSync(srcPath, 'utf-8')
    const newMeta = extractMetadata(content, path.basename(srcPath))
    const newDataBlock = extractDataBlock(content)
    const dupes = findReplaceableDuplicates(newMeta, newDataBlock, existing)

    const destBasename = path.basename(srcPath)
    const addedPath = path.join(ADDED_FOLDER, destBasename)
    const skippedPath = path.join(SKIPPED_FOLDER, destBasename)

    if (dupes.length > 0) {
      const first = dupes[0]
      const matchType = xydataMatches(newDataBlock, first.dataBlock) ? 'XYDATA matches perfectly' : 'matches'
      const title = (newMeta.name || '-').slice(0, 50)
      const titleStr = (newMeta.name || '').length > 50 ? `${title}...` : title
      const prompt = `\n"${destBasename}" ${matchType} existing "${first.file}" (CAS: ${newMeta.casNumber || '-'}, Title: ${titleStr}). Replace? (y/n): `
      const answer = (await rl.question(prompt)).trim().toLowerCase()
      if (answer === 'y' || answer === 'yes') {
        fs.mkdirSync(ADDED_FOLDER, { recursive: true })
        fs.mkdirSync(REPLACED_FOLDER, { recursive: true })
        const replacedPath = path.join(REPLACED_FOLDER, first.file)
        if (fs.existsSync(first.filePath)) {
          fs.renameSync(first.filePath, replacedPath)
        }
        fs.copyFileSync(srcPath, first.filePath)
        console.log(`  Replaced ${first.file} → added/ (previous → replaced/)`)
        replaced++
        const idx = existing.findIndex((e) => e.file === first.file)
        if (idx >= 0) {
          existing[idx].meta = newMeta
          existing[idx].dataBlock = newDataBlock
        }
      } else {
        fs.mkdirSync(SKIPPED_FOLDER, { recursive: true })
        fs.copyFileSync(srcPath, skippedPath)
        console.log(`  Skipped → skipped/`)
        skipped++
      }
    } else {
      if (fs.existsSync(addedPath)) {
        const prompt = `\n"${destBasename}" already exists in added/. Overwrite? (y/n): `
        const answer = (await rl.question(prompt)).trim().toLowerCase()
        if (answer !== 'y' && answer !== 'yes') {
          fs.mkdirSync(SKIPPED_FOLDER, { recursive: true })
          fs.copyFileSync(srcPath, skippedPath)
          console.log(`  Skipped → skipped/`)
          skipped++
          continue
        }
        fs.mkdirSync(REPLACED_FOLDER, { recursive: true })
        fs.renameSync(addedPath, path.join(REPLACED_FOLDER, destBasename))
        const idx = existing.findIndex((e) => e.file === destBasename)
        if (idx >= 0) existing.splice(idx, 1)
      }
      fs.mkdirSync(ADDED_FOLDER, { recursive: true })
      fs.copyFileSync(srcPath, addedPath)
      console.log(`  Added → added/`)
      added++
      existing.push({ file: destBasename, filePath: addedPath, meta: newMeta, dataBlock: newDataBlock })
    }
  }

  rl.close()
  console.log(`\nDone: ${added} added, ${replaced} replaced, ${skipped} skipped`)
  generateSampleSpectra()
}

function generateSampleSpectra() {
  fs.mkdirSync(ADDED_FOLDER, { recursive: true })
  fs.mkdirSync(SKIPPED_FOLDER, { recursive: true })
  fs.mkdirSync(REPLACED_FOLDER, { recursive: true })

  if (!fs.existsSync(ADDED_FOLDER)) {
    console.warn(`sample-spectra/added folder not found`)
    fs.writeFileSync(OUTPUT_FILE, `/**
 * Sample spectra library. Import files with: npm run add:samples -- <folder>
 * Library is built from sample-spectra/added/
 */
export const SAMPLE_SPECTRA = []
`)
    return
  }

  const files = fs.readdirSync(ADDED_FOLDER)
    .filter((f) => EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .sort()

  const entries = []
  const seenIds = new Set()

  for (const file of files) {
    const filePath = path.join(ADDED_FOLDER, file)
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

function main() {
  const args = process.argv.slice(2)
  const addIdx = args.indexOf('--add')
  if (addIdx >= 0) {
    const filePaths = args.slice(addIdx + 1)
    addMode(filePaths).catch((err) => {
      console.error(err)
      process.exit(1)
    })
  } else {
    generateSampleSpectra()
  }
}

main()
