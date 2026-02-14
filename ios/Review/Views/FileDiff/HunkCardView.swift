import SwiftUI

struct HunkCardView: View {
    let hunk: DiffHunk
    let hunkState: HunkState?
    let trusted: Bool
    let annotations: [LineAnnotation]
    let onApprove: () -> Void
    let onReject: () -> Void
    let onSaveForLater: () -> Void
    var onTapLineNumber: ((_ lineNumber: Int, _ side: LineAnnotation.AnnotationSide) -> Void)?
    var onEditAnnotation: ((_ annotation: LineAnnotation) -> Void)?

    @State private var highlightedLines: [AttributedString]?

    init(
        hunk: DiffHunk,
        hunkState: HunkState?,
        trusted: Bool = false,
        annotations: [LineAnnotation] = [],
        onApprove: @escaping () -> Void,
        onReject: @escaping () -> Void,
        onSaveForLater: @escaping () -> Void,
        onTapLineNumber: ((_ lineNumber: Int, _ side: LineAnnotation.AnnotationSide) -> Void)? = nil,
        onEditAnnotation: ((_ annotation: LineAnnotation) -> Void)? = nil
    ) {
        self.hunk = hunk
        self.hunkState = hunkState
        self.trusted = trusted
        self.annotations = annotations
        self.onApprove = onApprove
        self.onReject = onReject
        self.onSaveForLater = onSaveForLater
        self.onTapLineNumber = onTapLineNumber
        self.onEditAnnotation = onEditAnnotation
    }

    private var status: HunkStatus? { hunkState?.status }
    private var labels: [String] { hunkState?.label ?? [] }

    private var borderColor: Color {
        if status == .approved { return .statusApproved }
        if status == .rejected { return .statusRejected }
        if status == .savedForLater { return .statusSavedForLater }
        if trusted { return .statusTrusted }
        return .gray.opacity(0.5)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack(spacing: 8) {
                Text("@@ -\(hunk.oldStart),\(hunk.oldCount) +\(hunk.newStart),\(hunk.newCount) @@")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                if !labels.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(labels, id: \.self) { label in
                            Text(label)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(Color.purple.opacity(0.9))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.purple.opacity(0.15), in: RoundedRectangle(cornerRadius: 4))
                        }
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.cardHeaderBackground)

            Divider()

            // Diff lines with inline annotations
            VStack(spacing: 0) {
                ForEach(Array(hunk.lines.enumerated()), id: \.offset) { index, line in
                    DiffLineView(
                        line: line,
                        highlightedContent: highlightedLines?[safe: index]
                    ) {
                        let lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0
                        let side: LineAnnotation.AnnotationSide = line.type == .removed ? .old : .new
                        onTapLineNumber?(lineNum, side)
                    }

                    // Show annotations for this line
                    ForEach(annotationsForLine(line)) { annotation in
                        AnnotationBubbleView(annotation: annotation) {
                            onEditAnnotation?(annotation)
                        }
                    }
                }
            }

            Divider()

            // Action buttons or status banner
            if let status {
                statusBanner(status: status)
            } else {
                HStack(spacing: 8) {
                    actionButton(
                        icon: "checkmark.circle.fill",
                        label: "Approve",
                        color: .statusApproved,
                        action: onApprove
                    )
                    actionButton(
                        icon: "xmark.circle.fill",
                        label: "Reject",
                        color: .statusRejected,
                        action: onReject
                    )
                    actionButton(
                        icon: "clock.fill",
                        label: "Later",
                        color: .statusSavedForLater,
                        action: onSaveForLater
                    )
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
        }
        .background(Color.cardBackground)
        .overlay(
            Rectangle()
                .fill(borderColor)
                .frame(width: 3),
            alignment: .leading
        )
        .padding(.vertical, 6)
        .task {
            let fileExtension = hunk.filePath.split(separator: ".").last.map(String.init)
            let code = hunk.lines.map(\.content).joined(separator: "\n")
            highlightedLines = await SyntaxHighlighter.highlightLines(code: code, fileExtension: fileExtension)
        }
    }

    private func statusBanner(status: HunkStatus) -> some View {
        let config: (icon: String, label: String, color: Color) = switch status {
        case .approved: ("checkmark.circle.fill", "Approved", .statusApproved)
        case .rejected: ("xmark.circle.fill", "Rejected", .statusRejected)
        case .savedForLater: ("clock.fill", "Saved for Later", .statusSavedForLater)
        }

        return HStack {
            Image(systemName: config.icon)
                .font(.system(size: 14, weight: .semibold))
            Text(config.label)
                .font(.system(size: 13, weight: .semibold))

            Spacer()

            Button {
                let generator = UIImpactFeedbackGenerator(style: .light)
                generator.impactOccurred()
                // Tapping the active status again clears it
                switch status {
                case .approved: onApprove()
                case .rejected: onReject()
                case .savedForLater: onSaveForLater()
                }
            } label: {
                Text("Change")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.8))
            }
            .buttonStyle(.plain)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(config.color)
    }

    private func actionButton(icon: String, label: String, color: Color, action: @escaping () -> Void) -> some View {
        Button {
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.impactOccurred()
            action()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .semibold))
                Text(label)
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                Capsule()
                    .fill(color)
            )
        }
        .buttonStyle(.plain)
    }

    private func annotationsForLine(_ line: DiffLine) -> [LineAnnotation] {
        annotations.filter { annotation in
            let lineNum = line.type == .removed ? line.oldLineNumber : line.newLineNumber
            let expectedSide: LineAnnotation.AnnotationSide = line.type == .removed ? .old : .new
            return annotation.lineNumber == lineNum && annotation.side == expectedSide
        }
    }
}

extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
