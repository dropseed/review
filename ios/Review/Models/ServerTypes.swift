import Foundation

struct ServerInfo: Codable, Sendable {
    let version: String
    let hostname: String
    let repos: [GlobalReviewSummary]
}

struct TrustPattern: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let category: String
    let name: String
    let description: String
}

struct TrustCategory: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let patterns: [TrustPattern]
}

// MARK: - Branch & GitHub Types

struct BranchList: Codable, Sendable {
    let local: [String]
    let remote: [String]
}

struct PrAuthor: Codable, Sendable {
    let login: String
}

struct PullRequest: Codable, Identifiable, Sendable {
    let number: Int
    let title: String
    let headRefName: String
    let baseRefName: String
    let url: String
    let author: PrAuthor
    let state: String
    let isDraft: Bool
    let updatedAt: String
    let body: String
    var id: Int { number }
}

// Response wrappers for simple endpoints
struct BranchResponse: Codable, Sendable { let branch: String }
struct AvailableResponse: Codable, Sendable { let available: Bool }
