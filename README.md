# StackIR

A browser-based toolkit for working with infrared (IR) spectra. The app is built around three tools:

- **Spectra Stacking** (home) — load, overlay, and annotate JCAMP-DX spectra and image-based spectrograms.
- **Background Remover** — chroma-key tool for cleaning scanned spectra and line art.
- **JCAMP-DX Editor** — view and edit JCAMP-DX headers and data blocks.

Built with React 19 + Vite. Originally forked from a simple chroma-key background remover; the stacking tool is now the primary surface.

## Quick Start

```bash
npm install
npm run dev
```

Open the URL shown (typically `http://localhost:5173/`). The Stacking tool is the default page; use the in-app links to switch to the Background Remover or JCAMP-DX Editor.

## Spectra Stacking (`/`)

Main tool for comparing and annotating IR spectra.

- **Load spectra**
  - **Sample library** — pre-loaded IR spectra with search (name, CAS No., functional group) and sort options (Name, CAS, Functional groups, "COS first, then name"). Entries from College of the Sequoias show a COS badge.
  - **Add JCAMP-DX file** — load your own `.jdx`, `.jcamp`, or `.dx` files.
  - **Drag and drop** — drop JCAMP-DX files anywhere on the page.
  - **Image spectra** — load an image of a spectrum and calibrate it via three reference wavenumbers (1000 / 2000 / 3000 cm⁻¹).

- **Sidebar controls**
  - Show/hide each spectrum on the plot.
  - Click the color swatch to pick a custom line color (persisted per-spectrum in `localStorage`).
  - Mark an active spectrum for region/peak editing.
  - Archive spectra to a separate tab; restore as needed.
  - Open per-spectrum metadata and adjustments (X/Y nudge, Y scale, Y min, peaks, regions).

- **Overlay modes**
  - **Stacked** — all spectra overlaid for direct comparison.
  - **Distributed vertically** — spectra spaced with a configurable gap.

- **Tools (JCAMP-DX)** — Zoom (drag or `Z`), Reset (`F`), Region (drag or `R`). Touch-friendly tap-to-place for zoom and region selection.

- **Settings** — normalize Y per spectrum, cursor wavenumber readout, wavenumber labels on peaks/regions, Transmittance vs. Absorbance Y-axis (absorbance files are converted to transmittance by default), overlay mode and gap for mobile.

- **Export**
  - **PNG / PDF** — raster export with each spectrum's custom or palette color.
  - **SVG** — vector export (JCAMP-DX only) with optional peak/region list. Exports include an "Adjustments" note at the top of the peak/region list for any spectrum with a non-default X nudge (shown in cm⁻¹), Y nudge, or Y scale.

## Background Remover (`/background-remover`)

Chroma-key tool for preparing scanned spectra or line art.

- PNG / JPG / GIF / WebP / BMP input; multi-file browsing.
- Eyedropper, hex/color-picker target color, tolerance, and edge smoothness sliders.
- Preview against a checkerboard (transparency) or a solid color.
- Crop to a two-click rectangle.
- Download as transparent PNG or send directly into the Stacking tool.

## JCAMP-DX Editor (`/jcamp-editor`)

Inspect and edit JCAMP-DX headers and data blocks.

- Edit common metadata keys (TITLE, ORIGIN, OWNER, CAS REGISTRY NO, FUNCTIONAL GROUPS, citations, instrument parameters, etc.).
- Group-edit shared fields (ORIGIN, OWNER, CITATION, SOURCE REFERENCE, DATE) across multi-block files.
- Decode and re-serialize data blocks (including AFFN normalization).
- Export single files or batch-export as a `.zip`.

## Sample library

The sample library is generated from `sample-spectra/` into `src/data/sampleSpectra.js` at build time. Scripts:

```bash
npm run generate:samples   # regenerate sampleSpectra.js from sample-spectra/
npm run add:samples        # add new files from sample-spectra/added/ and regenerate
npm run analyze:samples    # dry-run analysis of sample-spectra/added/
npm run import:batch       # batch import helper (used by the Sample Import Assistant)
```

A macOS companion app, **Sample Import Assistant** (`macos/SampleImportAssistant`), provides a GUI around these scripts for triaging and importing new spectra.

## Build

```bash
npm run build   # regenerates sample spectra, then builds with Vite
```

Output is in `dist/`.

## Other scripts

```bash
npm run lint       # eslint
npm run preview    # preview the production build
```

## Tech stack

- React 19, React Router 7
- Vite 7
- `jcampconverter` for JCAMP-DX parsing
- `jspdf` for PDF export
- `jszip` for batch export
