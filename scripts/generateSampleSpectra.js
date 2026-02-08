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

function extractMetadata(content, filename) {
  const casMatch = content.match(/##CAS REGISTRY NO=\s*(\S+)/i)
  const titleMatch = content.match(/##TITLE=(.+?)(?:\r?\n|$)/i)
  const casFromFilename = filename.match(/(\d+-\d+-\d+)/)
  return {
    casNumber: (casMatch?.[1] ?? casFromFilename?.[1] ?? '').trim(),
    name: (titleMatch?.[1] ?? path.basename(filename, path.extname(filename))).trim(),
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
    const { casNumber, name } = extractMetadata(content, file)
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
