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
          { term: 'Sample library', desc: 'Load pre-loaded IR spectra. Search by name, CAS No., or functional group; sort by Name, CAS, or Functional groups. Click Add or double-click a row. Entries from College of the Sequoias show a COS label in the list.' },
          { term: 'Add JCAMP-DX file', desc: 'Load your own spectra. Supports .jdx, .jcamp, and .dx files.' },
          { term: 'Drag and drop', desc: 'Drop JCAMP-DX files onto the page to add them to the list.' },
        ],
      },
      {
        title: 'Spectra list (sidebar)',
        items: [
          { term: 'Show on plot', desc: 'The eye icon toggles whether that spectrum is drawn. Hidden spectra stay in the list.' },
          { term: 'Line color', desc: 'Click or tap the color swatch beside a spectrum to open the color picker. The default palette is color-blind friendly with strong contrast on white. Custom colors apply to the plot, stacked image exports, and SVG legend; they are saved with the spectrum in this browser.' },
          { term: 'Line style', desc: 'The small line swatch next to the color picker cycles through solid, dashed, dotted, and dash-dot patterns. Useful when colors alone are hard to distinguish (color-blind viewers, grayscale printing, or many overlapping spectra). The style is reflected in the plot and exported legends.' },
          { term: 'Active spectrum', desc: 'The round control marks the spectrum used for the Region tool and related edits. Only appears when you have JCAMP-DX data loaded.' },
          { term: 'Archive', desc: 'The × control moves a spectrum to the Archive tab. Use Restore to bring it back. The archive is cleared if you reload the page.' },
          { term: 'Metadata & Adjust', desc: 'Open JCAMP header details, fine-tune X/Y nudge and scale, and expand Peaks & Regions from the row controls.' },
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
          { term: 'Insert (structure)', desc: 'Open the Ketcher molecule editor to draw a structure. You can add an optional label in the editor footer; saved structures appear as draggable cards over the spectrum and are included in exports.' },
        ],
      },
      {
        title: 'Structure overlays',
        items: [
          { term: 'Move', desc: 'Click and drag a structure card to reposition it. Dragging on empty plot area still zooms or selects regions as usual.' },
          { term: 'Resize', desc: 'Drag the bottom-right corner of a card to resize.' },
          { term: 'Edit', desc: 'Double-click a structure to re-open it in the Ketcher editor.' },
          { term: 'Label', desc: 'Click the caption at the top of a structure to add or rename its label. Labels appear on exports in the same position as on screen.' },
          { term: 'Link border color', desc: 'Click the link icon next to the label and pick a spectrum to match its color. The border stays in sync if you later recolor that spectrum. Choose “None” to return to the default gray border.' },
          { term: 'Delete', desc: 'Click the × in the top-right corner of a card. Overlays are saved in this browser.' },
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
          { term: 'PNG / PDF', desc: 'Export the stacked spectra as an image. Lines use each spectrum\'s color and line style (dashed / dotted / etc.), so plots stay readable in grayscale or for color-blind viewers.' },
          { term: 'SVG', desc: 'Vector format (JCAMP-DX only). Optionally include peak/region list. The exported legend shows a mini line sample in the spectrum\'s color and dash pattern.' },
        ],
      },
      {
        title: 'Spectrum adjustments',
        items: [
          { term: 'X nudge ±', desc: 'Shift spectrum horizontally (for alignment).' },
          { term: 'Y nudge ±', desc: 'Shift spectrum vertically.' },
          { term: 'Y scale ±', desc: 'Scale the spectrum vertically.' },
          { term: 'Y min (JCAMP-DX)', desc: 'Next to the scale hint, use Y min +/− to raise or lower the plot baseline (flatten or sharpen peaks). Resets with Reset zoom.' },
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
    <div className="modal-overlay help-modal-overlay" onClick={onClose}>
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
