import SwiftUI

struct ReviewOverviewPanel: View {
    @Environment(ReviewStateManager.self) private var stateManager
    @Environment(\.dismiss) private var dismiss

    private var state: ReviewState? { stateManager.reviewState }
    private var pr: GitHubPrRef? { state?.githubPr }
    private var guide: GuideState? { state?.guide }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let pr {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("PR #\(pr.number)")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                            Text(pr.title)
                                .font(.headline)
                        }

                        Label {
                            Text("\(pr.headRefName) → \(pr.baseRefName)")
                                .font(.subheadline.monospaced())
                                .lineLimit(1)
                                .truncationMode(.middle)
                        } icon: {
                            Image(systemName: "arrow.triangle.branch")
                        }
                    } else if let comparison = state?.comparison {
                        Label {
                            Text("\(comparison.base)..\(comparison.head)")
                                .font(.subheadline.monospaced())
                                .lineLimit(1)
                                .truncationMode(.middle)
                        } icon: {
                            Image(systemName: "arrow.triangle.branch")
                        }
                    }
                }

                if let body = pr?.body, !body.isEmpty {
                    Section("Description") {
                        Text(body)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                if let summary = guide?.summary, !summary.isEmpty {
                    Section("Summary") {
                        Text(summary)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Review Overview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
