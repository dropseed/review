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

                ConnectionStatusBanner()

                StatsHeaderView(hunks: hunks, fileCount: changedFiles.count)

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
                comparison: destination.comparison,
                initialMode: destination.mode
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

    // statsHeader is now StatsHeaderView (separate observation scope)

    @ViewBuilder
    private var tabContent: some View {
        switch selectedTab {
        case 0:
            ChangesTabWrapper(
                changedFiles: changedFiles,
                hunks: hunks,
                repoPath: repoPath,
                comparison: comparison
            )
        case 1:
            BrowseTabWrapper(
                files: files,
                changedFiles: changedFiles,
                hunks: hunks,
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

            stateManager.syncTotalDiffHunks(hunks.count)
        } catch {
            loadError = error.localizedDescription
        }

        isLoading = false
    }
}

// MARK: - Tab Wrappers (isolated observation scopes)

private struct ChangesTabWrapper: View {
    @Environment(ReviewStateManager.self) private var stateManager
    let changedFiles: [FileEntry]
    let hunks: [DiffHunk]
    let repoPath: String
    let comparison: Comparison

    var body: some View {
        let sections = computeSections(changedFiles: changedFiles, hunks: hunks, reviewState: stateManager.reviewState)
        ChangesTabView(
            sections: sections,
            hunks: hunks,
            reviewState: stateManager.reviewState,
            repoPath: repoPath,
            comparison: comparison
        )
    }
}

private struct BrowseTabWrapper: View {
    @Environment(ReviewStateManager.self) private var stateManager
    let files: [FileEntry]
    let changedFiles: [FileEntry]
    let hunks: [DiffHunk]
    let repoPath: String
    let comparison: Comparison

    var body: some View {
        let hunkCounts: [String: HunkCounts] = {
            var map: [String: HunkCounts] = [:]
            for file in changedFiles {
                map[file.path] = HunkCounts(
                    total: countFileHunks(filePath: file.path, hunks: hunks),
                    reviewed: countReviewedHunks(filePath: file.path, hunks: hunks, reviewState: stateManager.reviewState)
                )
            }
            return map
        }()
        BrowseTabView(
            tree: compactTree(files),
            hunkCounts: hunkCounts,
            repoPath: repoPath,
            comparison: comparison
        )
    }
}

// MARK: - Stats Header (isolated observation scope)

private struct StatsHeaderView: View {
    @Environment(ReviewStateManager.self) private var stateManager
    let hunks: [DiffHunk]
    let fileCount: Int

    private var stats: ReviewDetailStats {
        computeStats(hunks: hunks, reviewState: stateManager.reviewState, fileCount: fileCount)
    }

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 10) {
                Text("\(stats.reviewedPercent)")
                    .font(.title3.bold().monospacedDigit())
                + Text("%")
                    .font(.caption.weight(.medium))
                    .foregroundColor(.secondary)

                GeometryReader { geometry in
                    HStack(spacing: 0) {
                        segment(count: stats.trustedHunks, total: stats.totalHunks, width: geometry.size.width, color: .cyan)
                        segment(count: stats.approvedHunks, total: stats.totalHunks, width: geometry.size.width, color: .green)
                        segment(count: stats.rejectedHunks, total: stats.totalHunks, width: geometry.size.width, color: .red)
                    }
                    .frame(height: 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.08))
                    .clipShape(Capsule())
                }
                .frame(height: 6)

                if stats.state == "approved" {
                    Text("Approved")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.green)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.green.opacity(0.15), in: Capsule())
                } else if stats.state == "changes_requested" {
                    Text("Changes")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.red)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.red.opacity(0.15), in: Capsule())
                }
            }

            HStack(spacing: 4) {
                Text("\(stats.trustedHunks) trusted")
                    .foregroundStyle(.cyan.opacity(0.7))
                Text("·").foregroundStyle(.tertiary)
                Text("\(stats.approvedHunks) approved")
                    .foregroundStyle(.green.opacity(0.7))
                if stats.rejectedHunks > 0 {
                    Text("·").foregroundStyle(.tertiary)
                    Text("\(stats.rejectedHunks) rejected")
                        .foregroundStyle(.red.opacity(0.7))
                }
                Text("·").foregroundStyle(.tertiary)
                Text("\(stats.pendingHunks) pending")
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(stats.reviewedHunks)/\(stats.totalHunks)")
                    .foregroundStyle(.tertiary)
            }
            .font(.caption2.monospacedDigit())
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 4)
    }

    private func segment(count: Int, total: Int, width: CGFloat, color: Color) -> some View {
        Group {
            if count > 0 && total > 0 {
                color
                    .frame(width: width * CGFloat(count) / CGFloat(total))
            }
        }
    }
}
