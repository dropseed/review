import SwiftUI

struct BrowseTabView: View {
    let tree: [FileEntry]
    let hunkCounts: [String: HunkCounts]
    let repoPath: String
    let comparison: Comparison

    var body: some View {
        List {
            ForEach(tree) { entry in
                FileTreeNodeView(
                    entry: entry,
                    hunkCounts: hunkCounts,
                    repoPath: repoPath,
                    comparison: comparison
                )
            }
        }
        .listStyle(.insetGrouped)
    }
}

struct HunkCounts {
    let total: Int
    let reviewed: Int
}

struct FileTreeNodeView: View {
    let entry: FileEntry
    let hunkCounts: [String: HunkCounts]
    let repoPath: String
    let comparison: Comparison

    var body: some View {
        if entry.isDirectory {
            DisclosureGroup {
                if let children = entry.children {
                    ForEach(children) { child in
                        FileTreeNodeView(
                            entry: child,
                            hunkCounts: hunkCounts,
                            repoPath: repoPath,
                            comparison: comparison
                        )
                    }
                }
            } label: {
                HStack {
                    Label(entry.name + "/", systemImage: "folder")
                        .foregroundStyle(.secondary)
                    Spacer()
                    if let children = entry.children {
                        Text("\(countFiles(children))")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .monospacedDigit()
                    }
                }
            }
        } else {
            NavigationLink(value: FileDiffDestination(
                filePath: entry.path,
                repoPath: repoPath,
                comparison: comparison,
                mode: .browse
            )) {
                fileRow
            }
        }
    }

    @ViewBuilder
    private var fileRow: some View {
        let counts = hunkCounts[entry.path]
        let allReviewed = counts.map { $0.total > 0 && $0.reviewed >= $0.total } ?? false

        HStack(spacing: 8) {
            if let status = entry.status {
                Text(statusLabel(for: status))
                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                    .foregroundStyle(statusColor(for: status))
                    .frame(width: 16)
            }

            Text(entry.name)
                .foregroundStyle(allReviewed ? .secondary : .primary)

            Spacer()

            if let counts, counts.total > 0 {
                Text("\(counts.reviewed)/\(counts.total)")
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(allReviewed ? Color.statusApproved : .secondary)
            }
        }
    }

    private func statusLabel(for status: FileEntry.FileStatus) -> String {
        switch status {
        case .added: return "A"
        case .modified: return "M"
        case .deleted: return "D"
        case .renamed: return "R"
        case .untracked: return "U"
        case .gitignored: return "I"
        }
    }

    private func statusColor(for status: FileEntry.FileStatus) -> Color {
        switch status {
        case .added, .untracked: return .fileAdded
        case .modified: return .fileModified
        case .deleted: return .fileDeleted
        case .renamed: return .fileRenamed
        case .gitignored: return .secondary
        }
    }
}
