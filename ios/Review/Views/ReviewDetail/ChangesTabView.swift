import SwiftUI

struct ChangesTabView: View {
    @Environment(ReviewStateManager.self) private var stateManager
    let sections: [ReviewDetailSection]
    let hunks: [DiffHunk]
    let reviewState: ReviewState?
    let repoPath: String
    let comparison: Comparison

    var body: some View {
        if sections.isEmpty {
            ContentUnavailableView("No Changed Files", systemImage: "doc.text", description: Text("No files with changes were found."))
        } else {
            List {
                ForEach(sections) { section in
                    Section(section.title) {
                        ForEach(section.data) { file in
                            NavigationLink(value: FileDiffDestination(
                                filePath: file.path,
                                repoPath: repoPath,
                                comparison: comparison,
                                mode: .changes
                            )) {
                                FileRowView(
                                    file: file,
                                    hunkCount: countFileHunks(filePath: file.path, hunks: hunks),
                                    reviewedCount: countReviewedHunks(filePath: file.path, hunks: hunks, reviewState: reviewState)
                                )
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button {
                                    approveFile(file.path)
                                } label: {
                                    Label("Approve", systemImage: "checkmark")
                                }
                                .tint(.green)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    private func approveFile(_ filePath: String) {
        let hunkIds = hunks.filter { $0.filePath == filePath }.map(\.id)
        stateManager.setHunkStatuses(hunkIds: hunkIds, status: .approved)
    }
}
