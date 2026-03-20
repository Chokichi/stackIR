# Sample Import Assistant (Swift + Node)

macOS SwiftUI helper for importing JCAMP-DX spectra into **BKG_Remover**. It wraps the same logic as `scripts/generateSampleSpectra.js`:

- **Watch folder**: Designate a folder where students drop `.jdx` / `.dx` / `.jcamp` files; they appear in the import list when you scan.
- **Prospective files**: Add/remove paths, merge watch-folder contents with files picked elsewhere.
- **Analyze**: Runs `node scripts/generateSampleSpectra.js --analyze …` to classify each file (`new`, `duplicate`, `filename_collision`) and learn which existing `sample-spectra/added/` file to compare.
- **Diff**: Side-by-side **incoming** vs **existing** (when applicable). Default mode is **Metadata (sorted ## keys)**: parses all `##KEY=value` fields before `##XYDATA=` (etc.) and shows **one row per tag, aligned by label** — so an extra tag on one side (e.g. `##DATE ADDED=` from import) only highlights that row, not every following line. **Full file** mode is a raw line-by-line diff (XYDATA dominates highlights). Editing only `generateSampleSpectra.js` does not change the diff until the `.jdx` bytes on disk differ.
- **Decisions**: Replace / Skip (duplicates), Overwrite / Skip (name collisions), or Add (new). Decisions go into a **queue**; select a queued item to change your mind.
- **Run import**: Writes a JSON plan and runs  
  `node scripts/generateSampleSpectra.js --batch <plan.json>`  
  which updates `sample-spectra/added/`, `skipped/`, `replaced/`, and regenerates `src/data/sampleSpectra.js`.

## Requirements

- macOS 13+
- **Node.js** installed (Homebrew `/opt/homebrew/bin/node` or `/usr/local/bin/node` is auto-detected). **GUI apps do not load your shell `PATH`**, so if Analyze fails with `env: node: no such file or directory`, paste the full path from Terminal (`which node`) into **Node executable** in the app.
- This repository checked out locally (set **BKG_Remover root** to the folder that contains `scripts/generateSampleSpectra.js`)

### Where the import logic lives

**The `.app` does not contain the importer.** It runs `node` on `scripts/generateSampleSpectra.js` inside the folder you set as **BKG_Remover root**. Any change to duplicate matching, `--analyze`, or `--batch` is in that **JavaScript file** — save it, then click **Analyze** again. You only need to run `./build-app.sh` again when you change **Swift** code.

If behavior doesn’t update, check that **BKG_Remover root** points at the same clone where you edited the script (not an old copy).

## Build & run

### Double-clickable `.app` (no Xcode)

From the package directory:

```bash
cd macos/SampleImportAssistant
./build-app.sh
open build/SampleImportAssistant.app
```

This runs `swift build -c release`, bundles `Info.plist` + the binary into `build/SampleImportAssistant.app`, and applies **ad-hoc** codesign (`codesign -s -`) for local use. No Apple Developer certificate.

If Gatekeeper still complains the first time: right-click the app → **Open** → **Open**.

### Command-line binary only

```bash
cd macos/SampleImportAssistant
swift build -c release
.build/release/SampleImportAssistant
```

(Exact path may include an architecture folder under `.build/`; use `swift build -c release --show-bin-path`.)

Or open `Package.swift` in Xcode (File → Open) and run the `SampleImportAssistant` scheme.

## Node CLI reference

| Command | Purpose |
|--------|---------|
| `npm run analyze:samples -- <files/folders>` | JSON metadata for GUI |
| `npm run import:batch -- path/to/plan.json` | Non-interactive import |
| `npm run add:samples -- …` | Interactive terminal import (unchanged) |

### Plan JSON shape (`--batch`)

```json
{
  "items": [
    { "source": "/absolute/path/to/file.jdx", "decision": "add" },
    { "source": "/path/new.jdx", "decision": "replace" },
    { "source": "/path/dupe.jdx", "decision": "skip" },
    { "source": "/path/collision.jdx", "decision": "overwrite" },
    { "source": "/path/collision2.jdx", "decision": "skip_collision" }
  ]
}
```

Decisions must match `validDecisions` from `--analyze` for that file’s `kind`.

## Workflow

1. Set **BKG_Remover project root** (once; saved in UserDefaults).
2. Optional: set **Watch folder** for student uploads; click **Scan watch folder**.
3. **Add files…** for any extra `.jdx` / `.dx` / `.jcamp` paths.
4. **Analyze all** — loads classifications from Node.
5. For each file that needs a choice, pick **Replace / Skip / Overwrite / …**; it appears in the **Decision queue**.
6. **Run import (Node)** — executes the batch script; then run `npm run build` in the project if you need a production build.
