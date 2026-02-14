import SwiftUI

struct AnnotationEditorView: View {
    @Environment(ReviewStateManager.self) private var stateManager
    @Environment(\.dismiss) private var dismiss

    let filePath: String
    let lineNumber: Int
    let side: LineAnnotation.AnnotationSide

    /// If editing an existing annotation, pass it here
    var existingAnnotation: LineAnnotation?

    @State private var content: String = ""

    private var isEditing: Bool { existingAnnotation != nil }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Image(systemName: "text.bubble")
                        .foregroundStyle(.yellow)
                    Text("\(fileName):\(lineNumber)")
                        .font(.system(.subheadline, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.vertical, 12)

                Divider()

                TextEditor(text: $content)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(minHeight: 120)
            }
            .navigationTitle(isEditing ? "Edit Annotation" : "Add Annotation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                    }
                    .disabled(content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                if isEditing {
                    ToolbarItem(placement: .bottomBar) {
                        Button("Delete Annotation", role: .destructive) {
                            deleteAnnotation()
                        }
                    }
                }
            }
            .onAppear {
                if let existing = existingAnnotation {
                    content = existing.content
                }
            }
        }
    }

    private var fileName: String {
        filePath.split(separator: "/").last.map(String.init) ?? filePath
    }

    private func save() {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if let existing = existingAnnotation {
            stateManager.updateAnnotation(id: existing.id, content: trimmed)
        } else {
            let timestamp = Int(Date().timeIntervalSince1970 * 1000)
            let id = "\(filePath):\(lineNumber):\(side.rawValue):\(timestamp)"
            let annotation = LineAnnotation(
                id: id,
                filePath: filePath,
                lineNumber: lineNumber,
                endLineNumber: nil,
                side: side,
                content: trimmed,
                createdAt: ISO8601DateFormatter().string(from: Date())
            )
            stateManager.addAnnotation(annotation)
        }

        dismiss()
    }

    private func deleteAnnotation() {
        if let existing = existingAnnotation {
            stateManager.deleteAnnotation(id: existing.id)
        }
        dismiss()
    }
}
