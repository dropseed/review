import SwiftUI

struct AnnotationBubbleView: View {
    let annotation: LineAnnotation
    var onEdit: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "text.bubble")
                .font(.caption)
                .foregroundStyle(.yellow.opacity(0.8))

            Text(annotation.content)
                .font(.system(size: 12))
                .foregroundStyle(.primary.opacity(0.9))
                .frame(maxWidth: .infinity, alignment: .leading)

            if onEdit != nil {
                Button {
                    onEdit?()
                } label: {
                    Image(systemName: "pencil")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.yellow.opacity(0.08))
        .overlay(
            Rectangle()
                .fill(Color.yellow.opacity(0.4))
                .frame(width: 2),
            alignment: .leading
        )
    }
}

#Preview {
    VStack(spacing: 0) {
        AnnotationBubbleView(
            annotation: LineAnnotation(
                id: "test:1:new:123",
                filePath: "test.swift",
                lineNumber: 1,
                endLineNumber: nil,
                side: .new,
                content: "This should use a guard statement instead.",
                createdAt: "2026-01-01T00:00:00Z"
            ),
            onEdit: {}
        )
    }
    .background(.black)
}
