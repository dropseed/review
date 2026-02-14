import SwiftUI

struct ReviewsListView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var reviews: [GlobalReviewSummary] = []
    @State private var avatarURLs: [String: URL] = [:]
    @State private var isLoading = true
    @State private var error: String?
    @State private var showSettings = false

    /// A review is considered active when its diff has any changed files, additions, or deletions.
    /// Reviews without stats default to active (shown).
    private var activeReviews: [GlobalReviewSummary] {
        reviews.filter { review in
            guard let stats = review.diffStats else { return true }
            return stats.fileCount > 0 || stats.additions > 0 || stats.deletions > 0
        }
    }

    private var inactiveReviews: [GlobalReviewSummary] {
        reviews.filter { review in
            guard let stats = review.diffStats else { return false }
            return stats.fileCount == 0 && stats.additions == 0 && stats.deletions == 0
        }
    }

    var body: some View {
        NavigationStack {
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
                        Text("Start a review in the desktop app to see it here.")
                    }
                } else {
                    List {
                        ForEach(activeReviews) { review in
                            NavigationLink(value: review) {
                                ReviewRowView(
                                    review: review,
                                    avatarURL: avatarURLs[review.repoPath]
                                )
                            }
                        }

                        if !inactiveReviews.isEmpty {
                            Section("Inactive") {
                                ForEach(inactiveReviews) { review in
                                    NavigationLink(value: review) {
                                        ReviewRowView(
                                            review: review,
                                            avatarURL: avatarURLs[review.repoPath]
                                        )
                                    }
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                    .refreshable {
                        await loadReviews()
                    }
                }
            }
            .navigationTitle("Reviews")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gear")
                    }
                }
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

            await loadAvatarURLs(client: client, reviews: fetched)
        } catch {
            if reviews.isEmpty {
                self.error = error.localizedDescription
            }
            isLoading = false
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
