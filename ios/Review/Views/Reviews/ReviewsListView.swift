import SwiftUI

struct ReviewsListView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var reviews: [GlobalReviewSummary] = []
    @State private var diffStats: [String: DiffShortStat] = [:]
    @State private var avatarURLs: [String: URL] = [:]
    @State private var isLoading = true
    @State private var error: String?
    @State private var showSettings = false

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
                } else if reviews.isEmpty {
                    ContentUnavailableView {
                        Label("No Reviews", systemImage: "doc.text.magnifyingglass")
                    } description: {
                        Text("Start a review in the desktop app to see it here.")
                    }
                } else {
                    List(reviews) { review in
                        NavigationLink(value: review) {
                            ReviewRowView(
                                review: review,
                                diffStats: diffStats[review.id],
                                avatarURL: avatarURLs[review.repoPath]
                            )
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

            await loadDiffStats(client: client, reviews: fetched)
            await loadAvatarURLs(client: client, reviews: fetched)
        } catch {
            if reviews.isEmpty {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }

    private func loadDiffStats(client: APIClient, reviews: [GlobalReviewSummary]) async {
        for review in reviews {
            let key = review.id
            if diffStats[key] != nil { continue }
            do {
                let stats = try await client.getDiffShortStat(
                    repoPath: review.repoPath,
                    comparison: review.comparison
                )
                diffStats[key] = stats
            } catch {
                // Silently skip — row will display without stats
            }
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
        // browseUrl is like "https://github.com/org/repo"
        let components = url.pathComponents
        guard components.count >= 2 else { return nil }
        let org = components[1]
        return URL(string: "https://github.com/\(org).png?size=72")
    }
}
