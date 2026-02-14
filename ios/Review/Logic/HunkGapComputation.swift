import Foundation

enum GapPosition: Hashable, Sendable {
    case before
    case between(Int, Int)
    case after
}

struct HunkGap: Identifiable, Hashable, Sendable {
    let id: String
    let newStartLine: Int
    let newEndLine: Int
    let oldStartLine: Int
    let oldEndLine: Int
    let position: GapPosition

    var totalNewLines: Int {
        max(0, newEndLine - newStartLine + 1)
    }
}

struct ExpandedRange {
    var topExpanded: Int = 0
    var bottomExpanded: Int = 0
}

func computeGaps(hunks: [DiffHunk], newLineCount: Int, oldLineCount: Int) -> [HunkGap] {
    guard !hunks.isEmpty else { return [] }

    var gaps: [HunkGap] = []

    // Gap before first hunk
    let firstHunk = hunks[0]
    if firstHunk.newStart > 1 {
        let newEnd = firstHunk.newStart - 1
        let oldEnd = firstHunk.oldStart > 0 ? firstHunk.oldStart - 1 : 0
        gaps.append(HunkGap(
            id: "gap-before-0",
            newStartLine: 1,
            newEndLine: newEnd,
            oldStartLine: 1,
            oldEndLine: oldEnd,
            position: .before
        ))
    }

    // Gaps between hunks
    for i in 0..<(hunks.count - 1) {
        let current = hunks[i]
        let next = hunks[i + 1]

        let newGapStart = current.newStart + current.newCount
        let newGapEnd = next.newStart - 1

        let oldGapStart = current.oldStart + current.oldCount
        let oldGapEnd = next.oldStart - 1

        if newGapStart <= newGapEnd {
            gaps.append(HunkGap(
                id: "gap-between-\(i)-\(i + 1)",
                newStartLine: newGapStart,
                newEndLine: newGapEnd,
                oldStartLine: oldGapStart,
                oldEndLine: oldGapEnd,
                position: .between(i, i + 1)
            ))
        }
    }

    // Gap after last hunk
    let lastHunk = hunks[hunks.count - 1]
    let afterNewStart = lastHunk.newStart + lastHunk.newCount
    if afterNewStart <= newLineCount {
        let afterOldStart = lastHunk.oldStart + lastHunk.oldCount
        gaps.append(HunkGap(
            id: "gap-after-\(hunks.count - 1)",
            newStartLine: afterNewStart,
            newEndLine: newLineCount,
            oldStartLine: afterOldStart,
            oldEndLine: oldLineCount,
            position: .after
        ))
    }

    return gaps
}

func extractContextLines(from content: String, startLine: Int, endLine: Int, oldStartLine: Int) -> [DiffLine] {
    let allLines = content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    guard startLine >= 1, endLine >= startLine, startLine <= allLines.count else { return [] }

    let clampedEnd = min(endLine, allLines.count)
    var lines: [DiffLine] = []

    for i in (startLine - 1)..<clampedEnd {
        let offset = i - (startLine - 1)
        lines.append(DiffLine(
            type: .context,
            content: allLines[i],
            oldLineNumber: oldStartLine + offset,
            newLineNumber: startLine + offset
        ))
    }

    return lines
}
