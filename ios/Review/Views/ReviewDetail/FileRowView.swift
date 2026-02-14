import SwiftUI

struct FileRowView: View {
    let file: FileEntry
    let hunkCount: Int
    let reviewedCount: Int

    private var statusColor: Color {
        switch file.status {
        case .added, .untracked: return .fileAdded
        case .modified: return .fileModified
        case .deleted: return .fileDeleted
        case .renamed: return .fileRenamed
        default: return .secondary
        }
    }

    private var statusLabel: String {
        switch file.status {
        case .added: return "A"
        case .modified: return "M"
        case .deleted: return "D"
        case .renamed: return "R"
        case .untracked: return "U"
        default: return "?"
        }
    }

    private var allReviewed: Bool {
        hunkCount > 0 && reviewedCount >= hunkCount
    }

    private var directory: String {
        guard let lastSlash = file.path.lastIndex(of: "/") else { return "" }
        return String(file.path[file.path.startIndex...lastSlash])
    }

    private var fileName: String {
        if let lastSlash = file.path.lastIndex(of: "/") {
            return String(file.path[file.path.index(after: lastSlash)...])
        }
        return file.name
    }

    var body: some View {
        HStack(spacing: 8) {
            Text(statusLabel)
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundStyle(statusColor)
                .frame(width: 16)

            Text(directory)
                .foregroundStyle(.secondary)
            + Text(fileName)
                .foregroundStyle(allReviewed ? .secondary : .primary)

            Spacer()

            if hunkCount > 0 {
                Text("\(reviewedCount)/\(hunkCount)")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(allReviewed ? Color.statusApproved : .secondary)
            }
        }
        .lineLimit(1)
    }
}
