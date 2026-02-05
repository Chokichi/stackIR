# Chroma Key Background Remover

A simple React app for removing backgrounds from images using chroma keying. Ideal for line art, spectra graphs, and other black-and-white images with white or colored backgrounds.

## Features

- **Image upload** — Drag & drop or click to browse. Supports PNG, JPG, GIF, WebP, and BMP.
- **Color selection** — Enter a hex code, use the color picker, or use the eyedropper to click a pixel on the image.
- **Adjustments**
  - **Tolerance** — How closely pixels must match the target color to be removed (higher = more removal).
  - **Edge smoothness** — Softens the transition at edges for cleaner results.
- **Download** — Export as PNG with transparency.

## Quick Start

```bash
npm install
npm run dev
```

Open the URL shown (typically http://localhost:5173/).

## Usage

1. Upload an image (e.g., a spectra graph with a white background).
2. Set the target color:
   - Type a hex value (e.g. `#ffffff` for white).
   - Or click **Eyedropper** and click on the background in the image.
3. Adjust **Tolerance** if needed (15–25% works well for white backgrounds).
4. Click **Remove background**.
5. Use **Download PNG** to save the transparent image.

## Build

```bash
npm run build
```

Output is in `dist/`.
