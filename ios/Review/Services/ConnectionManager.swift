import Foundation
import Observation

@MainActor
@Observable
final class ConnectionManager {
    var serverURL: String = ""
    var isConnected: Bool = false
    var isLoading: Bool = false
    var isRestoring: Bool = false
    var error: String?
    var serverInfo: ServerInfo?

    private(set) var apiClient: APIClient?

    private static let serverURLKey = "serverURL"
    private static let tokenKey = "authToken"

    var hasSavedCredentials: Bool {
        KeychainHelper.read(key: Self.tokenKey) != nil
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
              let savedToken = KeychainHelper.read(key: Self.tokenKey) else {
            return
        }

        let client = APIClient(baseURL: savedURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")), token: savedToken)
        apiClient = client
        isRestoring = true

        Task {
            do {
                let info = try await client.getInfo()
                serverInfo = info
                isConnected = true
            } catch {
                apiClient = nil
                self.error = "Could not reconnect: \(error.localizedDescription)"
            }
            isRestoring = false
        }
    }

    func connect(url: String, token: String) async throws {
        isLoading = true
        error = nil

        let cleanURL = url.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let client = APIClient(baseURL: cleanURL, token: token)

        do {
            let info = try await client.getInfo()

            KeychainHelper.save(key: Self.serverURLKey, value: cleanURL)
            KeychainHelper.save(key: Self.tokenKey, value: token)

            serverURL = cleanURL
            apiClient = client
            serverInfo = info
            isConnected = true
            isLoading = false
        } catch {
            isLoading = false
            self.error = error.localizedDescription
            throw error
        }
    }

    func disconnect() {
        KeychainHelper.delete(key: Self.serverURLKey)
        KeychainHelper.delete(key: Self.tokenKey)

        serverURL = ""
        apiClient = nil
        serverInfo = nil
        isConnected = false
        error = nil
    }
}
