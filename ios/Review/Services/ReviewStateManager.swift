import Foundation
import Observation

@MainActor
@Observable
final class ReviewStateManager {
    var reviewState: ReviewState?
    var isLoading = false
    var isSaving = false
    var error: String?

    private var apiClient: APIClient?
    private var repoPath: String?
    private var saveTask: Task<Void, Never>?
    private let debounceInterval: Duration = .milliseconds(500)

    func loadState(client: APIClient, repoPath: String, comparison: Comparison) async {
        self.apiClient = client
        self.repoPath = repoPath
        isLoading = true
        error = nil

        do {
            reviewState = try await client.getState(repoPath: repoPath, comparison: comparison)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    func setHunkStatus(hunkId: String, status: HunkStatus) {
        guard var state = reviewState else { return }

        var hunkState = state.hunks[hunkId] ?? HunkState(label: [])
        hunkState.status = (hunkState.status == status) ? nil : status
        state.hunks[hunkId] = hunkState
        state.version += 1
        state.updatedAt = ISO8601DateFormatter().string(from: Date())
        reviewState = state

        scheduleSave()
    }

    func toggleTrustPattern(_ pattern: String) {
        guard var state = reviewState else { return }

        if let index = state.trustList.firstIndex(of: pattern) {
            state.trustList.remove(at: index)
        } else {
            state.trustList.append(pattern)
        }
        state.version += 1
        state.updatedAt = ISO8601DateFormatter().string(from: Date())
        reviewState = state

        scheduleSave()
    }

    func updateNotes(_ notes: String) {
        guard var state = reviewState else { return }

        state.notes = notes
        state.version += 1
        state.updatedAt = ISO8601DateFormatter().string(from: Date())
        reviewState = state

        scheduleSave()
    }

    func addAnnotation(_ annotation: LineAnnotation) {
        guard var state = reviewState else { return }

        state.annotations.append(annotation)
        state.version += 1
        state.updatedAt = ISO8601DateFormatter().string(from: Date())
        reviewState = state

        scheduleSave()
    }

    func updateAnnotation(id: String, content: String) {
        guard var state = reviewState else { return }

        if let index = state.annotations.firstIndex(where: { $0.id == id }) {
            let old = state.annotations[index]
            let updated = LineAnnotation(
                id: old.id,
                filePath: old.filePath,
                lineNumber: old.lineNumber,
                endLineNumber: old.endLineNumber,
                side: old.side,
                content: content,
                createdAt: old.createdAt
            )
            state.annotations[index] = updated
            state.version += 1
            state.updatedAt = ISO8601DateFormatter().string(from: Date())
            reviewState = state

            scheduleSave()
        }
    }

    func deleteAnnotation(id: String) {
        guard var state = reviewState else { return }

        state.annotations.removeAll { $0.id == id }
        state.version += 1
        state.updatedAt = ISO8601DateFormatter().string(from: Date())
        reviewState = state

        scheduleSave()
    }

    // MARK: - Debounced Save

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: self?.debounceInterval ?? .milliseconds(500))
            guard !Task.isCancelled else { return }
            await self?.performSave()
        }
    }

    private func performSave() async {
        guard let state = reviewState,
              let client = apiClient,
              let repoPath = repoPath else { return }

        isSaving = true
        do {
            try await client.saveState(repoPath: repoPath, state: state)
        } catch {
            self.error = "Save failed: \(error.localizedDescription)"
        }
        isSaving = false
    }
}
