import SwiftUI

struct NewReviewView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(\.dismiss) private var dismiss

    let repos: [RepoInfo]
    let onStartReview: (GlobalReviewSummary) -> Void

    @State private var selectedRepo: RepoInfo?
    @State private var githubAvailable = false
    @State private var pullRequests: [PullRequest] = []
    @State private var branches: BranchList?
    @State private var defaultBranch: String = "main"
    @State private var selectedBase: String = ""
    @State private var selectedHead: String = ""
    @State private var isLoadingPRs = true
    @State private var isLoadingBranches = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if repos.count > 1 && selectedRepo == nil {
                    repoPicker
                } else {
                    comparisonPicker
                }
            }
            .navigationTitle("New Review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    // MARK: - Repo Picker

    private var repoPicker: some View {
        List(repos) { repo in
            Button {
                selectedRepo = repo
                Task { await loadRepoData(repoPath: repo.path) }
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(repo.name)
                            .font(.body.weight(.semibold))
                        Text(repo.path)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundStyle(.tertiary)
                }
            }
            .tint(.primary)
        }
    }

    // MARK: - Comparison Picker

    private var comparisonPicker: some View {
        List {
            if let error {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                }
            }

            if githubAvailable {
                prSection
            }

            branchSection
        }
        .task {
            guard let repo = effectiveRepo else { return }
            await loadRepoData(repoPath: repo.path)
        }
    }

    // MARK: - PR Section

    @ViewBuilder
    private var prSection: some View {
        Section {
            if isLoadingPRs {
                ProgressView()
                    .frame(maxWidth: .infinity)
            } else if pullRequests.isEmpty {
                Text("No open pull requests")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(pullRequests) { pr in
                    Button {
                        startReviewFromPR(pr)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 4) {
                                Text("#\(pr.number)")
                                    .foregroundStyle(.secondary)
                                Text(pr.title)
                                    .lineLimit(2)
                                if pr.isDraft {
                                    Text("Draft")
                                        .font(.caption2.weight(.medium))
                                        .foregroundStyle(.secondary)
                                        .padding(.horizontal, 5)
                                        .padding(.vertical, 1)
                                        .background(.quaternary, in: Capsule())
                                }
                            }
                            .font(.subheadline.weight(.medium))

                            Text("\(pr.headRefName) → \(pr.baseRefName)")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 2)
                    }
                    .tint(.primary)
                }
            }
        } header: {
            Text("Pull Requests")
        }
    }

    // MARK: - Branch Section

    @ViewBuilder
    private var branchSection: some View {
        Section {
            if isLoadingBranches {
                ProgressView()
                    .frame(maxWidth: .infinity)
            } else if let branches, !branches.local.isEmpty {
                Picker("Base", selection: $selectedBase) {
                    ForEach(allBranches(branches), id: \.self) { branch in
                        Text(branch).tag(branch)
                    }
                }

                Picker("Head", selection: $selectedHead) {
                    ForEach(allBranches(branches), id: \.self) { branch in
                        Text(branch).tag(branch)
                    }
                }

                Button("Start Review") {
                    startReviewFromBranches()
                }
                .disabled(selectedBase.isEmpty || selectedHead.isEmpty || selectedBase == selectedHead)
            } else {
                Text("No branches available")
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Manual")
        }
    }

    // MARK: - Data Loading

    private var effectiveRepo: RepoInfo? {
        selectedRepo ?? (repos.count == 1 ? repos.first : nil)
    }

    private func allBranches(_ branches: BranchList) -> [String] {
        branches.local + branches.remote
    }

    private func loadRepoData(repoPath: String) async {
        guard let client = connectionManager.apiClient else { return }

        error = nil
        isLoadingPRs = true
        isLoadingBranches = true

        let ghAvail = (try? await client.checkGitHubAvailable(repoPath: repoPath)) ?? false
        githubAvailable = ghAvail

        if ghAvail {
            pullRequests = (try? await client.listPullRequests(repoPath: repoPath)) ?? []
        }
        isLoadingPRs = false

        let loadedBranches = try? await client.getBranches(repoPath: repoPath)
        let loadedDefault = (try? await client.getDefaultBranch(repoPath: repoPath)) ?? "main"

        branches = loadedBranches
        defaultBranch = loadedDefault
        selectedBase = loadedDefault

        if let loadedBranches {
            let all = allBranches(loadedBranches)
            if let firstNonBase = all.first(where: { $0 != loadedDefault }) {
                selectedHead = firstNonBase
            }
        }

        isLoadingBranches = false
    }

    // MARK: - Start Review

    private func startReviewFromPR(_ pr: PullRequest) {
        let githubPr = GitHubPrRef(
            number: pr.number,
            title: pr.title,
            headRefName: pr.headRefName,
            baseRefName: pr.baseRefName,
            body: pr.body
        )
        startReview(base: pr.baseRefName, head: pr.headRefName, githubPr: githubPr)
    }

    private func startReviewFromBranches() {
        startReview(base: selectedBase, head: selectedHead, githubPr: nil)
    }

    private func startReview(base: String, head: String, githubPr: GitHubPrRef?) {
        guard let repo = effectiveRepo else { return }

        let comparison = Comparison(base: base, head: head, key: "\(base)..\(head)")
        let summary = GlobalReviewSummary(
            repoPath: repo.path,
            repoName: repo.name,
            comparison: comparison,
            githubPr: githubPr,
            totalHunks: 0,
            trustedHunks: 0,
            approvedHunks: 0,
            reviewedHunks: 0,
            rejectedHunks: 0,
            state: nil,
            updatedAt: ISO8601DateFormatter().string(from: Date()),
            diffStats: nil
        )

        dismiss()
        onStartReview(summary)
    }
}

// MARK: - RepoInfo

struct RepoInfo: Identifiable {
    let path: String
    let name: String
    var id: String { path }
}
