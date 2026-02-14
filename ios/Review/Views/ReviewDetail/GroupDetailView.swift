import SwiftUI

struct GroupDetailView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(ReviewStateManager.self) private var stateManager

    let group: HunkGroup
    let repoPath: String
    let comparison: Comparison

    @State private var groupHunks: [DiffHunk] = []
    @State private var isLoading = true
    @State private var loadError: String?

    private var reviewedCount: Int {
        guard let reviewState = stateManager.reviewState else { return 0 }
        return group.hunkIds.filter { hunkId in
            let status = getHunkReviewStatus(reviewState.hunks[hunkId], trustList: reviewState.trustList)
            return status != .pending
        }.count
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Failed to Load", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Retry") {
                        Task { await loadHunks() }
                    }
                }
            } else {
                hunksList
            }
        }
        .navigationTitle(group.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        let hunkIds = filteredHunks.map(\.id)
                        stateManager.setHunkStatuses(hunkIds: hunkIds, status: .approved)
                    } label: {
                        Label("Approve All", systemImage: "checkmark.circle")
                    }
                    Button {
                        let hunkIds = filteredHunks.map(\.id)
                        stateManager.setHunkStatuses(hunkIds: hunkIds, status: .rejected)
                    } label: {
                        Label("Reject All", systemImage: "xmark.circle")
                    }
                    Divider()
                    Button(role: .destructive) {
                        let hunkIds = filteredHunks.map(\.id)
                        stateManager.setHunkStatuses(hunkIds: hunkIds, status: nil)
                    } label: {
                        Label("Reset All", systemImage: "arrow.counterclockwise")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .task {
            await loadHunks()
        }
    }

    private var filteredHunks: [DiffHunk] {
        let idSet = Set(group.hunkIds)
        return groupHunks.filter { idSet.contains($0.id) }
    }

    private var hunksList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // Group header
                VStack(alignment: .leading, spacing: 8) {
                    Text(group.description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    HStack(spacing: 8) {
                        if let phase = group.phase {
                            Text(phase)
                                .font(.caption2.weight(.medium))
                                .foregroundStyle(.purple)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.purple.opacity(0.12), in: Capsule())
                        }
                        Text("\(reviewedCount)/\(group.hunkIds.count) reviewed")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding()

                // Hunks grouped by file
                let hunksByFile = Dictionary(grouping: filteredHunks, by: \.filePath)
                let orderedFiles = filteredHunks.map(\.filePath).uniqued()

                ForEach(orderedFiles, id: \.self) { filePath in
                    if let fileHunks = hunksByFile[filePath] {
                        Text(filePath)
                            .font(.caption.weight(.medium).monospaced())
                            .foregroundStyle(.secondary)
                            .padding(.horizontal)
                            .padding(.top, 12)
                            .padding(.bottom, 4)

                        ForEach(fileHunks) { hunk in
                            let hunkState = stateManager.reviewState?.hunks[hunk.id]
                            let trusted = isHunkTrusted(hunkState, trustList: stateManager.reviewState?.trustList ?? [])
                            let annotations = stateManager.reviewState?.annotations.filter { $0.filePath == hunk.filePath } ?? []

                            HunkCardView(
                                hunk: hunk,
                                hunkState: hunkState,
                                trusted: trusted,
                                annotations: annotations,
                                onApprove: { stateManager.setHunkStatus(hunkId: hunk.id, status: .approved) },
                                onReject: { stateManager.setHunkStatus(hunkId: hunk.id, status: .rejected) },
                                onSaveForLater: { stateManager.setHunkStatus(hunkId: hunk.id, status: .savedForLater) }
                            )
                            .padding(.horizontal)
                        }
                    }
                }
            }
            .padding(.bottom)
        }
    }

    private func loadHunks() async {
        guard let client = connectionManager.apiClient else {
            loadError = "Not connected to server"
            isLoading = false
            return
        }

        // Extract unique file paths from hunk IDs (format: filePath:contentHash)
        let filePaths = group.hunkIds.compactMap { hunkId -> String? in
            guard let lastColon = hunkId.lastIndex(of: ":") else { return nil }
            return String(hunkId[hunkId.startIndex..<lastColon])
        }
        let uniquePaths = Array(Set(filePaths))

        guard !uniquePaths.isEmpty else {
            isLoading = false
            return
        }

        do {
            groupHunks = try await client.getAllHunks(repoPath: repoPath, comparison: comparison, filePaths: uniquePaths)
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - Array uniqued helper

private extension Array where Element: Hashable {
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}
