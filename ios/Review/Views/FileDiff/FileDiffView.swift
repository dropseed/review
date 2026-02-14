import SwiftUI

struct FileDiffView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(ReviewStateManager.self) private var stateManager

    let filePath: String
    let repoPath: String
    let comparison: Comparison

    @State private var fileContent: FileContent?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isBrowseMode = false

    // Annotation sheet state
    @State private var showAnnotationEditor = false
    @State private var annotationLineNumber = 0
    @State private var annotationSide: LineAnnotation.AnnotationSide = .new
    @State private var editingAnnotation: LineAnnotation?

    private var fileName: String {
        filePath.split(separator: "/").last.map(String.init) ?? filePath
    }

    var body: some View {
        VStack(spacing: 0) {
            if let error = stateManager.error {
                ErrorBannerView(message: error) {
                    stateManager.error = nil
                }
                .padding(.top, 4)
            }

            Group {
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage {
                    ContentUnavailableView {
                        Label("Error", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("Retry") {
                            Task { await loadFile() }
                        }
                    }
                } else if let fileContent {
                    if isBrowseMode {
                        browseView(content: fileContent.content)
                    } else {
                        changesView(hunks: fileContent.hunks)
                    }
                }
            }
        }
        .navigationTitle(fileName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Picker("Mode", selection: $isBrowseMode) {
                    Label("Changes", systemImage: "plus.forwardslash.minus")
                        .tag(false)
                    Label("Browse", systemImage: "doc.text")
                        .tag(true)
                }
                .pickerStyle(.menu)
            }
        }
        .task {
            await loadFile()
        }
        .sheet(isPresented: $showAnnotationEditor) {
            AnnotationEditorView(
                filePath: filePath,
                lineNumber: annotationLineNumber,
                side: annotationSide,
                existingAnnotation: editingAnnotation
            )
            .presentationDetents([.medium])
        }
    }

    // MARK: - Changes Mode

    @ViewBuilder
    private func changesView(hunks: [DiffHunk]) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                Text(filePath)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)

                if hunks.isEmpty {
                    ContentUnavailableView("No Changes", systemImage: "checkmark.circle", description: Text("No changes in this file"))
                        .padding(.top, 40)
                } else {
                    ForEach(hunks) { hunk in
                        let hunkAnnotations = fileAnnotations.filter { $0.filePath == filePath }
                        HunkCardView(
                            hunk: hunk,
                            hunkState: stateManager.reviewState?.hunks[hunk.id],
                            trusted: isHunkTrustedCheck(hunk),
                            annotations: hunkAnnotations,
                            onApprove: { stateManager.setHunkStatus(hunkId: hunk.id, status: .approved) },
                            onReject: { stateManager.setHunkStatus(hunkId: hunk.id, status: .rejected) },
                            onTapLineNumber: { lineNumber, side in
                                annotationLineNumber = lineNumber
                                annotationSide = side
                                editingAnnotation = nil
                                showAnnotationEditor = true
                            },
                            onEditAnnotation: { annotation in
                                annotationLineNumber = annotation.lineNumber
                                annotationSide = annotation.side
                                editingAnnotation = annotation
                                showAnnotationEditor = true
                            }
                        )
                    }
                }
            }
            .padding(.bottom, 40)
        }
    }

    // MARK: - Browse Mode

    @ViewBuilder
    private func browseView(content: String) -> some View {
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)

        ScrollView([.horizontal, .vertical]) {
            VStack(spacing: 0) {
                Text(filePath)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)

                VStack(spacing: 0) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                        HStack(spacing: 0) {
                            Text("\(index + 1)")
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.secondary.opacity(0.5))
                                .frame(width: 44, alignment: .trailing)
                                .padding(.trailing, 12)

                            Text(line.isEmpty ? " " : line)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.primary.opacity(0.8))
                                .textSelection(.enabled)
                        }
                        .padding(.vertical, 1)
                        .frame(minHeight: 20, alignment: .leading)
                    }
                }
                .padding(.vertical, 8)
            }
        }
    }

    // MARK: - Data

    private var fileAnnotations: [LineAnnotation] {
        stateManager.reviewState?.annotations ?? []
    }

    private func isHunkTrustedCheck(_ hunk: DiffHunk) -> Bool {
        guard let state = stateManager.reviewState else { return false }
        return isHunkTrusted(state.hunks[hunk.id], trustList: state.trustList)
    }

    private func loadFile() async {
        guard let client = connectionManager.apiClient else {
            errorMessage = "Not connected"
            isLoading = false
            return
        }

        do {
            fileContent = try await client.getFile(repoPath: repoPath, filePath: filePath, comparison: comparison)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
