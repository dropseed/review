import SwiftUI

struct HunkCardView: View {
    let hunk: DiffHunk
    let hunkState: HunkState?
    let trusted: Bool
    let annotations: [LineAnnotation]
    let onApprove: () -> Void
    let onReject: () -> Void
    var onTapLineNumber: ((_ lineNumber: Int, _ side: LineAnnotation.AnnotationSide) -> Void)?
    var onEditAnnotation: ((_ annotation: LineAnnotation) -> Void)?

    @State private var highlightedLines: [AttributedString]?
    @State private var dragOffset: CGFloat = 0
    @State private var dragTriggered = false

    private let swipeThreshold: CGFloat = 80

    init(
        hunk: DiffHunk,
        hunkState: HunkState?,
        trusted: Bool = false,
        annotations: [LineAnnotation] = [],
        onApprove: @escaping () -> Void,
        onReject: @escaping () -> Void,
        onTapLineNumber: ((_ lineNumber: Int, _ side: LineAnnotation.AnnotationSide) -> Void)? = nil,
        onEditAnnotation: ((_ annotation: LineAnnotation) -> Void)? = nil
    ) {
        self.hunk = hunk
        self.hunkState = hunkState
        self.trusted = trusted
        self.annotations = annotations
        self.onApprove = onApprove
        self.onReject = onReject
        self.onTapLineNumber = onTapLineNumber
        self.onEditAnnotation = onEditAnnotation
    }

    private var status: HunkStatus? { hunkState?.status }
    private var labels: [String] { hunkState?.label ?? [] }

    private var borderColor: Color {
        if status == .approved { return .green }
        if status == .rejected { return .red }
        if trusted { return .blue }
        return .gray.opacity(0.5)
    }

    var body: some View {
        ZStack {
            // Swipe background
            HStack {
                // Approve indicator (right swipe)
                HStack {
                    Text("Approve")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.leading, 16)
                    Spacer()
                }
                .frame(maxHeight: .infinity)
                .background(.green)

                // Reject indicator (left swipe)
                HStack {
                    Spacer()
                    Text("Reject")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.trailing, 16)
                }
                .frame(maxHeight: .infinity)
                .background(.red)
            }

            // Card
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
                .background(Color(white: 0.15))

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

                // Action buttons
                HStack(spacing: 0) {
                    Button {
                        let generator = UIImpactFeedbackGenerator(style: .light)
                        generator.impactOccurred()
                        onApprove()
                    } label: {
                        Text("Approve")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(status == .approved ? .white : .green)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(status == .approved ? .green : .clear)
                    }
                    .buttonStyle(.plain)

                    Button {
                        let generator = UIImpactFeedbackGenerator(style: .light)
                        generator.impactOccurred()
                        onReject()
                    } label: {
                        Text("Reject")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(status == .rejected ? .white : .red)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(status == .rejected ? .red : .clear)
                    }
                    .buttonStyle(.plain)
                }
            }
            .background(Color(white: 0.11))
            .overlay(
                Rectangle()
                    .fill(borderColor)
                    .frame(width: 3),
                alignment: .leading
            )
            .clipShape(RoundedRectangle(cornerRadius: 0))
            .offset(x: dragOffset)
            .simultaneousGesture(
                DragGesture(minimumDistance: 20)
                    .onChanged { value in
                        // Only track horizontal drags — ignore vertical swipes
                        guard abs(value.translation.width) > abs(value.translation.height) else { return }
                        dragOffset = value.translation.width
                        if !dragTriggered && abs(dragOffset) > swipeThreshold {
                            dragTriggered = true
                        }
                    }
                    .onEnded { value in
                        if value.translation.width > swipeThreshold && abs(value.translation.width) > abs(value.translation.height) {
                            let generator = UINotificationFeedbackGenerator()
                            generator.notificationOccurred(.success)
                            onApprove()
                        } else if value.translation.width < -swipeThreshold && abs(value.translation.width) > abs(value.translation.height) {
                            let generator = UINotificationFeedbackGenerator()
                            generator.notificationOccurred(.warning)
                            onReject()
                        }
                        dragTriggered = false
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                            dragOffset = 0
                        }
                    }
            )
        }
        .padding(.vertical, 6)
        .task {
            let fileExtension = hunk.filePath.split(separator: ".").last.map(String.init)
            let code = hunk.lines.map(\.content).joined(separator: "\n")
            highlightedLines = await SyntaxHighlighter.highlightLines(code: code, fileExtension: fileExtension)
        }
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
