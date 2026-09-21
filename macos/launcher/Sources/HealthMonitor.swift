import Foundation

enum HealthMonitor {
    static func httpGet(_ url: URL, headers: [String: String] = [:], timeout: TimeInterval = 2.5) -> (status: Int, body: String)? {
        let semaphore = DispatchSemaphore(value: 0)
        var result: (Int, String)?
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "GET"
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        let task = URLSession.shared.dataTask(with: request) { data, response, _ in
            if let http = response as? HTTPURLResponse {
                let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                result = (http.statusCode, body)
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + timeout + 0.5)
        return result
    }

    static func isWebReachable(config: LaunchConfig) -> Bool {
        httpGet(config.webURL) != nil
    }

    static func isDesktopHealthy(config: LaunchConfig, token: String?) -> Result<Void, LaunchError> {
        var headers: [String: String] = [:]
        if let token, !token.isEmpty {
            headers["Authorization"] = "Bearer \(token)"
        }
        guard let response = httpGet(config.desktopHealthURL, headers: headers) else {
            return .failure(.health("Desktop Service auf \(config.desktopHost):\(config.desktopPort) ist nicht erreichbar."))
        }
        if response.status == 401 {
            return .failure(.health("Desktop Service läuft, aber das lokale Token passt nicht."))
        }
        if (200...399).contains(response.status), response.body.contains("\"ok\":true") || response.body.contains("nova-desktop") {
            return .success(())
        }
        if (200...399).contains(response.status) {
            return .success(())
        }
        return .failure(.health("Desktop Service antwortet mit HTTP \(response.status)."))
    }

    static func readDesktopToken(config: LaunchConfig) -> String? {
        guard let raw = try? String(contentsOf: config.desktopTokenFile, encoding: .utf8) else { return nil }
        let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return token.count >= 24 ? token : nil
    }

    static func helperResponds(config: LaunchConfig) -> Bool {
        guard FileManager.default.isExecutableFile(atPath: config.helperBin.path) else { return false }
        let process = Process()
        process.executableURL = config.helperBin
        process.arguments = ["{\"cmd\":\"permissions\"}"]
        process.currentDirectoryURL = config.projectRoot
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            return false
        }
        let deadline = Date().addingTimeInterval(8)
        while process.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.1)
        }
        if process.isRunning { process.terminate() }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let body = String(data: data, encoding: .utf8) ?? ""
        return body.contains("\"ok\":true") || body.contains("accessibility")
    }
}
