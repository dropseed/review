import Foundation

enum HunkReviewStatus: String, Sendable {
    case approved
    case rejected
    case savedForLater
    case trusted
    case pending
}

func matchesPattern(_ label: String, _ pattern: String) -> Bool {
    if !pattern.contains("*") {
        return label == pattern
    }
    let escaped = NSRegularExpression.escapedPattern(for: pattern)
    let regexPattern = escaped.replacingOccurrences(of: "\\*", with: ".*")
    guard let regex = try? NSRegularExpression(pattern: "^\(regexPattern)$") else {
        return false
    }
    let range = NSRange(label.startIndex..., in: label)
    return regex.firstMatch(in: label, range: range) != nil
}

func isHunkTrusted(_ hunkState: HunkState?, trustList: [String]) -> Bool {
    guard let hunkState, !hunkState.label.isEmpty else { return false }
    for label in hunkState.label {
        if trustList.contains(where: { matchesPattern(label, $0) }) {
            return true
        }
    }
    return false
}

func getHunkReviewStatus(_ hunkState: HunkState?, trustList: [String]) -> HunkReviewStatus {
    if hunkState?.status == .approved { return .approved }
    if hunkState?.status == .rejected { return .rejected }
    if hunkState?.status == .savedForLater { return .savedForLater }
    if isHunkTrusted(hunkState, trustList: trustList) { return .trusted }
    return .pending
}
