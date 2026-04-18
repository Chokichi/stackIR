import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// What to compare in the side-by-side panel (default matches duplicate logic: metadata maps, not raw line order).
private enum DiffCompareMode: String, CaseIterable, Identifiable {
    case metadataSorted
    case fullFile
    var id: String { rawValue }
    var label: String {
        switch self {
        case .metadataSorted: return "Metadata (sorted ## keys)"
        case .fullFile: return "Full file"
        }
    }
}

struct ContentView: View {
    @AppStorage("bkgProjectRoot") private var projectRootPath: String = ""
    @AppStorage("watchFolderPath") private var watchFolderPath: String = ""
    /// Optional full path to `node` (e.g. output of `which node`). Leave empty to try Homebrew / nvm defaults.
    @AppStorage("nodeExecutablePath") private var nodeExecutablePath: String = ""

    @State private var prospectiveFiles: [ProspectiveFile] = []
    @State private var analyzeBySource: [String: AnalyzeFileRow] = [:]
    @State private var selectedFile: ProspectiveFile?
    @State private var decisionQueue: [QueuedDecision] = []
    @State private var leftLines: [LineDiff.MarkedLine] = []
    @State private var rightLines: [LineDiff.MarkedLine] = []
    /// Metadata mode: rows keyed by `##` tag so extra lines (e.g. `DATE ADDED`) don’t shift highlights.
    @State private var metadataTagRows: [TagDiffRow] = []
    @State private var diffCompareMode: DiffCompareMode = .metadataSorted
    /// Bumped after each `loadDiff` so the scroll view can jump to the first mismatch.
    @State private var diffScrollEpoch: Int = 0
    /// Canonical incoming path → which `added/` basename to replace when multiple CAS matches exist.
    @State private var replaceTargetBySource: [String: String] = [:]
    @State private var statusMessage: String = "Set project root, add files, then Analyze."
    @State private var isRunningNode = false
    @State private var lastNodeLog: String = ""

    private var projectRoot: URL? {
        let u = URL(fileURLWithPath: projectRootPath, isDirectory: true)
        return projectRootPath.isEmpty ? nil : u
    }

    /// Node emits absolute paths; Swift file URLs may differ (symlinks). Use one key style for lookups.
    private func canonicalPathKey(for url: URL) -> String {
        url.resolvingSymlinksInPath().path
    }

    private func canonicalPathKey(for path: String) -> String {
        URL(fileURLWithPath: path).resolvingSymlinksInPath().path
    }

    private var importScriptPath: String {
        guard let root = projectRoot else { return "" }
        return root.appendingPathComponent("scripts/generateSampleSpectra.js", isDirectory: false).path
    }

    private var importScriptExists: Bool {
        !importScriptPath.isEmpty && FileManager.default.fileExists(atPath: importScriptPath)
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selectedFile) {
                Section("Prospective imports") {
                    ForEach(prospectiveFiles) { f in
                        Text(f.url.lastPathComponent)
                            .tag(f)
                    }
                    .onDelete { idx in
                        prospectiveFiles.remove(atOffsets: idx)
                        syncSelection()
                    }
                }
                Section("Decision queue (\(decisionQueue.count))") {
                    ForEach(decisionQueue) { q in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(q.sourceURL.lastPathComponent)
                                    .font(.headline)
                                Text(q.decision.label)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Remove") {
                                decisionQueue.removeAll { $0.id == q.id }
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 220, ideal: 280)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    settingsBar
                    HStack(alignment: .top, spacing: 16) {
                        decisionPanel
                        diffPanel
                    }
                    logArea
                }
                .padding()
                .frame(minWidth: 520)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onChange(of: selectedFile) { newVal in
            loadDiff(for: newVal)
        }
        .onChange(of: diffCompareMode) { _ in
            loadDiff(for: selectedFile)
        }
    }

    private var settingsBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("BKG_Remover root:")
                TextField("/path/to/BKG_Remover", text: $projectRootPath)
                    .textFieldStyle(.roundedBorder)
                Button("Choose…") {
                    pickProjectRoot()
                }
            }
            if !projectRootPath.isEmpty {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: importScriptExists ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(importScriptExists ? .green : .orange)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Import logic is not inside this .app — Node runs this file:")
                            .font(.caption)
                        Text(importScriptPath.isEmpty ? "—" : importScriptPath)
                            .font(.caption)
                            .textSelection(.enabled)
                            .foregroundStyle(.secondary)
                        if !importScriptExists {
                            Text("File not found. Set root to your git clone where you edit scripts/generateSampleSpectra.js")
                                .font(.caption2)
                                .foregroundStyle(.orange)
                        } else {
                            Text("Edit that script to change matching; then **Analyze** again (rebuilding the .app is optional).")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            HStack(alignment: .top) {
                Text("Node executable:")
                VStack(alignment: .leading, spacing: 4) {
                    TextField("Optional — auto-detects Homebrew / nvm", text: $nodeExecutablePath)
                        .textFieldStyle(.roundedBorder)
                    Text("If Analyze fails, run `which node` in Terminal and paste the full path here.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            HStack {
                Text("Watch folder:")
                TextField("Optional — student uploads", text: $watchFolderPath)
                    .textFieldStyle(.roundedBorder)
                Button("Choose…") {
                    pickWatchFolder()
                }
                Button("Scan watch folder") {
                    scanWatchFolder()
                }
                .disabled(watchFolderPath.isEmpty)
            }
            HStack {
                Button("Add files…") { addFiles() }
                Button("Analyze all") { Task { await runAnalyze() } }
                    .disabled(projectRoot == nil || prospectiveFiles.isEmpty)
                Button("Run import (Node)") { Task { await runBatchImport() } }
                    .disabled(projectRoot == nil || decisionQueue.isEmpty)
                Spacer()
            }
            HStack {
                Button("Clear prospective + queue") {
                    clearProspectiveAndQueue()
                }
                .disabled(prospectiveFiles.isEmpty && decisionQueue.isEmpty)
                Spacer()
            }
        }
    }

    private var decisionPanel: some View {
        GroupBox("Decision") {
            VStack(alignment: .leading, spacing: 8) {
                if let sel = selectedFile, let row = analyzeBySource[canonicalPathKey(for: sel.url)] {
                    Text("Kind: \(row.kind)").font(.subheadline).fontWeight(.semibold)
                    if let mt = row.matchType {
                        Text("Match: \(matchTypeLabel(mt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let candidates = row.duplicateCandidates ?? row.casCandidates, !candidates.isEmpty, row.kind == "duplicate" {
                        Text(duplicateCandidatesLabel(row.matchType))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Picker("Replace which file", selection: replaceTargetBinding(sourceURL: sel.url, row: row, candidates: candidates)) {
                            ForEach(candidates) { c in
                                Text(c.file).tag(c.file)
                            }
                        }
                        .labelsHidden()
                    } else if let ex = row.existingInAdded {
                        Text("Existing in library: \(ex.file)")
                            .font(.caption)
                    }
                    Divider()
                    let allowed = decisions(for: row)
                    ForEach(allowed, id: \.self) { d in
                        Button {
                            enqueueDecision(url: sel.url, row: row, decision: d)
                        } label: {
                            Label(d.label, systemImage: "checkmark.circle")
                        }
                        .disabled(queueContains(url: sel.url))
                    }
                    if queueContains(url: sel.url) {
                        Text("Already in queue — remove from queue to re-decide.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                } else {
                    Text("Select a file and run Analyze.")
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: 280, alignment: .leading)
        }
    }

    private var diffPanel: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Compare:")
                    Picker("Compare", selection: $diffCompareMode) {
                        ForEach(DiffCompareMode.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                Text(compareModeFootnote)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Group {
                    if diffCompareMode == .metadataSorted, !metadataTagRows.isEmpty {
                        tagAlignedMetadataView
                    } else {
                        fullFilePairedDiffView
                    }
                }
                // Keep comparison pane bounded so large diffs scroll in-place.
                .frame(minHeight: 240, idealHeight: 320, maxHeight: 420)
            }
        } label: {
            Text("Side-by-side (yellow = different line)")
        }
    }

    private var compareModeFootnote: String {
        switch diffCompareMode {
        case .metadataSorted:
            return "Each row is one metadata tag (aligned by ## label). Values match `generateSampleSpectra.js` normalization. Extra tags such as DATE ADDED only highlight on that row."
        case .fullFile:
            return "Raw line diff including spectral data. Large XYDATA blocks dominate highlights."
        }
    }

    private var tagAlignedMetadataView: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Text("Incoming")
                    .font(.caption)
                    .padding(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(nsColor: .quaternaryLabelColor).opacity(0.2))
                Text("Existing in added/")
                    .font(.caption)
                    .padding(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(nsColor: .quaternaryLabelColor).opacity(0.2))
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(metadataTagRows) { row in
                            HStack(alignment: .top, spacing: 0) {
                                Text(row.leftText)
                                    .font(.system(.body, design: .monospaced))
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 2)
                                    .background(row.isDifferent ? Color.yellow.opacity(0.25) : Color.clear)
                                Divider()
                                Text(row.rightText)
                                    .font(.system(.body, design: .monospaced))
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 2)
                                    .background(row.isDifferent ? Color.yellow.opacity(0.25) : Color.clear)
                            }
                            .id(row.id)
                        }
                    }
                }
                .onChange(of: diffScrollEpoch) { _ in
                    scrollMetadataToFirstMismatch(proxy: proxy)
                }
            }
        }
    }

    /// Full file: paired rows in one scroll so we can scroll both columns to the first differing line.
    private var fullFilePairedDiffView: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                Text("Incoming")
                    .font(.caption)
                    .padding(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(nsColor: .quaternaryLabelColor).opacity(0.2))
                Text("Existing in added/")
                    .font(.caption)
                    .padding(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(nsColor: .quaternaryLabelColor).opacity(0.2))
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(0..<leftLines.count, id: \.self) { i in
                            HStack(alignment: .top, spacing: 0) {
                                Text(leftLines[i].text)
                                    .font(.system(.body, design: .monospaced))
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(leftLines[i].isDifferent ? Color.yellow.opacity(0.25) : Color.clear)
                                Divider()
                                Text(rightLines[i].text)
                                    .font(.system(.body, design: .monospaced))
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(rightLines[i].isDifferent ? Color.yellow.opacity(0.25) : Color.clear)
                            }
                            .id(fullFileRowId(i))
                        }
                    }
                }
                .onChange(of: diffScrollEpoch) { _ in
                    scrollFullFileToFirstMismatch(proxy: proxy)
                }
            }
        }
    }

    private func fullFileRowId(_ index: Int) -> String {
        "fullfile-line-\(index)"
    }

    /// Scroll after layout (LazyVStack) so the target row exists.
    private func scrollMetadataToFirstMismatch(proxy: ScrollViewProxy) {
        guard let id = metadataTagRows.first(where: { $0.isDifferent })?.id else { return }
        DispatchQueue.main.async {
            DispatchQueue.main.async {
                withAnimation(.easeInOut(duration: 0.2)) {
                    proxy.scrollTo(id, anchor: .top)
                }
            }
        }
    }

    private func scrollFullFileToFirstMismatch(proxy: ScrollViewProxy) {
        guard let i = leftLines.firstIndex(where: { $0.isDifferent }) else { return }
        let target = fullFileRowId(i)
        DispatchQueue.main.async {
            DispatchQueue.main.async {
                withAnimation(.easeInOut(duration: 0.2)) {
                    proxy.scrollTo(target, anchor: .top)
                }
            }
        }
    }

    private var logArea: some View {
        GroupBox("Node output") {
            ScrollView {
                Text(lastNodeLog.isEmpty ? statusMessage : lastNodeLog)
                    .font(.system(.caption, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 100)
        }
    }

    private func matchTypeLabel(_ raw: String) -> String {
        switch raw {
        case "cas": return "##CAS REGISTRY NO= (library match)"
        case "metadata": return "metadata (CAS / title / names)"
        case "metadata_header": return "metadata (core ## fields)"
        case "xydata": return "##XYDATA= (spectral data)"
        default: return raw
        }
    }

    private func duplicateCandidatesLabel(_ matchType: String?) -> String {
        switch matchType {
        case "cas": return "Same ##CAS REGISTRY NO= as these library file(s). Choose which to replace:"
        case "xydata": return "Same ##XYDATA= (spectral data) as these library file(s). Choose which to replace:"
        default: return "Matching library file(s). Choose which to replace:"
        }
    }

    private func replaceTargetBinding(sourceURL: URL, row: AnalyzeFileRow, candidates: [CasCandidate]) -> Binding<String> {
        let key = canonicalPathKey(for: sourceURL)
        let fallback = candidates.first?.file ?? ""
        return Binding(
            get: { replaceTargetBySource[key] ?? fallback },
            set: { newVal in
                replaceTargetBySource[key] = newVal
                loadDiff(for: selectedFile)
            }
        )
    }

    /// Path to the library file shown in the diff (respects replace-target picker).
    private func existingLibraryPathForDiff(row: AnalyzeFileRow, sourceURL: URL) -> String? {
        let key = canonicalPathKey(for: sourceURL)
        let candidates = row.duplicateCandidates ?? row.casCandidates
        if let list = candidates, !list.isEmpty {
            let basename = replaceTargetBySource[key] ?? list[0].file
            return list.first(where: { $0.file == basename })?.path
        }
        return row.existingInAdded?.path
    }

    private func decisions(for row: AnalyzeFileRow) -> [ImportDecision] {
        row.validDecisions.compactMap { ImportDecision(rawValue: $0) }
    }

    private func queueContains(url: URL) -> Bool {
        decisionQueue.contains { $0.sourceURL == url }
    }

    private func enqueueDecision(url: URL, row: AnalyzeFileRow, decision: ImportDecision) {
        decisionQueue.removeAll { $0.sourceURL == url }
        let replaceTarget: String? = {
            guard decision == .replace, row.kind == "duplicate" else { return nil }
            let key = canonicalPathKey(for: url)
            let candidates = row.duplicateCandidates ?? row.casCandidates
            if let list = candidates, !list.isEmpty {
                return replaceTargetBySource[key] ?? list[0].file
            }
            return row.existingInAdded?.file
        }()
        decisionQueue.append(
            QueuedDecision(
                sourceURL: url,
                analyze: row,
                decision: decision,
                replaceTargetFile: replaceTarget
            )
        )
        statusMessage = "Queued \(url.lastPathComponent) → \(decision.label)"
        advanceSelection(afterDeciding: url)
    }

    /// Move selection to the next prospective file that still needs a decision (list order after current).
    private func advanceSelection(afterDeciding url: URL) {
        guard let idx = prospectiveFiles.firstIndex(where: { $0.url == url }) else { return }
        var i = idx + 1
        while i < prospectiveFiles.count {
            let next = prospectiveFiles[i]
            if !queueContains(url: next.url) {
                selectedFile = next
                return
            }
            i += 1
        }
        if let stillNeeds = prospectiveFiles.first(where: { !queueContains(url: $0.url) }) {
            selectedFile = stillNeeds
            return
        }
        selectedFile = nil
    }

    private func loadDiff(for file: ProspectiveFile?) {
        leftLines = []
        rightLines = []
        metadataTagRows = []
        guard let file,
              let row = analyzeBySource[canonicalPathKey(for: file.url)],
              row.kind != "error" else { return }
        let incoming = (try? String(contentsOf: file.url, encoding: .utf8)) ?? ""
        var existingText = ""
        if let exPath = existingLibraryPathForDiff(row: row, sourceURL: file.url) {
            existingText = (try? String(contentsOf: URL(fileURLWithPath: exPath), encoding: .utf8)) ?? ""
        }
        let isPlaceholder = row.kind == "new" && existingText.isEmpty
        if isPlaceholder {
            existingText = "(No file in library yet — this will be added.)"
        }

        switch diffCompareMode {
        case .fullFile:
            let leftSource = incoming
            let rightSource = existingText
            let a = LineDiff.splitLines(leftSource)
            let b = LineDiff.splitLines(rightSource)
            let pair = LineDiff.marked(leftLines: a, rightLines: b)
            leftLines = pair.left
            rightLines = pair.right
        case .metadataSorted:
            if isPlaceholder {
                let hdr = JcampHeaderCompare.sliceBeforeDataBlock(incoming)
                metadataTagRows = JcampHeaderCompare.alignedTagDiffRows(
                    leftHeaderSlice: hdr,
                    rightHeaderSlice: "",
                    highlightDiffs: false
                )
            } else {
                let inc = JcampHeaderCompare.sliceBeforeDataBlock(incoming)
                let ex = JcampHeaderCompare.sliceBeforeDataBlock(existingText)
                metadataTagRows = JcampHeaderCompare.alignedTagDiffRows(
                    leftHeaderSlice: inc,
                    rightHeaderSlice: ex,
                    highlightDiffs: true
                )
            }
        }
        diffScrollEpoch += 1
    }

    private func syncSelection() {
        if let s = selectedFile, !prospectiveFiles.contains(s) {
            selectedFile = prospectiveFiles.first
        }
        loadDiff(for: selectedFile)
    }

    private func pickProjectRoot() {
        let p = NSOpenPanel()
        p.canChooseFiles = false
        p.canChooseDirectories = true
        p.allowsMultipleSelection = false
        if p.runModal() == .OK, let url = p.url {
            projectRootPath = url.path
        }
    }

    private func pickWatchFolder() {
        let p = NSOpenPanel()
        p.canChooseFiles = false
        p.canChooseDirectories = true
        p.allowsMultipleSelection = false
        if p.runModal() == .OK, let url = p.url {
            watchFolderPath = url.path
        }
    }

    private func scanWatchFolder() {
        let dir = URL(fileURLWithPath: watchFolderPath, isDirectory: true)
        guard let urls = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
        let allowed = ["jdx", "dx", "jcamp"]
        for u in urls where u.hasDirectoryPath == false {
            let ext = u.pathExtension.lowercased()
            guard allowed.contains(ext) else { continue }
            if !prospectiveFiles.contains(where: { $0.url == u }) {
                prospectiveFiles.append(ProspectiveFile(url: u))
            }
        }
        statusMessage = "Watch folder scan complete."
    }

    private func addFiles() {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = true
        p.allowedContentTypes = ["jdx", "dx", "jcamp"].compactMap { UTType(filenameExtension: $0) }
        if p.runModal() == .OK {
            for url in p.urls {
                if !prospectiveFiles.contains(where: { $0.url == url }) {
                    prospectiveFiles.append(ProspectiveFile(url: url))
                }
            }
        }
    }

    private func runAnalyze() async {
        guard let root = projectRoot else {
            statusMessage = "Set project root first."
            return
        }
        isRunningNode = true
        defer { isRunningNode = false }
        do {
            let env = try NodeRunner.analyze(
                projectRoot: root,
                paths: prospectiveFiles.map(\.url),
                nodeExecutable: nodeExecutablePath.isEmpty ? nil : nodeExecutablePath
            )
            analyzeBySource = Dictionary(uniqueKeysWithValues: env.files.map { (canonicalPathKey(for: $0.source), $0) })
            replaceTargetBySource = Dictionary(uniqueKeysWithValues: env.files.compactMap { row -> (String, String)? in
                let candidates = row.duplicateCandidates ?? row.casCandidates
                guard let first = candidates?.first else { return nil }
                return (canonicalPathKey(for: row.source), first.file)
            })
            statusMessage = "Analyzed \(env.files.count) file(s)."
            let previousSelection = selectedFile
            selectedFile = prospectiveFiles.first
            // If selection changed, `onChange(of: selectedFile)` loads the diff; if unchanged, reload here so new analyze results apply.
            if previousSelection == selectedFile {
                loadDiff(for: selectedFile)
            }
        } catch {
            statusMessage = "Analyze failed: \(error.localizedDescription)"
        }
    }

    private func runBatchImport() async {
        guard let root = projectRoot else { return }
        let plan = BatchPlan(items: decisionQueue.map {
            BatchItem(
                source: $0.sourceURL.path,
                decision: $0.decision.rawValue,
                replaceTargetFile: $0.replaceTargetFile
            )
        })
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("bkg-import-\(UUID().uuidString).json")
        do {
            let data = try JSONEncoder().encode(plan)
            try data.write(to: temp)
            lastNodeLog = try NodeRunner.batch(
                projectRoot: root,
                planURL: temp,
                nodeExecutable: nodeExecutablePath.isEmpty ? nil : nodeExecutablePath
            )
            statusMessage = "Import finished. Run `npm run build` in the project if needed."
            try? FileManager.default.removeItem(at: temp)
            removeQueuedFilesFromWatchFolder()
            refreshProspectiveImportsAfterImport()
        } catch {
            lastNodeLog = error.localizedDescription
            statusMessage = "Batch failed."
        }
    }

    /// Delete queued source files that live in the watch folder (Node has already copied them to added/).
    private func removeQueuedFilesFromWatchFolder() {
        guard !watchFolderPath.isEmpty else { return }
        let watchURL = URL(fileURLWithPath: watchFolderPath, isDirectory: true).resolvingSymlinksInPath()
        let fm = FileManager.default
        for q in decisionQueue {
            let fileURL = q.sourceURL.resolvingSymlinksInPath()
            let fileDir = fileURL.deletingLastPathComponent().resolvingSymlinksInPath()
            guard fileDir == watchURL else { continue }
            try? fm.removeItem(at: fileURL)
        }
    }

    /// Remove processed items from queue, drop non-existent files from prospective list, clear queue.
    private func refreshProspectiveImportsAfterImport() {
        let fm = FileManager.default
        prospectiveFiles.removeAll { !fm.fileExists(atPath: $0.url.path) }
        decisionQueue.removeAll()
        let keysToDrop = Set(prospectiveFiles.map { canonicalPathKey(for: $0.url) })
        analyzeBySource = analyzeBySource.filter { keysToDrop.contains($0.key) }
        replaceTargetBySource = replaceTargetBySource.filter { keysToDrop.contains($0.key) }
        syncSelection()
    }

    /// Clear all pending imports and queued decisions from the assistant UI.
    private func clearProspectiveAndQueue() {
        prospectiveFiles.removeAll()
        decisionQueue.removeAll()
        analyzeBySource.removeAll()
        replaceTargetBySource.removeAll()
        selectedFile = nil
        leftLines = []
        rightLines = []
        metadataTagRows = []
        statusMessage = "Cleared prospective imports and decision queue."
    }
}

#Preview {
    ContentView()
}
