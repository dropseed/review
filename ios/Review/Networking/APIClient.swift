import Foundation

struct APIClient: Sendable {
    let baseURL: String
    let token: String

    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        return decoder
    }

    private var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        return encoder
    }

    private func request(path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError.networkError(error)
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.noData
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw APIError.httpError(statusCode: httpResponse.statusCode, message: message)
        }

        return data
    }

    private func fetchJSON<T: Decodable>(path: String) async throws -> T {
        let data = try await request(path: path)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    private func postJSON<T: Decodable>(path: String, body: some Encodable) async throws -> T {
        let bodyData = try encoder.encode(body)
        let data = try await request(path: path, method: "POST", body: bodyData)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    private func postJSONNoResponse(path: String, body: some Encodable) async throws {
        let bodyData = try encoder.encode(body)
        _ = try await request(path: path, method: "POST", body: bodyData)
    }

    private func buildRepoQuery(_ repoPath: String) -> String {
        "repo=\(repoPath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? repoPath)"
    }

    private func buildComparisonQuery(_ comparison: Comparison) -> String {
        let base = comparison.base.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? comparison.base
        let head = comparison.head.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? comparison.head
        return "base=\(base)&head=\(head)"
    }

    // MARK: - Health

    func getHealth() async throws -> HealthResponse {
        // Health check doesn't need auth
        guard let url = URL(string: "\(baseURL)/health") else {
            throw APIError.invalidURL
        }
        let (data, _) = try await URLSession.shared.data(from: url)
        return try decoder.decode(HealthResponse.self, from: data)
    }

    // MARK: - Info

    func getInfo() async throws -> ServerInfo {
        try await fetchJSON(path: "/info")
    }

    // MARK: - Reviews

    func getReviewsGlobal() async throws -> [GlobalReviewSummary] {
        try await fetchJSON(path: "/reviews/global")
    }

    // MARK: - Files

    func getFiles(repoPath: String, comparison: Comparison) async throws -> [FileEntry] {
        try await fetchJSON(path: "/files?\(buildRepoQuery(repoPath))&\(buildComparisonQuery(comparison))")
    }

    func getFile(repoPath: String, filePath: String, comparison: Comparison) async throws -> FileContent {
        let encodedPath = filePath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? filePath
        return try await fetchJSON(path: "/file?\(buildRepoQuery(repoPath))&path=\(encodedPath)&\(buildComparisonQuery(comparison))")
    }

    // MARK: - Hunks

    func getAllHunks(repoPath: String, comparison: Comparison, filePaths: [String]) async throws -> [DiffHunk] {
        let body = AllHunksRequest(repo: repoPath, comparison: comparison, filePaths: filePaths)
        return try await postJSON(path: "/hunks", body: body)
    }

    // MARK: - State

    func getState(repoPath: String, comparison: Comparison) async throws -> ReviewState {
        try await fetchJSON(path: "/state?\(buildRepoQuery(repoPath))&\(buildComparisonQuery(comparison))")
    }

    func saveState(repoPath: String, state: ReviewState) async throws {
        try await postJSONNoResponse(path: "/state?\(buildRepoQuery(repoPath))", body: state)
    }

    // MARK: - Diff Stats

    func getDiffShortStat(repoPath: String, comparison: Comparison) async throws -> DiffShortStat {
        try await fetchJSON(path: "/diff/shortstat?\(buildRepoQuery(repoPath))&\(buildComparisonQuery(comparison))")
    }

    // MARK: - Remote Info

    func getRemoteInfo(repoPath: String) async throws -> RemoteInfo {
        try await fetchJSON(path: "/remote-info?\(buildRepoQuery(repoPath))")
    }

    // MARK: - Taxonomy

    func getTaxonomy(repoPath: String) async throws -> [TrustCategory] {
        try await fetchJSON(path: "/taxonomy?\(buildRepoQuery(repoPath))")
    }
}

// MARK: - Request/Response Types

struct HealthResponse: Codable {
    let ok: Bool
}

struct RemoteInfo: Codable, Sendable {
    let name: String
    let browseUrl: String
}

struct AllHunksRequest: Codable, Sendable {
    let repo: String
    let comparison: Comparison
    let filePaths: [String]
}
