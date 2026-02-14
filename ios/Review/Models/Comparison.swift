import Foundation

struct Comparison: Codable, Hashable, Sendable {
    let base: String
    let head: String
    let key: String
}

struct GitHubPrRef: Codable, Hashable, Sendable {
    let number: Int
    let title: String
    let headRefName: String
    let baseRefName: String
    let body: String?
}
