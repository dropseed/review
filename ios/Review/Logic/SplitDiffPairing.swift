import Foundation

struct SplitDiffRow: Identifiable, Sendable {
    let id: Int
    let old: DiffLine?
    let new: DiffLine?
    let oldSourceIndex: Int?
    let newSourceIndex: Int?
}

func pairLinesForSplitDiff(_ lines: [DiffLine]) -> [SplitDiffRow] {
    var rows: [SplitDiffRow] = []
    var i = 0
    var rowId = 0

    while i < lines.count {
        let line = lines[i]

        switch line.type {
        case .context:
            rows.append(SplitDiffRow(id: rowId, old: line, new: line, oldSourceIndex: i, newSourceIndex: i))
            rowId += 1
            i += 1

        case .removed:
            var removed: [(DiffLine, Int)] = []
            while i < lines.count && lines[i].type == .removed {
                removed.append((lines[i], i))
                i += 1
            }
            var added: [(DiffLine, Int)] = []
            while i < lines.count && lines[i].type == .added {
                added.append((lines[i], i))
                i += 1
            }
            let maxCount = max(removed.count, added.count)
            for j in 0..<maxCount {
                rows.append(SplitDiffRow(
                    id: rowId,
                    old: j < removed.count ? removed[j].0 : nil,
                    new: j < added.count ? added[j].0 : nil,
                    oldSourceIndex: j < removed.count ? removed[j].1 : nil,
                    newSourceIndex: j < added.count ? added[j].1 : nil
                ))
                rowId += 1
            }

        case .added:
            rows.append(SplitDiffRow(id: rowId, old: nil, new: line, oldSourceIndex: nil, newSourceIndex: i))
            rowId += 1
            i += 1
        }
    }

    return rows
}
