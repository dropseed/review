import Foundation

struct GlobalReviewSummary: Codable, Identifiable, Hashable, Sendable {
    var id: String { "\(repoPath):\(comparison.key)" }

    let repoPath: String
    let repoName: String
    let comparison: Comparison
    let githubPr: GitHubPrRef?
    let totalHunks: Int
    let trustedHunks: Int
    let approvedHunks: Int
    let reviewedHunks: Int
    let rejectedHunks: Int
    let state: ReviewOverallState?
    let updatedAt: String
    let diffStats: DiffShortStat?

    enum ReviewOverallState: String, Codable, Sendable {
        case approved
        case changes_requested
    }
}
