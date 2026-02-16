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

    private func request(path: String, method: String = "GET", body: Data? = nil, timeout: TimeInterval? = nil) async throws -> Data {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let timeout {
            request.timeoutInterval = timeout
        }

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

    private func putJSON<T: Decodable>(path: String, body: some Encodable) async throws -> T {
        let bodyData = try encoder.encode(body)
        let data = try await request(path: path, method: "PUT", body: bodyData)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    private func buildRepoQuery(_ repoPath: String) -> String {
        "repo=\(repoPath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? repoPath)"
    }

    private func buildComparisonPath(_ comparison: Comparison) -> String {
        let base = comparison.base.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? comparison.base
        let head = comparison.head.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? comparison.head
        return "\(base)..\(head)"
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
        try await fetchJSON(path: "/reviews")
    }

    // MARK: - Files

    func getFiles(repoPath: String, comparison: Comparison) async throws -> [FileEntry] {
        let compPath = buildComparisonPath(comparison)
        return try await fetchJSON(path: "/comparisons/\(compPath)/files?\(buildRepoQuery(repoPath))")
    }

    func getFile(repoPath: String, filePath: String, comparison: Comparison) async throws -> FileContent {
        let compPath = buildComparisonPath(comparison)
        let encodedPath = filePath.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? filePath
        return try await fetchJSON(path: "/comparisons/\(compPath)/files/\(encodedPath)?\(buildRepoQuery(repoPath))")
    }

    // MARK: - Hunks

    func getAllHunks(repoPath: String, comparison: Comparison, filePaths: [String]) async throws -> [DiffHunk] {
        let compPath = buildComparisonPath(comparison)
        let body = AllHunksRequest(filePaths: filePaths)
        return try await postJSON(path: "/comparisons/\(compPath)/hunks?\(buildRepoQuery(repoPath))", body: body)
    }

    // MARK: - State

    func getState(repoPath: String, comparison: Comparison) async throws -> ReviewState {
        let compPath = buildComparisonPath(comparison)
        return try await fetchJSON(path: "/comparisons/\(compPath)/review?\(buildRepoQuery(repoPath))")
    }

    func saveState(repoPath: String, state: ReviewState) async throws -> UInt64 {
        let compPath = buildComparisonPath(state.comparison)
        let response: SaveStateResponse = try await putJSON(path: "/comparisons/\(compPath)/review?\(buildRepoQuery(repoPath))", body: state)
        return response.version
    }

    func deleteReview(repoPath: String, comparison: Comparison) async throws {
        let compPath = buildComparisonPath(comparison)
        _ = try await request(path: "/comparisons/\(compPath)/review?\(buildRepoQuery(repoPath))", method: "DELETE")
    }

    // MARK: - Diff Stats

    func getDiffShortStat(repoPath: String, comparison: Comparison) async throws -> DiffShortStat {
        let compPath = buildComparisonPath(comparison)
        return try await fetchJSON(path: "/comparisons/\(compPath)/diff/shortstat?\(buildRepoQuery(repoPath))")
    }

    // MARK: - Remote Info

    func getRemoteInfo(repoPath: String) async throws -> RemoteInfo {
        try await fetchJSON(path: "/git/remote?\(buildRepoQuery(repoPath))")
    }

    // MARK: - Branches & GitHub

    func getBranches(repoPath: String) async throws -> BranchList {
        try await fetchJSON(path: "/git/branches?\(buildRepoQuery(repoPath))")
    }

    func getDefaultBranch(repoPath: String) async throws -> String {
        let response: BranchResponse = try await fetchJSON(path: "/git/branch/default?\(buildRepoQuery(repoPath))")
        return response.branch
    }

    func checkGitHubAvailable(repoPath: String) async throws -> Bool {
        let response: AvailableResponse = try await fetchJSON(path: "/github/available?\(buildRepoQuery(repoPath))")
        return response.available
    }

    func listPullRequests(repoPath: String) async throws -> [PullRequest] {
        try await fetchJSON(path: "/github/prs?\(buildRepoQuery(repoPath))")
    }

    // MARK: - Taxonomy

    func getTaxonomy(repoPath: String) async throws -> [TrustCategory] {
        try await fetchJSON(path: "/taxonomy?\(buildRepoQuery(repoPath))")
    }

    // MARK: - Guide Generation

    func generateGroups(repoPath: String, comparison: Comparison, hunks: [DiffHunk], reviewState: ReviewState?) async throws -> [HunkGroup] {
        let compPath = buildComparisonPath(comparison)
        let body = GenerateGroupsRequest(hunks: buildHunkInputs(hunks: hunks, reviewState: reviewState))
        let bodyData = try encoder.encode(body)
        let data = try await request(path: "/comparisons/\(compPath)/guide/groups?\(buildRepoQuery(repoPath))", method: "POST", body: bodyData, timeout: 180)
        do {
            return try decoder.decode([HunkGroup].self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    func generateSummary(repoPath: String, comparison: Comparison, hunks: [DiffHunk], reviewState: ReviewState?) async throws -> SummaryResult {
        let compPath = buildComparisonPath(comparison)
        let body = GenerateSummaryRequest(hunks: buildHunkInputs(hunks: hunks, reviewState: reviewState))
        let bodyData = try encoder.encode(body)
        let data = try await request(path: "/comparisons/\(compPath)/guide/summary?\(buildRepoQuery(repoPath))", method: "POST", body: bodyData, timeout: 180)
        do {
            return try decoder.decode(SummaryResult.self, from: data)
        } catch {
            throw APIError.decodingError(error)
        }
    }

    private func buildHunkInputs(hunks: [DiffHunk], reviewState: ReviewState?) -> [HunkInput] {
        hunks.map { hunk in
            HunkInput(
                id: hunk.id,
                filePath: hunk.filePath,
                content: hunk.content,
                label: reviewState?.hunks[hunk.id]?.label
            )
        }
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
    let filePaths: [String]
}

struct SaveStateResponse: Codable, Sendable {
    let version: UInt64
}

struct HunkInput: Codable, Sendable {
    let id: String
    let filePath: String
    let content: String
    let label: [String]?
}

struct GenerateGroupsRequest: Codable, Sendable {
    let hunks: [HunkInput]
}

struct GenerateSummaryRequest: Codable, Sendable {
    let hunks: [HunkInput]
}

struct SummaryResult: Codable, Sendable {
    let title: String
    let summary: String
}
