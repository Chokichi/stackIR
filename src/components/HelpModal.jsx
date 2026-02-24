import './HelpModal.css'

const HelpIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)

const HELP_CONTENT = {
  stacking: {
    title: 'Spectra Stacking',
    sections: [
      {
        title: 'Getting started',
        items: [
          { term: 'Sample library', desc: 'Load pre-loaded IR spectra. Search by name, CAS No, or functional group; sort by Name, CAS, or Functional groups. Click Add or double-click a row.' },
          { term: 'Add JCAMP-DX file', desc: 'Load your own spectra. Supports .jdx, .jcamp, and .dx files.' },
        ],
      },
      {
        title: 'Overlay modes',
        items: [
          { term: 'Stacked', desc: 'Spectra overlay on top of each other for comparison.' },
          { term: 'Distributed vertically', desc: 'Spectra are stacked with a gap between them. Use the Gap slider to adjust spacing.' },
        ],
      },
      {
        title: 'Tools (JCAMP-DX spectra only)',
        items: [
          { term: 'Zoom', desc: 'Drag on the plot to zoom into a region. Keyboard: Z.' },
          { term: 'Reset zoom', desc: 'Restore full view and reset Y-axis. Keyboard: F.' },
          { term: 'Region', desc: 'Drag to add a shaded region between two wavenumbers. Keyboard: R.' },
        ],
      },
      {
        title: 'Touch / mobile',
        items: [
          { term: 'Zoom or region', desc: 'Tap once to place the first point, then tap again (or drag) for the second point.' },
          { term: 'Region boundaries', desc: 'After placing a region, use Left ± and Right ± to adjust, then Confirm.' },
        ],
      },
      {
        title: 'Settings',
        items: [
          { term: 'Normalize Y per spectrum', desc: 'Scale each spectrum to 0–1 for overlay comparison.' },
          { term: 'Show wavenumber at cursor', desc: 'Display wavenumber while hovering over the spectrum.' },
          { term: 'Show wavenumbers in labels', desc: 'Append wavenumber range to peak/region labels.' },
        { term: 'Y-axis display', desc: 'Switch between Transmittance (default) and Absorbance. Absorbance files are converted to transmittance by default.' },
        ],
      },
      {
        title: 'Export',
        items: [
          { term: 'PNG / PDF', desc: 'Export the stacked spectra as an image.' },
          { term: 'SVG', desc: 'Vector format (JCAMP-DX only). Optionally include peak/region list.' },
        ],
      },
      {
        title: 'Spectrum adjustments',
        items: [
          { term: 'X nudge ±', desc: 'Shift spectrum horizontally (for alignment).' },
          { term: 'Y nudge ±', desc: 'Shift spectrum vertically.' },
          { term: 'Y scale ±', desc: 'Scale the spectrum vertically.' },
          { term: 'Peak grouping', desc: 'Select peaks and use Group selected to combine labels.' },
        ],
      },
      {
        title: 'Calibration (image spectra)',
        items: [
          { term: 'Calibrate reference', desc: 'Click three known wavenumber positions (1000, 2000, 3000 cm⁻¹) to calibrate the X-axis.' },
          { term: 'Calibrate spectrum', desc: 'For each added image spectrum, calibrate it the same way if needed.' },
        ],
      },
    ],
  },
  backgroundRemover: {
    title: 'Background Remover',
    sections: [
      {
        title: 'Overview',
        items: [
          { term: 'Purpose', desc: 'Remove a solid background color from line art or spectrum images using chroma key. Useful for preparing scans for the stacking tool.' },
        ],
      },
      {
        title: 'Upload',
        items: [
          { term: 'Supported formats', desc: 'PNG, JPG, GIF, WebP, BMP.' },
          { term: 'Multiple files', desc: 'Upload several images and switch between them using the arrows.' },
        ],
      },
      {
        title: 'Color picking',
        items: [
          { term: 'Eyedropper', desc: 'Click the eyedropper, then click on the image to sample the background color to remove.' },
          { term: 'Target color', desc: 'The sampled color. You can also pick manually from the color picker.' },
          { term: 'Tolerance', desc: 'How closely colors must match the target. Higher = more pixels removed (may eat into lines).' },
          { term: 'Smoothness', desc: 'Edge feathering. Higher = softer transitions.' },
        ],
      },
      {
        title: 'Preview',
        items: [
          { term: 'Checkerboard', desc: 'Toggle to show removed areas as a checkerboard (transparent).' },
          { term: 'Background color', desc: 'Choose a solid color to preview the result on different backgrounds.' },
        ],
      },
      {
        title: 'Crop',
        items: [
          { term: 'Crop mode', desc: 'Click Crop, then click two corners of the region to keep. The area outside is discarded.' },
        ],
      },
      {
        title: 'Output',
        items: [
          { term: 'Download', desc: 'Save the processed image as PNG (with transparency).' },
          { term: 'Send to Stacking', desc: 'Add the processed image to the Spectra Stacking tool.' },
        ],
      },
    ],
  },
}

export function HelpModal({ open, onClose, page = 'stacking' }) {
  if (!open) return null

  const content = HELP_CONTENT[page] || HELP_CONTENT.stacking

  return (
    <div className="help-modal-overlay" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-modal-header">
          <h2>Help — {content.title}</h2>
          <button type="button" onClick={onClose} className="ghost small help-modal-close" aria-label="Close">×</button>
        </div>
        <div className="help-modal-body">
          {content.sections.map((section) => (
            <section key={section.title} className="help-section">
              <h3>{section.title}</h3>
              <dl>
                {section.items.map(({ term, desc }) => (
                  <div key={term} className="help-item">
                    <dt>{term}</dt>
                    <dd>{desc}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <div className="help-modal-footer">
          <button type="button" onClick={onClose} className="primary">Got it</button>
        </div>
      </div>
    </div>
  )
}

export { HelpIcon }
