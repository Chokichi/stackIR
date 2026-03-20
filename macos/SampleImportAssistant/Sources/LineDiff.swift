import Foundation

/// Simple line-based diff for side-by-side display (not a full Myers diff).
enum LineDiff {
    struct MarkedLine: Identifiable {
        let id = UUID()
        let text: String
        let isDifferent: Bool
    }

    static func marked(leftLines: [String], rightLines: [String]) -> (left: [MarkedLine], right: [MarkedLine]) {
        let maxCount = max(leftLines.count, rightLines.count)
        var leftOut: [MarkedLine] = []
        var rightOut: [MarkedLine] = []
        for i in 0..<maxCount {
            let l = i < leftLines.count ? leftLines[i] : ""
            let r = i < rightLines.count ? rightLines[i] : ""
            let diff = l != r
            leftOut.append(MarkedLine(text: l.isEmpty && i >= leftLines.count ? " " : l, isDifferent: diff))
            rightOut.append(MarkedLine(text: r.isEmpty && i >= rightLines.count ? " " : r, isDifferent: diff))
        }
        return (leftOut, rightOut)
    }

    static func splitLines(_ text: String) -> [String] {
        text.split(whereSeparator: \.isNewline).map(String.init)
    }
}
