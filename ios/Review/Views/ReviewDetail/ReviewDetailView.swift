import SwiftUI

enum FileDiffMode: Hashable {
    case changes
    case browse
}

struct FileDiffDestination: Hashable {
    let filePath: String
    let repoPath: String
    let comparison: Comparison
    let mode: FileDiffMode
}

struct ReviewDetailView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    let review: GlobalReviewSummary

    @State private var selectedTab = 0
    @State private var files: [FileEntry] = []
    @State private var hunks: [DiffHunk] = []
    @State private var stateManager = ReviewStateManager()
    @State private var isLoading = true
    @State private var loadError: String?

    private var repoPath: String { review.repoPath }
    private var comparison: Comparison { review.comparison }

    private var changedFiles: [FileEntry] {
        flattenFiles(files).filter { hasChangeStatus($0.status) }
    }

    private var sections: [ReviewDetailSection] {
        computeSections(changedFiles: changedFiles, hunks: hunks, reviewState: stateManager.reviewState)
    }

    private var stats: ReviewDetailStats {
        computeStats(hunks: hunks, reviewState: stateManager.reviewState, fileCount: changedFiles.count)
    }

    private var browseTree: [FileEntry] {
        compactTree(files)
    }

    private var hunkCountsMap: [String: HunkCounts] {
        var map: [String: HunkCounts] = [:]
        for file in changedFiles {
            map[file.path] = HunkCounts(
                total: countFileHunks(filePath: file.path, hunks: hunks),
                reviewed: countReviewedHunks(filePath: file.path, hunks: hunks, reviewState: stateManager.reviewState)
            )
        }
        return map
    }

    private let tabs = ["Changes", "Browse", "Trust", "Notes"]

    var body: some View {
        VStack(spacing: 0) {
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
                        Task { await loadData() }
                    }
                }
            } else {
                if let error = stateManager.error {
                    ErrorBannerView(message: error) {
                        stateManager.error = nil
                    }
                    .padding(.top, 4)
                }

                statsHeader

                Picker("Tab", selection: $selectedTab) {
                    ForEach(Array(tabs.enumerated()), id: \.offset) { index, tab in
                        Text(tab).tag(index)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)

                tabContent
            }
        }
        .navigationTitle(review.repoName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if stateManager.isSaving {
                ToolbarItem(placement: .topBarTrailing) {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .navigationDestination(for: FileDiffDestination.self) { destination in
            FileDiffView(
                filePath: destination.filePath,
                repoPath: destination.repoPath,
                comparison: destination.comparison
            )
            .environment(connectionManager)
            .environment(stateManager)
        }
        .refreshable {
            await loadData()
        }
        .environment(stateManager)
        .task {
            await loadData()
        }
    }

    private var statsHeader: some View {
        HStack(spacing: 24) {
            statItem(value: "\(stats.fileCount)", label: "files", color: .primary)
            statItem(value: "\(stats.reviewedHunkCount)", label: "reviewed", color: .statusApproved)
            if stats.trustedHunkCount > 0 {
                statItem(value: "\(stats.trustedHunkCount)", label: "trusted", color: .statusTrusted)
            }
            statItem(value: "\(stats.totalHunks)", label: "hunks", color: .primary)
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 4)
    }

    private func statItem(value: String, label: String, color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title2.bold().monospacedDigit())
                .foregroundStyle(color)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case 0:
            ChangesTabView(
                sections: sections,
                hunks: hunks,
                reviewState: stateManager.reviewState,
                repoPath: repoPath,
                comparison: comparison
            )
        case 1:
            BrowseTabView(
                tree: browseTree,
                hunkCounts: hunkCountsMap,
                repoPath: repoPath,
                comparison: comparison
            )
        case 2:
            TrustListView(
                repoPath: repoPath,
                hunks: hunks
            )
        case 3:
            NotesView()
        default:
            EmptyView()
        }
    }

    private func loadData() async {
        guard let client = connectionManager.apiClient else {
            loadError = "Not connected to server"
            isLoading = false
            return
        }

        loadError = nil

        async let filesResult = client.getFiles(repoPath: repoPath, comparison: comparison)
        async let stateResult: Void = stateManager.loadState(client: client, repoPath: repoPath, comparison: comparison)

        do {
            let loadedFiles = try await filesResult
            await stateResult
            files = loadedFiles

            let changed = flattenFiles(loadedFiles).filter { hasChangeStatus($0.status) }
            let paths = changed.map(\.path)

            if !paths.isEmpty {
                hunks = try await client.getAllHunks(repoPath: repoPath, comparison: comparison, filePaths: paths)
            }
        } catch {
            loadError = error.localizedDescription
        }

        isLoading = false
    }
}
