// Utilities for safely embedding multiple inline SVGs into the same page.
//
// When an SVG string (e.g. Ketcher's generated molecule SVG) is inlined via
// `innerHTML` or appended into another SVG document, its element ids join the
// host document's global id namespace. If several inlined SVGs share ids
// (Ketcher emits the same internal ids across molecules), references like
// `url(#foo)`, `href="#foo"`, or `xlink:href="#foo"` resolve to whichever
// definition was parsed last — making every overlay render using that last
// molecule's glyphs / styles. Namespacing ids per-overlay eliminates the
// collision entirely.

/**
 * Rewrite every `id`, `href`/`xlink:href`, and `url(#...)` reference inside an
 * SVG string so ids become unique to `prefix`. Returns a new SVG string; if
 * parsing fails the original is returned unchanged.
 *
 * @param {string} svgString - Raw SVG markup.
 * @param {string} prefix - Unique id prefix (e.g. the overlay id).
 * @returns {string}
 */
export function uniquifySvgIds(svgString, prefix) {
  if (!svgString || !prefix) return svgString
  try {
    const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml')
    if (doc.querySelector('parsererror')) return svgString
    const root = doc.documentElement
    if (!root) return svgString

    // Collect all ids (including on the root element) and build a rename map.
    const idMap = new Map()
    const considerId = (el) => {
      const oldId = el.getAttribute('id')
      if (!oldId || idMap.has(oldId)) return
      idMap.set(oldId, `${prefix}__${oldId}`)
    }
    considerId(root)
    root.querySelectorAll('[id]').forEach(considerId)
    if (idMap.size === 0) return svgString

    // Apply the new ids.
    const applyId = (el) => {
      const oldId = el.getAttribute('id')
      if (oldId && idMap.has(oldId)) el.setAttribute('id', idMap.get(oldId))
    }
    applyId(root)
    root.querySelectorAll('[id]').forEach(applyId)

    const urlRefRe = /url\(\s*#([^)\s]+)\s*\)/g
    const rewriteUrlRefs = (value) =>
      value.replace(urlRefRe, (match, id) =>
        idMap.has(id) ? `url(#${idMap.get(id)})` : match
      )

    const rewriteElement = (el) => {
      // href / xlink:href point at ids directly.
      for (const attrName of ['href', 'xlink:href']) {
        const v = el.getAttribute(attrName)
        if (v && v.startsWith('#')) {
          const id = v.slice(1)
          if (idMap.has(id)) el.setAttribute(attrName, `#${idMap.get(id)}`)
        }
      }
      // Any attribute can carry url(#id) references (e.g. fill, stroke,
      // clip-path, mask, filter, style).
      const attrs = el.attributes
      for (let i = 0; i < attrs.length; i += 1) {
        const a = attrs[i]
        if (a.value && a.value.includes('url(#')) {
          const next = rewriteUrlRefs(a.value)
          if (next !== a.value) el.setAttribute(a.name, next)
        }
      }
    }

    rewriteElement(root)
    root.querySelectorAll('*').forEach(rewriteElement)

    // <style> text content can also reference ids via url(#id).
    root.querySelectorAll('style').forEach((styleEl) => {
      const v = styleEl.textContent || ''
      const next = rewriteUrlRefs(v)
      if (next !== v) styleEl.textContent = next
    })

    return new XMLSerializer().serializeToString(root)
  } catch {
    return svgString
  }
}
