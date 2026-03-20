import Foundation

enum NodeRunnerError: LocalizedError {
    case projectRootInvalid
    case scriptMissing
    case nodeNotFound(String)
    case nodeFailed(String)
    case decodeFailed(String)

    var errorDescription: String? {
        switch self {
        case .projectRootInvalid: return "Set a valid BKG_Remover project root."
        case .scriptMissing: return "Could not find scripts/generateSampleSpectra.js in the project."
        case .nodeNotFound(let s): return s
        case .nodeFailed(let s): return s
        case .decodeFailed(let s): return s
        }
    }
}

enum NodeRunner {
    static func scriptURL(projectRoot: URL) -> URL {
        projectRoot.appendingPathComponent("scripts/generateSampleSpectra.js", isDirectory: false)
    }

    /// Resolves `node` without relying on PATH (GUI apps often lack Homebrew/nvm paths).
    /// Pass `overridePath` from settings if non-empty (e.g. nvm shim path from `which node` in Terminal).
    static func resolveNodeExecutable(overridePath: String?) throws -> URL {
        if let o = overridePath?.trimmingCharacters(in: .whitespacesAndNewlines), !o.isEmpty {
            let u = URL(fileURLWithPath: (o as NSString).expandingTildeInPath)
            if FileManager.default.isExecutableFile(atPath: u.path) { return u }
            throw NodeRunnerError.nodeNotFound(
                "Custom Node path is not executable:\n\(u.path)\n\nRun `which node` in Terminal and paste that path, or leave blank to auto-detect."
            )
        }
        let candidates = [
            "/opt/homebrew/bin/node", // Apple Silicon Homebrew
            "/usr/local/bin/node", // Intel Homebrew / Node installer
        ]
        for path in candidates {
            if FileManager.default.isExecutableFile(atPath: path) {
                return URL(fileURLWithPath: path)
            }
        }
        if let nvm = nvmNodeBinary() { return nvm }
        if FileManager.default.isExecutableFile(atPath: "/usr/bin/node") {
            return URL(fileURLWithPath: "/usr/bin/node")
        }
        throw NodeRunnerError.nodeNotFound(
            """
            Could not find `node`. GUI apps don't use your shell PATH (so nvm/Homebrew may be hidden).

            • Install Node from https://nodejs.org, or
            • Set "Node executable" below to the full path from Terminal: `which node`
            """
        )
    }

    /// Best-effort: latest node under ~/.nvm/versions/node/<ver>/bin/node
    private static func nvmNodeBinary() -> URL? {
        let base = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".nvm/versions/node", isDirectory: true)
        guard let vers = try? FileManager.default.contentsOfDirectory(at: base, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) else {
            return nil
        }
        let dirs = vers.filter { url in
            (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
        }.sorted { $0.lastPathComponent > $1.lastPathComponent }
        for d in dirs {
            let node = d.appendingPathComponent("bin/node", isDirectory: false)
            if FileManager.default.isExecutableFile(atPath: node.path) { return node }
        }
        return nil
    }

    /// Runs `node scripts/generateSampleSpectra.js --analyze …` and returns parsed JSON.
    static func analyze(projectRoot: URL, paths: [URL], nodeExecutable: String?) throws -> AnalyzeEnvelope {
        let script = scriptURL(projectRoot: projectRoot)
        guard FileManager.default.fileExists(atPath: script.path) else {
            throw NodeRunnerError.scriptMissing
        }
        var args = [script.path, "--analyze"]
        for p in paths {
            args.append(p.path)
        }
        let json = try runNode(nodeExecutable: nodeExecutable, arguments: args, workingDirectory: projectRoot)
        guard let data = json.data(using: .utf8) else {
            throw NodeRunnerError.decodeFailed("Empty output")
        }
        do {
            return try JSONDecoder().decode(AnalyzeEnvelope.self, from: data)
        } catch {
            throw NodeRunnerError.decodeFailed("\(error.localizedDescription)\n---\n\(json.prefix(2000))")
        }
    }

    /// Runs `node scripts/generateSampleSpectra.js --batch <plan.json>`.
    static func batch(projectRoot: URL, planURL: URL, nodeExecutable: String?) throws -> String {
        let script = scriptURL(projectRoot: projectRoot)
        guard FileManager.default.fileExists(atPath: script.path) else {
            throw NodeRunnerError.scriptMissing
        }
        let args = [script.path, "--batch", planURL.path]
        return try runNode(nodeExecutable: nodeExecutable, arguments: args, workingDirectory: projectRoot)
    }

    private static func runNode(nodeExecutable: String?, arguments: [String], workingDirectory: URL) throws -> String {
        let node = try resolveNodeExecutable(overridePath: nodeExecutable)
        let process = Process()
        process.executableURL = node
        process.arguments = arguments
        process.currentDirectoryURL = workingDirectory
        var env = ProcessInfo.processInfo.environment
        let extra = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        if let p = env["PATH"] {
            env["PATH"] = "\(extra):\(p)"
        } else {
            env["PATH"] = extra
        }
        process.environment = env

        let pipe = Pipe()
        let errPipe = Pipe()
        process.standardOutput = pipe
        process.standardError = errPipe

        try process.run()
        process.waitUntilExit()

        let outData = pipe.fileHandleForReading.readDataToEndOfFile()
        let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
        let output = String(data: outData, encoding: .utf8) ?? ""
        let errText = String(data: errData, encoding: .utf8) ?? ""

        guard process.terminationStatus == 0 else {
            throw NodeRunnerError.nodeFailed(errText.isEmpty ? "Exit \(process.terminationStatus)" : errText)
        }
        return output
    }
}
