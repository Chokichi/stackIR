import Foundation

// MARK: - Analyze JSON (from Node --analyze)

struct AnalyzeEnvelope: Codable {
    let projectRoot: String
    let sampleFolder: String
    let addedFolder: String
    let files: [AnalyzeFileRow]
}

struct AnalyzeFileRow: Codable, Identifiable {
    var id: String { source }
    let kind: String
    let source: String
    let basename: String
    let matchType: String?
    let casNumber: String?
    let title: String?
    let validDecisions: [String]
    let existingInAdded: ExistingInAdded?
    let error: String?
    struct ExistingInAdded: Codable {
        let file: String
        let path: String
    }
}

// MARK: - Batch plan (to Node --batch)

struct BatchPlan: Codable {
    var items: [BatchItem]
}

struct BatchItem: Codable {
    let source: String
    let decision: String
}

// MARK: - UI state

enum ImportDecision: String, CaseIterable, Identifiable {
    case replace, skip, add, overwrite, skip_collision
    var id: String { rawValue }
    var label: String {
        switch self {
        case .replace: return "Replace"
        case .skip: return "Skip"
        case .add: return "Add"
        case .overwrite: return "Overwrite"
        case .skip_collision: return "Skip (keep existing)"
        }
    }
}

struct ProspectiveFile: Identifiable, Hashable {
    var id: String { url.path }
    var url: URL
}

struct QueuedDecision: Identifiable {
    let id = UUID()
    var sourceURL: URL
    var analyze: AnalyzeFileRow
    var decision: ImportDecision
}
