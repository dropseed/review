import SwiftUI

struct FeedbackPanelView: View {
    @Environment(ReviewStateManager.self) private var stateManager
    @Environment(\.dismiss) private var dismiss

    @State private var notesText: String = ""
    @State private var hasLoaded = false

    private var rejectedHunks: [(id: String, filePath: String, status: HunkStatus)] {
        guard let state = stateManager.reviewState else { return [] }
        return state.hunks.compactMap { id, hunkState in
            guard hunkState.status == .rejected else { return nil }
            // The hunk id format is "filepath:hash"
            let filePath = String(id.prefix(while: { $0 != ":" }))
            return (id: id, filePath: filePath, status: .rejected)
        }.sorted { $0.filePath < $1.filePath }
    }

    private var annotations: [LineAnnotation] {
        stateManager.reviewState?.annotations ?? []
    }

    var body: some View {
        NavigationStack {
            List {
                notesSection
                if !rejectedHunks.isEmpty {
                    rejectedSection
                }
                if !annotations.isEmpty {
                    annotationsSection
                }
                copySection
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Review Feedback")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .onAppear {
            notesText = stateManager.reviewState?.notes ?? ""
            hasLoaded = true
        }
        .onChange(of: stateManager.reviewState?.notes) { _, newValue in
            if let newValue, newValue != notesText {
                notesText = newValue
            }
        }
    }

    // MARK: - Sections

    private var notesSection: some View {
        Section("Notes") {
            ZStack(alignment: .topLeading) {
                TextEditor(text: $notesText)
                    .scrollContentBackground(.hidden)
                    .font(.body)
                    .frame(minHeight: 120)
                    .onChange(of: notesText) { _, newValue in
                        guard hasLoaded else { return }
                        stateManager.updateNotes(newValue)
                    }

                if notesText.isEmpty {
                    Text("Add review notes...")
                        .foregroundStyle(.tertiary)
                        .font(.body)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 4)
                        .allowsHitTesting(false)
                }
            }
        }
    }

    private var rejectedSection: some View {
        Section("Changes Requested") {
            ForEach(rejectedHunks, id: \.id) { hunk in
                Label {
                    Text(hunk.filePath)
                        .font(.subheadline.monospaced())
                        .lineLimit(1)
                        .truncationMode(.middle)
                } icon: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.red)
                }
            }
        }
    }

    private var annotationsSection: some View {
        Section("Line Comments") {
            ForEach(annotations) { annotation in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 4) {
                        Text(annotation.filePath)
                            .font(.caption.monospaced())
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Text(":\(annotation.lineNumber)")
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                    }
                    Text(annotation.content)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .onDelete { indexSet in
                for index in indexSet {
                    stateManager.deleteAnnotation(id: annotations[index].id)
                }
            }
        }
    }

    private var copySection: some View {
        Section {
            Button {
                copyAsMarkdown()
            } label: {
                Label("Copy as Markdown", systemImage: "doc.on.doc")
            }
        }
    }

    // MARK: - Copy

    private func copyAsMarkdown() {
        var parts: [String] = []

        let notes = stateManager.reviewState?.notes ?? ""
        if !notes.isEmpty {
            parts.append("## Notes\n\n\(notes)")
        }

        if !rejectedHunks.isEmpty {
            var section = "## Changes Requested\n"
            for hunk in rejectedHunks {
                section += "\n- `\(hunk.filePath)`"
            }
            parts.append(section)
        }

        if !annotations.isEmpty {
            var section = "## Line Comments\n"
            for annotation in annotations {
                section += "\n- `\(annotation.filePath):\(annotation.lineNumber)` — \(annotation.content)"
            }
            parts.append(section)
        }

        UIPasteboard.general.string = parts.joined(separator: "\n\n")
    }
}
