import Foundation
import Observation

enum ConnectionStatus: Equatable {
    case disconnected
    case connected
    case connectionLost
    case reconnected
}

@MainActor
@Observable
final class ConnectionManager {
    var serverURL: String = ""
    var status: ConnectionStatus = .disconnected
    var isLoading: Bool = false
    var isRestoring: Bool = false
    var error: String?
    var serverInfo: ServerInfo?

    var isConnected: Bool {
        status == .connected || status == .reconnected
    }

    private(set) var apiClient: APIClient?

    static let serverURLKey = "serverURL"
    static let tokenKey = "authToken"
    static let fingerprintKey = "certFingerprint"

    private var healthCheckTask: Task<Void, Never>?
    private var consecutiveFailures = 0
    private static let maxFailuresBeforeLost = 2

    var hasSavedCredentials: Bool {
        KeychainHelper.read(key: Self.tokenKey) != nil
            && KeychainHelper.read(key: Self.fingerprintKey) != nil
    }

    init() {
        // Restore URL immediately (non-async)
        if let savedURL = KeychainHelper.read(key: Self.serverURLKey) {
            serverURL = savedURL
        }
        restoreConnection()
    }

    private func restoreConnection() {
        guard let savedURL = KeychainHelper.read(key: Self.serverURLKey),
              let savedToken = KeychainHelper.read(key: Self.tokenKey),
              let savedFingerprint = KeychainHelper.read(key: Self.fingerprintKey) else {
            return
        }

        let delegate = CertificatePinningDelegate(fingerprint: savedFingerprint)
        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        let client = APIClient(baseURL: savedURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")), token: savedToken, session: session)
        apiClient = client
        isRestoring = true

        Task {
            do {
                let info = try await client.getInfo()
                serverInfo = info
                status = .connected
                startHealthCheck()
            } catch {
                apiClient = nil
                self.error = "Could not reconnect: \(error.localizedDescription)"
            }
            isRestoring = false
        }
    }

    func connect(url: String, token: String, fingerprint: String) async throws {
        isLoading = true
        error = nil

        let cleanURL = url.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let delegate = CertificatePinningDelegate(fingerprint: fingerprint)
        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        let client = APIClient(baseURL: cleanURL, token: token, session: session)

        do {
            let info = try await client.getInfo()

            KeychainHelper.save(key: Self.serverURLKey, value: cleanURL)
            KeychainHelper.save(key: Self.tokenKey, value: token)
            KeychainHelper.save(key: Self.fingerprintKey, value: fingerprint)

            serverURL = cleanURL
            apiClient = client
            serverInfo = info
            status = .connected
            isLoading = false
            startHealthCheck()
        } catch {
            isLoading = false
            self.error = error.localizedDescription
            throw error
        }
    }

    func disconnect() {
        stopHealthCheck()

        KeychainHelper.delete(key: Self.serverURLKey)
        KeychainHelper.delete(key: Self.tokenKey)
        KeychainHelper.delete(key: Self.fingerprintKey)

        serverURL = ""
        apiClient = nil
        serverInfo = nil
        status = .disconnected
        error = nil
    }

    // MARK: - Health Check

    private func startHealthCheck() {
        stopHealthCheck()
        consecutiveFailures = 0

        healthCheckTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled else { break }
                await self?.performHealthCheck()
            }
        }
    }

    private func stopHealthCheck() {
        healthCheckTask?.cancel()
        healthCheckTask = nil
    }

    private func performHealthCheck() async {
        guard let client = apiClient else { return }

        do {
            _ = try await client.getHealth()
            consecutiveFailures = 0

            if status == .connectionLost {
                status = .reconnected
                // Auto-clear to .connected after 3 seconds
                Task {
                    try? await Task.sleep(for: .seconds(3))
                    if status == .reconnected {
                        status = .connected
                    }
                }
            }
        } catch {
            consecutiveFailures += 1

            if consecutiveFailures >= Self.maxFailuresBeforeLost && status != .connectionLost {
                status = .connectionLost
            }
        }
    }
}
