import SwiftUI
import UserNotifications

struct ReviewsListView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var reviews: [GlobalReviewSummary] = []
    @State private var avatarURLs: [String: URL] = [:]
    @State private var isLoading = true
    @State private var error: String?
    @State private var showSettings = false
    @State private var showNewReview = false
    @State private var navigationPath = NavigationPath()

    /// A review is considered active when its diff has any changed files, additions, or deletions.
    /// Reviews without stats default to active (shown).
    private var activeReviews: [GlobalReviewSummary] {
        reviews.filter { $0.diffStats?.hasChanges ?? true }
    }

    private var uniqueRepos: [RepoInfo] {
        let allReviews = (connectionManager.serverInfo?.repos ?? []) + reviews
        var seen = Set<String>()
        return allReviews.compactMap { review in
            seen.insert(review.repoPath).inserted
                ? RepoInfo(path: review.repoPath, name: review.repoName)
                : nil
        }
    }

    private var inactiveReviews: [GlobalReviewSummary] {
        reviews.filter { $0.diffStats.map { !$0.hasChanges } ?? false }
    }

    var body: some View {
        NavigationStack(path: $navigationPath) {
            Group {
                if isLoading && reviews.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    ContentUnavailableView {
                        Label("Connection Error", systemImage: "wifi.slash")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") {
                            Task { await loadReviews() }
                        }
                    }
                } else if activeReviews.isEmpty && inactiveReviews.isEmpty {
                    ContentUnavailableView {
                        Label("No Reviews", systemImage: "doc.text.magnifyingglass")
                    } description: {
                        Text("Tap + to start a new review.")
                    }
                } else {
                    List {
                        reviewRows(activeReviews)

                        if !inactiveReviews.isEmpty {
                            Section("Inactive") {
                                reviewRows(inactiveReviews)
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                    .refreshable {
                        await loadReviews()
                    }
                }
            }
            .navigationTitle("Reviews")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showNewReview = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(!connectionManager.isConnected)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gear")
                    }
                }
            }
            .sheet(isPresented: $showNewReview) {
                NewReviewView(
                    repos: uniqueRepos,
                    onStartReview: { summary in
                        Task {
                            await loadReviews()
                            navigationPath.append(summary)
                        }
                    }
                )
                .environment(connectionManager)
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .safeAreaInset(edge: .top) {
                ConnectionStatusBanner()
            }
            .navigationDestination(for: GlobalReviewSummary.self) { review in
                ReviewDetailView(review: review)
                    .environment(connectionManager)
            }
            .task {
                await loadReviews()
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(30))
                    await loadReviews()
                }
            }
        }
    }

    private func reviewRows(_ reviews: [GlobalReviewSummary]) -> some View {
        ForEach(reviews) { review in
            NavigationLink(value: review) {
                ReviewRowView(
                    review: review,
                    avatarURL: avatarURLs[review.repoPath]
                )
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button(role: .destructive) {
                    Task { await deleteReview(review) }
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
        }
    }

    private func loadReviews() async {
        guard connectionManager.status != .connectionLost else {
            isLoading = false
            return
        }

        guard let client = connectionManager.apiClient else {
            error = "Not connected"
            isLoading = false
            return
        }

        do {
            let fetched = try await client.getReviewsGlobal()
            reviews = fetched
            error = nil
            isLoading = false

            try? await UNUserNotificationCenter.current().setBadgeCount(activeReviews.count)

            await loadAvatarURLs(client: client, reviews: fetched)
        } catch {
            if reviews.isEmpty {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func deleteReview(_ review: GlobalReviewSummary) async {
        guard let client = connectionManager.apiClient else { return }

        do {
            try await client.deleteReview(repoPath: review.repoPath, comparison: review.comparison)
            reviews.removeAll { $0.id == review.id }
        } catch {
            // Silently fail — next refresh will restore the list
        }
    }

    private func loadAvatarURLs(client: APIClient, reviews: [GlobalReviewSummary]) async {
        let uniqueRepoPaths = Set(reviews.map(\.repoPath))
        for repoPath in uniqueRepoPaths {
            if avatarURLs[repoPath] != nil { continue }
            do {
                let info = try await client.getRemoteInfo(repoPath: repoPath)
                if let url = avatarURL(from: info.browseUrl) {
                    avatarURLs[repoPath] = url
                }
            } catch {
                // Silently skip — row will show initials fallback
            }
        }
    }

    private func avatarURL(from browseUrl: String) -> URL? {
        guard browseUrl.contains("github.com"),
              let url = URL(string: browseUrl) else {
            return nil
        }
        let components = url.pathComponents
        guard components.count >= 2 else { return nil }
        let org = components[1]
        return URL(string: "https://github.com/\(org).png?size=72")
    }
}
