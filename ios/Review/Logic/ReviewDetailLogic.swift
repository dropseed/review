import Foundation

func hasChangeStatus(_ status: FileEntry.FileStatus?) -> Bool {
    guard let status else { return false }
    switch status {
    case .added, .modified, .deleted, .renamed, .untracked:
        return true
    case .gitignored:
        return false
    }
}

func flattenFiles(_ entries: [FileEntry]) -> [FileEntry] {
    var result: [FileEntry] = []
    for entry in entries {
        if entry.isDirectory, let children = entry.children {
            result.append(contentsOf: flattenFiles(children))
        } else if !entry.isDirectory {
            result.append(entry)
        }
    }
    return result
}

func countFileHunks(filePath: String, hunks: [DiffHunk]) -> Int {
    return hunks.filter { $0.filePath == filePath }.count
}

func countReviewedHunks(filePath: String, hunks: [DiffHunk], reviewState: ReviewState?) -> Int {
    guard let reviewState else { return 0 }
    var count = 0
    for hunk in hunks {
        if hunk.filePath != filePath { continue }
        let status = getHunkReviewStatus(reviewState.hunks[hunk.id], trustList: reviewState.trustList)
        if status != .pending && status != .savedForLater { count += 1 }
    }
    return count
}

func countTrustedHunks(filePath: String, hunks: [DiffHunk], reviewState: ReviewState?) -> Int {
    guard let reviewState else { return 0 }
    var count = 0
    for hunk in hunks {
        if hunk.filePath != filePath { continue }
        let state = reviewState.hunks[hunk.id]
        if state?.status == nil && isHunkTrusted(state, trustList: reviewState.trustList) {
            count += 1
        }
    }
    return count
}

struct ReviewDetailStats {
    let fileCount: Int
    let totalHunks: Int
    let trustedHunks: Int
    let approvedHunks: Int
    let rejectedHunks: Int
    let savedForLaterHunks: Int

    var reviewedHunks: Int { trustedHunks + approvedHunks + rejectedHunks }
    var pendingHunks: Int { totalHunks - reviewedHunks - savedForLaterHunks }
    var reviewedPercent: Int {
        totalHunks > 0 ? Int(round(Double(reviewedHunks) / Double(totalHunks) * 100)) : 0
    }

    var state: String? {
        if rejectedHunks > 0 { return "changes_requested" }
        if reviewedHunks == totalHunks && totalHunks > 0 { return "approved" }
        return nil
    }
}

struct ReviewDetailSection: Identifiable {
    let id = UUID()
    let title: String
    let data: [FileEntry]
}

func computeSections(changedFiles: [FileEntry], hunks: [DiffHunk], reviewState: ReviewState?) -> [ReviewDetailSection] {
    var needsReview: [FileEntry] = []
    var trusted: [FileEntry] = []
    var reviewed: [FileEntry] = []

    for file in changedFiles {
        let totalHunks = countFileHunks(filePath: file.path, hunks: hunks)
        let reviewedHunks = countReviewedHunks(filePath: file.path, hunks: hunks, reviewState: reviewState)
        let trustedHunks = countTrustedHunks(filePath: file.path, hunks: hunks, reviewState: reviewState)

        if totalHunks > 0 && reviewedHunks >= totalHunks {
            if trustedHunks == totalHunks {
                trusted.append(file)
            } else {
                reviewed.append(file)
            }
        } else {
            needsReview.append(file)
        }
    }

    var result: [ReviewDetailSection] = []
    if !needsReview.isEmpty {
        result.append(ReviewDetailSection(title: "Needs Review", data: needsReview))
    }
    if !trusted.isEmpty {
        result.append(ReviewDetailSection(title: "Trusted", data: trusted))
    }
    if !reviewed.isEmpty {
        result.append(ReviewDetailSection(title: "Reviewed", data: reviewed))
    }
    return result
}

func computeFeedbackCount(reviewState: ReviewState?) -> Int {
    guard let state = reviewState else { return 0 }
    let rejectedCount = state.hunks.values.filter { $0.status == .rejected }.count
    let annotationCount = state.annotations.count
    let hasNotes = !state.notes.isEmpty ? 1 : 0
    return rejectedCount + annotationCount + hasNotes
}

func computeStats(hunks: [DiffHunk], reviewState: ReviewState?, fileCount: Int) -> ReviewDetailStats {
    var trustedHunks = 0
    var approvedHunks = 0
    var rejectedHunks = 0
    var savedForLaterHunks = 0

    if let reviewState {
        for hunk in hunks {
            let status = getHunkReviewStatus(reviewState.hunks[hunk.id], trustList: reviewState.trustList)
            switch status {
            case .trusted: trustedHunks += 1
            case .approved: approvedHunks += 1
            case .rejected: rejectedHunks += 1
            case .savedForLater: savedForLaterHunks += 1
            case .pending: break
            }
        }
    }

    return ReviewDetailStats(
        fileCount: fileCount,
        totalHunks: hunks.count,
        trustedHunks: trustedHunks,
        approvedHunks: approvedHunks,
        rejectedHunks: rejectedHunks,
        savedForLaterHunks: savedForLaterHunks
    )
}
