import SwiftUI

struct GuideTabView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(ReviewStateManager.self) private var stateManager
    @Environment(GuideManager.self) private var guideManager

    let hunks: [DiffHunk]
    let repoPath: String
    let comparison: Comparison

    private var guide: GuideState? {
        stateManager.reviewState?.guide
    }

    private var isStale: Bool {
        guard let guide else { return false }
        return guideManager.isGuideStale(guide: guide, currentHunks: hunks)
    }

    var body: some View {
        Group {
            if guideManager.isGenerating {
                generatingView
            } else if let guide {
                guideContentView(guide)
            } else {
                emptyView
            }
        }
    }

    private var generatingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
            Text(guideManager.isGeneratingGroups ? "Organizing hunks..." : "Generating summary...")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyView: some View {
        ContentUnavailableView {
            Label("No Guide", systemImage: "map")
        } description: {
            if let error = guideManager.groupsError {
                Text(error)
            } else {
                Text("Generate a guided review to organize hunks into logical groups.")
            }
        } actions: {
            Button {
                triggerGeneration()
            } label: {
                Text("Generate Guide")
            }
            .buttonStyle(.borderedProminent)
            .disabled(hunks.isEmpty)
        }
    }

    private func guideContentView(_ guide: GuideState) -> some View {
        List {
            if isStale {
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Guide is outdated")
                                .font(.subheadline.weight(.medium))
                            Text("Hunks have changed since this guide was generated.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Regenerate") {
                            triggerGeneration()
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
            }

            if let summary = guide.summary {
                Section {
                    Text(markdownAttributedString(summary))
                        .font(.subheadline)
                } header: {
                    Text(guide.title ?? "Summary")
                }
            }

            if let error = guideManager.summaryError {
                Section {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundStyle(.red)
                        Text("Summary failed: \(error)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section("Groups") {
                ForEach(guide.groups) { group in
                    NavigationLink(value: GroupDetailDestination(
                        group: group,
                        repoPath: repoPath,
                        comparison: comparison
                    )) {
                        GroupRowView(
                            group: group,
                            reviewState: stateManager.reviewState
                        )
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func markdownAttributedString(_ markdown: String) -> AttributedString {
        (try? AttributedString(markdown: markdown, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(markdown)
    }

    private func triggerGeneration() {
        guard let client = connectionManager.apiClient else { return }
        Task {
            await guideManager.generateGuide(
                client: client,
                repoPath: repoPath,
                comparison: comparison,
                hunks: hunks,
                reviewState: stateManager.reviewState,
                stateManager: stateManager
            )
        }
    }
}
