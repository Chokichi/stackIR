import Foundation

/// One row per metadata tag: left/right aligned by **key**, not by line index (avoids cascade when e.g. `##DATE ADDED=` exists only on one side).
struct TagDiffRow: Identifiable {
    let key: String
    let leftText: String
    let rightText: String
    /// True when normalized values differ or the tag is missing on one side.
    let isDifferent: Bool
    var id: String { key }
}

/// JCAMP header helpers so the import UI can compare metadata **semantically** (order-independent),
/// matching the spirit of `generateSampleSpectra.js` `extractHeaderMap`.
enum JcampHeaderCompare {
    private static let dataStartPrefixes = ["##XYDATA=", "##PEAK TABLE=", "##XYPOINTS=", "##DATA TABLE="]

    /// Returns text before the first spectral data block (same idea as `DATA_START_PATTERNS` in JS).
    static func sliceBeforeDataBlock(_ text: String) -> String {
        let lines = text.components(separatedBy: .newlines)
        var out: [String] = []
        for line in lines {
            let upper = line.trimmingCharacters(in: .whitespaces).uppercased()
            if dataStartPrefixes.contains(where: { upper.hasPrefix($0) }) {
                break
            }
            out.append(line)
        }
        return out.joined(separator: "\n")
    }

    /// Matches `normalizeHeaderValueForMap` in `generateSampleSpectra.js`.
    private static func normalizeValue(_ s: String) -> String {
        let t = s.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let collapsed = t.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return collapsed.trimmingCharacters(in: .whitespaces).lowercased()
    }

    /// Human-readable value (collapsed whitespace; preserves case).
    private static func displayValue(_ s: String) -> String {
        let t = s.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let collapsed = t.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return collapsed.trimmingCharacters(in: .whitespaces)
    }

    private struct FieldValue {
        let display: String
        let norm: String
    }

    /// Parse ##KEY=value (with continuations) into uppercase key → (display, normalized) values.
    private static func parseHeaderFieldMaps(_ headerText: String) -> [String: FieldValue] {
        let lines = headerText.components(separatedBy: .newlines)
        var map: [String: FieldValue] = [:]
        var i = 0
        while i < lines.count {
            let line = lines[i]
            let upper = line.trimmingCharacters(in: .whitespaces).uppercased()
            if dataStartPrefixes.contains(where: { upper.hasPrefix($0) }) {
                break
            }
            if line.hasPrefix("##"), let eq = line.firstIndex(of: "=") {
                let keyPart = line[line.index(line.startIndex, offsetBy: 2) ..< eq]
                let key = String(keyPart).trimmingCharacters(in: .whitespaces).uppercased()
                var value = String(line[line.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
                i += 1
                while i < lines.count {
                    let next = lines[i]
                    let nu = next.trimmingCharacters(in: .whitespaces).uppercased()
                    if dataStartPrefixes.contains(where: { nu.hasPrefix($0) }) {
                        break
                    }
                    if next.starts(with: "##") { break }
                    let cont: String
                    if let r = next.range(of: #"^\s*\+"#, options: .regularExpression) {
                        cont = String(next[r.upperBound...]).trimmingCharacters(in: .whitespaces)
                    } else {
                        cont = next
                    }
                    value = value.isEmpty ? cont : "\(value)\n\(cont)"
                    i += 1
                }
                map[key] = FieldValue(display: displayValue(value), norm: normalizeValue(value))
                continue
            }
            i += 1
        }
        return map
    }

    /// Parse ##KEY=value lines (with continuation lines not starting with ##) until data block.
    /// Returns map with uppercase keys, normalized values (like JS `normalizeHeaderValueForMap`).
    static func extractHeaderMap(_ headerText: String) -> [String: String] {
        parseHeaderFieldMaps(headerText).mapValues(\.norm)
    }

    /// Compare incoming vs existing **by tag key**: each row is the same metadata label on both sides.
    /// Extra keys only on one file (e.g. `DATE ADDED` after import) get one highlighted row, not a line-index cascade.
    /// - Parameter highlightDiffs: When false, rows are shown but never highlighted (e.g. new file vs empty library).
    static func alignedTagDiffRows(
        leftHeaderSlice: String,
        rightHeaderSlice: String,
        highlightDiffs: Bool = true
    ) -> [TagDiffRow] {
        let lm = parseHeaderFieldMaps(leftHeaderSlice)
        let rm = parseHeaderFieldMaps(rightHeaderSlice)
        let keys = Set(lm.keys).union(rm.keys).sorted()
        return keys.map { k in
            let lv = lm[k]
            let rv = rm[k]
            let leftLine = lv.map { "##\(k)=\($0.display)" } ?? "—"
            let rightLine = rv.map { "##\(k)=\($0.display)" } ?? "—"
            let ln = lv?.norm ?? ""
            let rn = rv?.norm ?? ""
            let diff = highlightDiffs && (ln != rn)
            return TagDiffRow(key: k, leftText: leftLine, rightText: rightLine, isDifferent: diff)
        }
    }

    /// One line per key, sorted alphabetically — used only for legacy / debugging; prefer `alignedTagDiffRows`.
    static func sortedHeaderLinesForDiff(_ headerText: String) -> String {
        let m = parseHeaderFieldMaps(headerText)
        return m.keys.sorted().map { k in
            let v = m[k]?.display ?? ""
            return "##\(k)=\(v)"
        }.joined(separator: "\n")
    }
}
