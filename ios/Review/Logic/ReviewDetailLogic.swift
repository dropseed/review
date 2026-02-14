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
        if status != .pending { count += 1 }
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
    let reviewedHunkCount: Int
    let trustedHunkCount: Int
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

func computeStats(hunks: [DiffHunk], reviewState: ReviewState?, fileCount: Int) -> ReviewDetailStats {
    var reviewedHunkCount = 0
    var trustedHunkCount = 0

    if let reviewState {
        for hunk in hunks {
            let status = getHunkReviewStatus(reviewState.hunks[hunk.id], trustList: reviewState.trustList)
            if status == .trusted {
                trustedHunkCount += 1
                reviewedHunkCount += 1
            } else if status != .pending {
                reviewedHunkCount += 1
            }
        }
    }

    return ReviewDetailStats(
        fileCount: fileCount,
        totalHunks: hunks.count,
        reviewedHunkCount: reviewedHunkCount,
        trustedHunkCount: trustedHunkCount
    )
}
