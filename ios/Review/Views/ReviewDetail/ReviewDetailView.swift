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

enum ReviewTab: Int, CaseIterable {
    case changes, browse, trust

    var title: String {
        switch self {
        case .changes: "Changes"
        case .browse: "Browse"
        case .trust: "Trust"
        }
    }
}

struct ReviewDetailView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    let review: GlobalReviewSummary

    @State private var selectedTab: ReviewTab = .changes
    @State private var files: [FileEntry] = []
    @State private var hunks: [DiffHunk] = []
    @State private var stateManager = ReviewStateManager()
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var showFeedbackPanel = false

    private var repoPath: String { review.repoPath }
    private var comparison: Comparison { review.comparison }

    private var changedFiles: [FileEntry] {
        flattenFiles(files).filter { hasChangeStatus($0.status) }
    }

    private var feedbackCount: Int {
        guard let state = stateManager.reviewState else { return 0 }
        let rejectedCount = state.hunks.values.filter { $0.status == .rejected }.count
        let annotationCount = state.annotations.count
        let hasNotes = !state.notes.isEmpty ? 1 : 0
        return rejectedCount + annotationCount + hasNotes
    }

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
                    ForEach(ReviewTab.allCases, id: \.self) { tab in
                        Text(tab.title).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)

                tabContent
            }
        }
        .overlay(alignment: .bottomTrailing) {
            FeedbackButton(count: feedbackCount) {
                showFeedbackPanel = true
            }
            .padding()
        }
        .sheet(isPresented: $showFeedbackPanel) {
            FeedbackPanelView()
                .environment(stateManager)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(.regularMaterial)
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
        case .changes:
            ChangesTabWrapper(
                changedFiles: changedFiles,
                hunks: hunks,
                repoPath: repoPath,
                comparison: comparison
            )
        case .browse:
            BrowseTabWrapper(
                files: files,
                changedFiles: changedFiles,
                hunks: hunks,
                repoPath: repoPath,
                comparison: comparison
            )
        case .trust:
            TrustListView(
                repoPath: repoPath,
                hunks: hunks
            )
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
                        segment(count: stats.savedForLaterHunks, total: stats.totalHunks, width: geometry.size.width, color: .orange)
                    }
                    .frame(height: 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.progressTrackBackground)
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
                if stats.savedForLaterHunks > 0 {
                    Text("·").foregroundStyle(.tertiary)
                    Text("\(stats.savedForLaterHunks) saved")
                        .foregroundStyle(.orange.opacity(0.7))
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
