import SwiftUI

struct FileDiffView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(ReviewStateManager.self) private var stateManager

    let filePath: String
    let repoPath: String
    let comparison: Comparison
    var initialMode: FileDiffMode = .changes

    @State private var fileContent: FileContent?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isBrowseMode = false
    @State private var highlightedLines: [AttributedString]?

    // Expand context state
    @State private var expandedRanges: [String: ExpandedRange] = [:]
    private let expandChunkSize = 20

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
                    if fileContent.isImage {
                        ImageDiffView(
                            imageDataUrl: fileContent.imageDataUrl,
                            oldImageDataUrl: fileContent.oldImageDataUrl,
                            filePath: filePath
                        )
                    } else if isBrowseMode {
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
                Button {
                    isBrowseMode.toggle()
                } label: {
                    Image(systemName: isBrowseMode ? "plus.forwardslash.minus" : "doc.text")
                }
            }
        }
        .onAppear {
            isBrowseMode = initialMode == .browse
        }
        .task {
            await loadFile()
            if let content = fileContent?.content {
                let ext = filePath.split(separator: ".").last.map(String.init)
                highlightedLines = await SyntaxHighlighter.highlightLines(code: content, fileExtension: ext)
            }
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

    private var newLineCount: Int {
        guard let content = fileContent?.content, !content.isEmpty else { return 0 }
        return content.split(separator: "\n", omittingEmptySubsequences: false).count
    }

    private var oldLineCount: Int {
        guard let content = fileContent?.oldContent, !content.isEmpty else { return 0 }
        return content.split(separator: "\n", omittingEmptySubsequences: false).count
    }

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
                    let gaps = computeGaps(hunks: hunks, newLineCount: newLineCount, oldLineCount: oldLineCount)

                    ForEach(Array(hunks.enumerated()), id: \.element.id) { index, hunk in
                        // Gap before this hunk
                        if let gap = gapBefore(index: index, gaps: gaps) {
                            expandableGapView(gap: gap)
                        }

                        // The hunk itself
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

                        // Gap after last hunk
                        if index == hunks.count - 1, let gap = gapAfter(gaps: gaps) {
                            expandableGapView(gap: gap)
                        }
                    }
                }
            }
            .padding(.bottom, 40)
        }
    }

    // MARK: - Gap Helpers

    private func gapBefore(index: Int, gaps: [HunkGap]) -> HunkGap? {
        gaps.first { gap in
            switch gap.position {
            case .before: return index == 0
            case .between(_, let next): return next == index
            default: return false
            }
        }
    }

    private func gapAfter(gaps: [HunkGap]) -> HunkGap? {
        gaps.first { gap in
            if case .after = gap.position { return true }
            return false
        }
    }

    // MARK: - Expandable Gap View

    @ViewBuilder
    private func expandableGapView(gap: HunkGap) -> some View {
        let range = expandedRanges[gap.id] ?? ExpandedRange()
        let totalLines = gap.totalNewLines
        let remaining = totalLines - range.topExpanded - range.bottomExpanded

        if totalLines > 0, let content = fileContent?.content {
            VStack(spacing: 0) {
                // Top expanded lines
                if range.topExpanded > 0 {
                    let lines = extractContextLines(
                        from: content,
                        startLine: gap.newStartLine,
                        endLine: gap.newStartLine + range.topExpanded - 1,
                        oldStartLine: gap.oldStartLine
                    )
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        DiffLineView(line: line)
                    }
                }

                // Expand button
                if remaining > 0 {
                    ExpandContextButton(
                        remainingLines: remaining,
                        chunkSize: expandChunkSize,
                        position: gap.position
                    ) {
                        expandGap(gap: gap, remaining: remaining)
                    }
                }

                // Bottom expanded lines
                if range.bottomExpanded > 0 {
                    let bottomStart = gap.newEndLine - range.bottomExpanded + 1
                    let oldBottomStart = gap.oldEndLine - range.bottomExpanded + 1
                    let lines = extractContextLines(
                        from: content,
                        startLine: bottomStart,
                        endLine: gap.newEndLine,
                        oldStartLine: oldBottomStart
                    )
                    ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                        DiffLineView(line: line)
                    }
                }
            }
        }
    }

    private func expandGap(gap: HunkGap, remaining: Int) {
        var range = expandedRanges[gap.id] ?? ExpandedRange()
        let amount = min(expandChunkSize, remaining)

        switch gap.position {
        case .before:
            range.bottomExpanded += amount
        case .after:
            range.topExpanded += amount
        case .between:
            range.topExpanded += amount
        }

        expandedRanges[gap.id] = range
    }

    // MARK: - Browse Mode

    @ViewBuilder
    private func browseView(content: String) -> some View {
        let lines = content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)

        VStack(spacing: 0) {
            Text(filePath)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)

            ScrollView([.horizontal, .vertical]) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                        HStack(spacing: 0) {
                            Text("\(index + 1)")
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.secondary.opacity(0.5))
                                .frame(width: 44, alignment: .trailing)
                                .padding(.trailing, 12)

                            Group {
                                if let highlighted = highlightedLines?[safe: index] {
                                    Text(highlighted)
                                } else {
                                    Text(line.isEmpty ? " " : line)
                                        .foregroundStyle(.primary.opacity(0.8))
                                }
                            }
                            .font(.system(size: 12, design: .monospaced))
                            .textSelection(.enabled)
                            .fixedSize(horizontal: true, vertical: false)
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
