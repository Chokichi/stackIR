#!/usr/bin/env node
/**
 * Scans sample-spectra folder for .jdx, .jcamp, .dx files and generates
 * src/data/sampleSpectra.js. Run before build to include new spectra.
 *
 * Default (npm run generate:samples): If any spectrum files exist in sample-spectra/
 * root (not in added/skipped/replaced), imports them first (moves to added/),
 * then regenerates sampleSpectra.js.
 *
 * Add mode: node scripts/generateSampleSpectra.js --add <file1> [file2...] [folder/]
 *   Duplicate check: metadata only — CAS/title/names (legacy), then core ## header values
 *   (same fields; line order ignored). Does not compare XYDATA or whole-file text.
 *   Only considers replaceable files (blank origin/owner or owner "College of the Sequoias").
 *   Prompts to replace or skip each duplicate.
 *   Accepted → added/, skipped → skipped/, replaced (old file) → replaced/.
 *   Each file written to added/ gets ##DATE ADDED=YYYY-MM-DD inserted on the line after ##OWNER=.
 *
 * Analyze (for GUI): node scripts/generateSampleSpectra.js --analyze <file1> [file2...] [folder/]
 *   Prints JSON to stdout: kind, paths, matchType, validDecisions, etc. (see README in macOS app).
 *
 * Batch (non-interactive): node scripts/generateSampleSpectra.js --batch <plan.json>
 *   plan.json: { "items": [ { "source": "/abs/path.jdx", "decision": "replace"|"skip"|"add"|"overwrite"|"skip_collision" } ] }
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

function todayDateStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Remove existing ##DATE ADDED= block (and continuations) */
function stripDateAddedLines(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^##DATE ADDED=/i.test(line)) {
      i++
      while (i < lines.length) {
        const next = lines[i]
        if (next.startsWith('##') || DATA_START_PATTERNS.some((p) => p.test(next))) break
        i++
      }
      continue
    }
    out.push(line)
    i++
  }
  return out
}

/** Index of first line after metadata key=value block (handles continuation lines) */
function endOfMetadataBlock(lines, startIdx) {
  let i = startIdx + 1
  while (i < lines.length) {
    const next = lines[i]
    if (next.startsWith('##') || DATA_START_PATTERNS.some((p) => p.test(next))) break
    i++
  }
  return i
}

/**
 * Insert ##DATE ADDED=<today> on the line immediately after ##OWNER= (after OWNER continuations).
 * If no OWNER, inserts after ##ORIGIN=. Strips any prior ##DATE ADDED= first.
 */
function insertDateAddedAfterOwner(content, dateStr) {
  const hadTrailingNewline = /\r?\n$/.test(content)
  let lines = content.split(/\r?\n/)
  lines = stripDateAddedLines(lines)
  const dateLine = `##DATE ADDED=${dateStr}`

  const ownerIdx = lines.findIndex((l) => /^##OWNER=/i.test(l))
  const originIdx = lines.findIndex((l) => /^##ORIGIN=/i.test(l))
  const anchorIdx = ownerIdx >= 0 ? ownerIdx : originIdx
  if (anchorIdx < 0) {
    const classIdx = lines.findIndex((l) => /^##CLASS=/i.test(l))
    const titleIdx = lines.findIndex((l) => /^##TITLE=/i.test(l))
    const idx = classIdx >= 0 ? classIdx : titleIdx
    if (idx >= 0) {
      const insertAt = endOfMetadataBlock(lines, idx)
      lines.splice(insertAt, 0, dateLine)
    } else {
      lines.unshift(dateLine)
    }
  } else {
    const insertAt = endOfMetadataBlock(lines, anchorIdx)
    lines.splice(insertAt, 0, dateLine)
  }

  let out = lines.join('\n')
  if (hadTrailingNewline && !out.endsWith('\n')) out += '\n'
  return out
}

function applyDateAddedToPath(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8')
  fs.writeFileSync(filePath, insertDateAddedAfterOwner(content, todayDateStr()), 'utf-8')
}

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

/** Keys compared for duplicate detection; order of ## lines in the file is ignored. */
const CORE_HEADER_KEYS_FOR_DUP = [
  'TITLE',
  'JCAMP-DX',
  'DATA TYPE',
  'CLASS',
  'ORIGIN',
  'OWNER',
  'NAMES',
  'CAS REGISTRY NO',
  'FUNCTIONAL GROUPS',
  'MOLFORM',
  'XUNITS',
  'YUNITS',
]

function normalizeHeaderValueForMap(s) {
  return (s ?? '')
    .toString()
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Parse all ##KEY=value lines before XYDATA into a map (uppercase keys).
 * Continuation lines (no leading ##) are folded into the value like parseJcampForEditing.
 */
function extractHeaderMap(content) {
  const lines = content.split(/\r?\n/)
  const map = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (DATA_START_PATTERNS.some((p) => p.test(line))) break
    const metaMatch = line.match(/^##([^=]+)=(.*)$/)
    if (metaMatch) {
      const key = metaMatch[1].trim().toUpperCase()
      let value = metaMatch[2]
      i++
      while (i < lines.length) {
        const next = lines[i]
        if (DATA_START_PATTERNS.some((p) => p.test(next)) || next.startsWith('##')) break
        const cont = /^\s*\+/.test(next) ? next.replace(/^\s*\+/, '').trimEnd() : next
        value = value ? `${value}\n${cont}` : cont
        i++
      }
      map[key] = normalizeHeaderValueForMap(value)
      continue
    }
    i++
  }
  return map
}

/** True if core identity fields match when compared as maps (metadata line order irrelevant). */
function coreHeaderMapsMatch(mapA, mapB) {
  for (const k of CORE_HEADER_KEYS_FOR_DUP) {
    const a = mapA[k] ?? ''
    const b = mapB[k] ?? ''
    if (a !== b) return false
  }
  return true
}

/** Check if metadata matches (on cas, title/name, or names) — legacy quick checks */
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
  const titleFromLabel = extractLabelValue(content, 'TITLE')
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
    name: (titleFromLabel ?? titleMatch?.[1] ?? path.basename(filename, path.extname(filename))).trim(),
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

/**
 * Find replaceable duplicates using **metadata values only** (not XYDATA or raw file text).
 * (1) Legacy CAS / title / names from extractMetadata.
 * (2) Core ##KEY=value map: same normalized values per field; line order in file ignored.
 */
function findReplaceableDuplicates(newMeta, newContent, existing) {
  const replaceable = existing.filter((e) => isReplaceable(e.meta))

  const legacyMeta = replaceable.filter((e) => metadataMatches(newMeta, e.meta))
  if (legacyMeta.length > 0) return legacyMeta

  const newMap = extractHeaderMap(newContent)
  return replaceable.filter((e) => {
    const exContent = fs.readFileSync(e.filePath, 'utf-8')
    return coreHeaderMapsMatch(newMap, extractHeaderMap(exContent))
  })
}

/** Get spectrum files in sample-spectra root (not in added/skipped/replaced) */
function getLooseFilesInSampleFolder() {
  if (!fs.existsSync(SAMPLE_FOLDER)) return []
  const subdirs = new Set(['added', 'skipped', 'replaced', 'README.md'])
  const files = fs.readdirSync(SAMPLE_FOLDER)
    .filter((f) => {
      if (subdirs.has(f)) return false
      const full = path.join(SAMPLE_FOLDER, f)
      if (!fs.statSync(full).isFile()) return false
      return EXTENSIONS.includes(path.extname(f).toLowerCase())
    })
    .sort()
    .map((f) => path.join(SAMPLE_FOLDER, f))
  return files
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

/** Classify one prospective import (same rules as add mode). */
function classifyImport(srcPath, existing) {
  const resolved = path.resolve(srcPath)
  if (!fs.existsSync(resolved)) {
    return { error: 'not_found', source: resolved }
  }
  const ext = path.extname(resolved).toLowerCase()
  if (!EXTENSIONS.includes(ext)) {
    return { error: 'bad_extension', source: resolved, ext }
  }
  const content = fs.readFileSync(resolved, 'utf-8')
  const newMeta = extractMetadata(content, path.basename(resolved))
  const newDataBlock = extractDataBlock(content)
  const dupes = findReplaceableDuplicates(newMeta, content, existing)
  const destBasename = path.basename(resolved)
  const addedPath = path.join(ADDED_FOLDER, destBasename)
  const skippedPath = path.join(SKIPPED_FOLDER, destBasename)

  if (dupes.length > 0) {
    const first = dupes[0]
    const matchType = metadataMatches(newMeta, first.meta) ? 'metadata' : 'metadata_header'
    return {
      kind: 'duplicate',
      source: resolved,
      destBasename,
      addedPath,
      skippedPath,
      newMeta,
      newDataBlock,
      firstDupe: first,
      matchType,
      validDecisions: ['replace', 'skip'],
    }
  }
  if (fs.existsSync(addedPath)) {
    return {
      kind: 'filename_collision',
      source: resolved,
      destBasename,
      addedPath,
      skippedPath,
      newMeta,
      newDataBlock,
      validDecisions: ['overwrite', 'skip_collision'],
    }
  }
  return {
    kind: 'new',
    source: resolved,
    destBasename,
    addedPath,
    skippedPath,
    newMeta,
    newDataBlock,
    validDecisions: ['add'],
  }
}

/**
 * Apply one import decision. Mutates `existing` array (loadExistingMetadata snapshot).
 * decision: replace|skip|add|overwrite|skip_collision
 */
function applyImportDecision(classification, existing, decision, autoYes) {
  if (classification.error) {
    return { added: 0, replaced: 0, skipped: 1, error: classification.error }
  }

  const kind = classification.kind
  const srcPath = classification.source
  const { destBasename, newMeta, newDataBlock, skippedPath, addedPath } = classification

  if (kind === 'duplicate') {
    const first = classification.firstDupe
    if (decision === 'replace') {
      fs.mkdirSync(ADDED_FOLDER, { recursive: true })
      fs.mkdirSync(REPLACED_FOLDER, { recursive: true })
      if (fs.existsSync(first.filePath)) {
        fs.renameSync(first.filePath, path.join(REPLACED_FOLDER, first.file))
      }
      fs.copyFileSync(srcPath, first.filePath)
      applyDateAddedToPath(first.filePath)
      const idx = existing.findIndex((e) => e.file === first.file)
      if (idx >= 0) {
        existing[idx].meta = newMeta
        existing[idx].dataBlock = newDataBlock
      }
      return { added: 0, replaced: 1, skipped: 0 }
    }
    if (decision === 'skip') {
      if (!autoYes) {
        fs.mkdirSync(SKIPPED_FOLDER, { recursive: true })
        fs.copyFileSync(srcPath, skippedPath)
      }
      return { added: 0, replaced: 0, skipped: 1 }
    }
    throw new Error(`Invalid decision "${decision}" for duplicate`)
  }

  if (kind === 'filename_collision') {
    if (decision === 'skip_collision') {
      if (!autoYes) {
        fs.mkdirSync(SKIPPED_FOLDER, { recursive: true })
        fs.copyFileSync(srcPath, skippedPath)
      }
      return { added: 0, replaced: 0, skipped: 1 }
    }
    if (decision !== 'overwrite') {
      throw new Error(`Invalid decision "${decision}" for filename_collision`)
    }
    fs.mkdirSync(REPLACED_FOLDER, { recursive: true })
    fs.renameSync(addedPath, path.join(REPLACED_FOLDER, destBasename))
    const idx = existing.findIndex((e) => e.file === destBasename)
    if (idx >= 0) existing.splice(idx, 1)
    // fall through to write new file like "new"
  } else if (kind === 'new') {
    if (decision !== 'add') {
      throw new Error(`Invalid decision "${decision}" for new file`)
    }
  }

  fs.mkdirSync(ADDED_FOLDER, { recursive: true })
  const isLooseInSampleFolder = path.resolve(path.dirname(srcPath)) === path.resolve(SAMPLE_FOLDER)
  if (isLooseInSampleFolder) {
    fs.renameSync(srcPath, addedPath)
  } else {
    fs.copyFileSync(srcPath, addedPath)
  }
  applyDateAddedToPath(addedPath)
  existing.push({ file: destBasename, filePath: addedPath, meta: newMeta, dataBlock: newDataBlock })
  return { added: 1, replaced: 0, skipped: 0 }
}

function analyzeMode(filePaths) {
  const expanded = expandPaths(filePaths)
  const existing = loadExistingMetadata()
  const out = []
  for (const p of expanded) {
    const c = classifyImport(p, existing)
    if (c.error) {
      out.push({
        kind: 'error',
        source: c.source,
        basename: path.basename(c.source),
        error: c.error,
        validDecisions: [],
      })
      continue
    }
    const row = {
      kind: c.kind,
      source: c.source,
      basename: c.destBasename,
      matchType: c.matchType || null,
      casNumber: c.newMeta.casNumber || null,
      title: c.newMeta.name || null,
      validDecisions: c.validDecisions,
      existingInAdded: null,
    }
    if (c.kind === 'duplicate') {
      row.existingInAdded = {
        file: c.firstDupe.file,
        path: c.firstDupe.filePath,
      }
    } else if (c.kind === 'filename_collision') {
      row.existingInAdded = {
        file: c.destBasename,
        path: c.addedPath,
      }
    }
    out.push(row)
  }
  console.log(JSON.stringify({ projectRoot: path.join(__dirname, '..'), sampleFolder: SAMPLE_FOLDER, addedFolder: ADDED_FOLDER, files: out }, null, 2))
}

function batchMode(planPath) {
  const abs = path.resolve(planPath)
  if (!fs.existsSync(abs)) {
    console.error(`Plan not found: ${abs}`)
    process.exit(1)
  }
  let plan
  try {
    plan = JSON.parse(fs.readFileSync(abs, 'utf-8'))
  } catch (e) {
    console.error('Invalid JSON plan:', e.message)
    process.exit(1)
  }
  const items = plan.items
  if (!Array.isArray(items) || items.length === 0) {
    console.error('Plan must include a non-empty "items" array.')
    process.exit(1)
  }

  const existing = loadExistingMetadata()
  let added = 0
  let replaced = 0
  let skipped = 0

  for (const item of items) {
    const src = item.source
    const decision = item.decision
    if (!src || !decision) {
      console.error('Each item needs "source" and "decision".')
      process.exit(1)
    }
    const c = classifyImport(src, existing)
    if (c.error) {
      console.warn(`Skip (${c.error}): ${src}`)
      skipped++
      continue
    }
    if (!c.validDecisions.includes(decision)) {
      console.error(`Invalid decision "${decision}" for ${src} (kind=${c.kind}, valid: ${c.validDecisions.join(', ')})`)
      process.exit(1)
    }
    const r = applyImportDecision(c, existing, decision, false)
    added += r.added
    replaced += r.replaced
    skipped += r.skipped
    console.log(`${c.destBasename}: ${decision} → +${r.added} added, +${r.replaced} replaced, +${r.skipped} skipped`)
  }

  console.log(`\nBatch done: ${added} added, ${replaced} replaced, ${skipped} skipped`)
  generateSampleSpectra()
}

async function addMode(filePaths, autoYes = false) {
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
  const rl = !autoYes ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
  const ask = async (prompt, defaultNo = true) => {
    if (autoYes) return defaultNo ? 'n' : 'y'
    return (await rl.question(prompt)).trim().toLowerCase()
  }

  let added = 0
  let replaced = 0
  let skipped = 0

  for (const rawPath of expandedPaths) {
    const c = classifyImport(rawPath, existing)
    if (c.error) {
      console.warn(`Skipping (${c.error}): ${c.source}`)
      skipped++
      continue
    }

    const destBasename = c.destBasename
    const newMeta = c.newMeta

    let decision
    if (c.kind === 'duplicate') {
      const first = c.firstDupe
      const matchType = c.matchType === 'xydata' ? 'XYDATA matches perfectly' : 'matches'
      const title = (newMeta.name || '-').slice(0, 50)
      const titleStr = (newMeta.name || '').length > 50 ? `${title}...` : title
      const prompt = `\n"${destBasename}" ${matchType} existing "${first.file}" (CAS: ${newMeta.casNumber || '-'}, Title: ${titleStr}). Replace? (y/n): `
      const answer = await ask(prompt, true)
      decision = answer === 'y' || answer === 'yes' ? 'replace' : 'skip'
    } else if (c.kind === 'filename_collision') {
      const prompt = `\n"${destBasename}" already exists in added/. Overwrite? (y/n): `
      const answer = await ask(prompt, true)
      decision = answer === 'y' || answer === 'yes' ? 'overwrite' : 'skip_collision'
    } else {
      decision = 'add'
    }

    const r = applyImportDecision(c, existing, decision, autoYes)
    added += r.added
    replaced += r.replaced
    skipped += r.skipped
    if (r.added) console.log(`  Added → added/`)
    if (r.replaced) console.log(`  Replaced → added/ (previous → replaced/)`)
    if (r.skipped && !autoYes && (decision === 'skip' || decision === 'skip_collision')) {
      console.log(`  Skipped → skipped/`)
    }
  }

  if (rl) rl.close()
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
  const analyzeIdx = args.indexOf('--analyze')
  if (analyzeIdx >= 0) {
    const filePaths = args.slice(analyzeIdx + 1)
    if (!filePaths.length) {
      console.error('Usage: node scripts/generateSampleSpectra.js --analyze <file1> [file2...] [folder/]')
      process.exit(1)
    }
    analyzeMode(filePaths)
    return
  }
  const batchIdx = args.indexOf('--batch')
  if (batchIdx >= 0) {
    const planPath = args[batchIdx + 1]
    if (!planPath) {
      console.error('Usage: node scripts/generateSampleSpectra.js --batch <plan.json>')
      process.exit(1)
    }
    batchMode(planPath)
    return
  }
  const addIdx = args.indexOf('--add')
  if (addIdx >= 0) {
    const filePaths = args.slice(addIdx + 1)
    addMode(filePaths).catch((err) => {
      console.error(err)
      process.exit(1)
    })
  } else {
    const loose = getLooseFilesInSampleFolder()
    if (loose.length > 0) {
      console.log(`Found ${loose.length} spectrum file(s) in sample-spectra/ to import.\n`)
      const autoYes = !process.stdin.isTTY
      addMode(loose, autoYes).catch((err) => {
        console.error(err)
        process.exit(1)
      })
    } else {
      generateSampleSpectra()
    }
  }
}

main()
