import Darwin
import Foundation

enum HealthMonitor {
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 20
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }()

    struct HTTPResult {
        var status: Int?
        var body: String
        var error: String?

        var ok: Bool { error == nil && status != nil }
    }

    static func httpGet(_ url: URL, headers: [String: String] = [:], timeout: TimeInterval = 5) -> HTTPResult {
        let semaphore = DispatchSemaphore(value: 0)
        var captured = HTTPResult(status: nil, body: "", error: "keine Antwort")
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        let task = session.dataTask(with: request) { data, response, error in
            if let error {
                captured = HTTPResult(status: nil, body: "", error: error.localizedDescription)
            } else if let http = response as? HTTPURLResponse {
                let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                captured = HTTPResult(status: http.statusCode, body: body, error: nil)
            } else {
                captured = HTTPResult(status: nil, body: "", error: "keine HTTP-Antwort")
            }
            semaphore.signal()
        }
        task.resume()
        if semaphore.wait(timeout: .now() + timeout + 0.5) == .timedOut {
            task.cancel()
            return HTTPResult(status: nil, body: "", error: "Zeitüberschreitung nach \(Int(timeout))s")
        }
        return captured
    }

    static func tcpIsOpen(host: String, port: Int, timeoutMs: Int32 = 400) -> Bool {
        var hints = addrinfo(
            ai_flags: AI_NUMERICHOST | AI_NUMERICSERV,
            ai_family: AF_INET,
            ai_socktype: SOCK_STREAM,
            ai_protocol: IPPROTO_TCP,
            ai_addrlen: 0,
            ai_canonname: nil,
            ai_addr: nil,
            ai_next: nil
        )
        var info: UnsafeMutablePointer<addrinfo>?
        let portText = String(port)
        guard getaddrinfo(host, portText, &hints, &info) == 0, let info else { return false }
        defer { freeaddrinfo(info) }

        let fd = socket(info.pointee.ai_family, info.pointee.ai_socktype, info.pointee.ai_protocol)
        guard fd >= 0 else { return false }
        defer { close(fd) }

        let flags = fcntl(fd, F_GETFL, 0)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)
        let connected = connect(fd, info.pointee.ai_addr, info.pointee.ai_addrlen)
        if connected == 0 { return true }
        if errno != EINPROGRESS { return false }

        var poll = pollfd(fd: fd, events: Int16(POLLOUT), revents: 0)
        let ready = Darwin.poll(&poll, 1, timeoutMs)
        guard ready > 0, (poll.revents & Int16(POLLOUT)) != 0 else { return false }
        var soError: Int32 = 0
        var length = socklen_t(MemoryLayout<Int32>.size)
        getsockopt(fd, SOL_SOCKET, SO_ERROR, &soError, &length)
        return soError == 0
    }

    static func isApplicationHealthy(config: LaunchConfig) -> Result<Void, LaunchError> {
        if !tcpIsOpen(host: config.webHost, port: config.webPort) {
            return .failure(.health("Application Service hört noch nicht auf \(config.webHost):\(config.webPort)."))
        }
        let response = httpGet(config.webHealthURL, timeout: 15)
        if let error = response.error {
            return .failure(.health("Application-Health \(config.webHealthURL.path) fehlgeschlagen: \(error)"))
        }
        if let status = response.status,
           (200...299).contains(status),
           response.body.contains("\"ok\":true"),
           response.body.contains("nova-web")
        {
            return .success(())
        }
        if let status = response.status, (200...299).contains(status), response.body.contains("\"ok\":true") {
            return .success(())
        }
        return .failure(.health("Application Service antwortet auf \(config.webHealthURL.path) mit HTTP \(response.status ?? -1)."))
    }

    static func isDesktopHealthy(config: LaunchConfig, token: String?) -> Result<Void, LaunchError> {
        if !tcpIsOpen(host: config.desktopHost, port: config.desktopPort) {
            return .failure(.health("Desktop Service hört noch nicht auf \(config.desktopHost):\(config.desktopPort)."))
        }
        var headers: [String: String] = [:]
        if let token, !token.isEmpty {
            headers["Authorization"] = "Bearer \(token)"
        }
        let response = httpGet(config.desktopHealthURL, headers: headers, timeout: 8)
        if let error = response.error {
            return .failure(.health("Desktop-Health fehlgeschlagen: \(error)"))
        }
        if response.status == 401 {
            return .failure(.health("Desktop Service läuft, aber das lokale Token passt nicht."))
        }
        if let status = response.status,
           (200...399).contains(status),
           response.body.contains("\"ok\":true") || response.body.contains("nova-desktop")
        {
            return .success(())
        }
        if let status = response.status, (200...399).contains(status) {
            return .success(())
        }
        return .failure(.health("Desktop Service antwortet mit HTTP \(response.status ?? -1)."))
    }

    static func readDesktopToken(config: LaunchConfig) -> String? {
        guard let raw = try? String(contentsOf: config.desktopTokenFile, encoding: .utf8) else { return nil }
        let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return token.count >= 24 ? token : nil
    }

    static func helperResponds(config: LaunchConfig) -> Result<Void, LaunchError> {
        guard FileManager.default.isExecutableFile(atPath: config.helperBin.path) else {
            return .failure(.dependency("Native Helper fehlt oder ist nicht ausführbar: \(config.helperBin.path)"))
        }
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
            return .failure(.health("Native Helper ließ sich nicht starten: \(error.localizedDescription)"))
        }
        let deadline = Date().addingTimeInterval(8)
        while process.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.1)
        }
        if process.isRunning {
            process.terminate()
            return .failure(.health("Native Helper hat nicht rechtzeitig auf den Capability-Check geantwortet."))
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let body = String(data: data, encoding: .utf8) ?? ""
        if body.contains("\"ok\":true") || body.contains("accessibility") {
            return .success(())
        }
        return .failure(.health("Native Helper antwortete unerwartet auf den Capability-Check."))
    }
}
