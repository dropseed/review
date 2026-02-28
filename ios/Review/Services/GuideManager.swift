import Foundation
import Observation

@MainActor
@Observable
final class GuideManager {
    var isGeneratingGroups = false
    var isGeneratingSummary = false
    var groupsError: String?
    var summaryError: String?

    var isGenerating: Bool {
        isGeneratingGroups || isGeneratingSummary
    }

    func generateGuide(
        client: APIClient,
        repoPath: String,
        comparison: Comparison,
        hunks: [DiffHunk],
        reviewState: ReviewState?,
        stateManager: ReviewStateManager
    ) async {
        groupsError = nil
        summaryError = nil

        // Step 1: Generate groups
        isGeneratingGroups = true
        let groups: [HunkGroup]
        do {
            groups = try await client.generateGroups(
                repoPath: repoPath,
                comparison: comparison,
                hunks: hunks,
                reviewState: reviewState
            )
        } catch {
            groupsError = error.localizedDescription
            isGeneratingGroups = false
            return
        }
        isGeneratingGroups = false

        // Save groups immediately
        let hunkIds = hunks.map(\.id)
        let generated = GuideGenerated(
            groups: groups,
            hunkIds: hunkIds,
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            title: nil,
            summary: nil
        )
        let guide = Guide(
            autoStart: reviewState?.guide?.autoStart,
            state: generated
        )
        stateManager.updateGuide(guide)

        // Step 2: Generate summary
        isGeneratingSummary = true
        do {
            let result = try await client.generateSummary(
                repoPath: repoPath,
                comparison: comparison,
                hunks: hunks,
                reviewState: reviewState
            )
            let updatedGenerated = GuideGenerated(
                groups: groups,
                hunkIds: hunkIds,
                generatedAt: generated.generatedAt,
                title: result.title,
                summary: result.summary
            )
            let updatedGuide = Guide(
                autoStart: guide.autoStart,
                state: updatedGenerated
            )
            stateManager.updateGuide(updatedGuide)
        } catch {
            summaryError = error.localizedDescription
        }
        isGeneratingSummary = false
    }

    func isGuideStale(guide: Guide, currentHunks: [DiffHunk]) -> Bool {
        guard let generated = guide.state else { return false }
        return Set(generated.hunkIds) != Set(currentHunks.map(\.id))
    }
}
