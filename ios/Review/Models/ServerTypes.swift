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
