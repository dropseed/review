import SwiftUI

struct TrustListView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(ReviewStateManager.self) private var stateManager
    let repoPath: String
    let hunks: [DiffHunk]

    @State private var categories: [TrustCategory] = []
    @State private var isLoading = true
    @State private var loadError: String?

    private var allPatternIds: [String] {
        categories.flatMap { $0.patterns.map(\.id) }
    }

    private var allTrusted: Bool {
        guard let trustList = stateManager.reviewState?.trustList else { return false }
        let all = allPatternIds
        return !all.isEmpty && all.allSatisfy { trustList.contains($0) }
    }

    private var totalMatchingHunks: Int {
        guard let state = stateManager.reviewState else { return 0 }
        let all = allPatternIds
        var count = 0
        for hunk in hunks {
            if let hunkState = state.hunks[hunk.id] {
                let matches = hunkState.label.contains { label in
                    all.contains { matchesPattern(label, $0) }
                }
                if matches { count += 1 }
            }
        }
        return count
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
                        Task { await loadTaxonomy() }
                    }
                }
            } else if categories.isEmpty {
                ContentUnavailableView("No Trust Patterns", systemImage: "shield", description: Text("No trust taxonomy found."))
            } else {
                List {
                    Section {
                        Toggle(isOn: Binding(
                            get: { allTrusted },
                            set: { newValue in
                                if newValue {
                                    stateManager.setTrustPatterns(allPatternIds)
                                } else {
                                    stateManager.setTrustPatterns([])
                                }
                            }
                        )) {
                            HStack {
                                Text("Trust All")
                                    .fontWeight(.medium)
                                if totalMatchingHunks > 0 {
                                    Text("\(totalMatchingHunks) hunks")
                                        .font(.caption2)
                                        .padding(.horizontal, 5)
                                        .padding(.vertical, 1)
                                        .background(.fill.tertiary)
                                        .clipShape(Capsule())
                                }
                            }
                        }
                    }

                    ForEach(categories) { category in
                        Section(category.name) {
                            ForEach(category.patterns) { pattern in
                                trustPatternRow(pattern)
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .task {
            await loadTaxonomy()
        }
    }

    private func trustPatternRow(_ pattern: TrustPattern) -> some View {
        let trustList = stateManager.reviewState?.trustList ?? []
        let isTrusted = trustList.contains(pattern.id)
        let matchCount = countMatchingHunks(patternId: pattern.id)

        return Toggle(isOn: Binding(
            get: { isTrusted },
            set: { _ in stateManager.toggleTrustPattern(pattern.id) }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(pattern.name)
                    if matchCount > 0 {
                        Text("\(matchCount)")
                            .font(.caption2)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(.fill.tertiary)
                            .clipShape(Capsule())
                    }
                }
                Text(pattern.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func countMatchingHunks(patternId: String) -> Int {
        guard let state = stateManager.reviewState else { return 0 }
        var count = 0
        for hunk in hunks {
            if let hunkState = state.hunks[hunk.id] {
                for label in hunkState.label {
                    if matchesPattern(label, patternId) {
                        count += 1
                        break
                    }
                }
            }
        }
        return count
    }

    private func loadTaxonomy() async {
        guard let client = connectionManager.apiClient else {
            loadError = "Not connected to server"
            isLoading = false
            return
        }
        loadError = nil
        isLoading = true
        do {
            categories = try await client.getTaxonomy(repoPath: repoPath)
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }
}
