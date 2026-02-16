import SwiftUI

struct DiffLineView: View {
    let line: DiffLine
    var highlightedContent: AttributedString?
    var onTapLineNumber: (() -> Void)?

    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 0) {
                Text(line.type != .added ? formattedLineNumber(line.oldLineNumber) : "")
                    .frame(width: 28, alignment: .trailing)
                    .font(.monoSmall)
                    .foregroundStyle(Color.secondary.opacity(0.6))
                    .padding(.trailing, 3)

                Text(line.type != .removed ? formattedLineNumber(line.newLineNumber) : "")
                    .frame(width: 28, alignment: .trailing)
                    .font(.monoSmall)
                    .foregroundStyle(Color.secondary.opacity(0.6))
                    .padding(.trailing, 6)
            }
            .contentShape(Rectangle())
            .onTapGesture { onTapLineNumber?() }

            Group {
                if let highlightedContent {
                    Text(highlightedContent)
                } else {
                    Text(line.content)
                        .foregroundStyle(line.type.textColor)
                }
            }
            .font(.monoBody)
            .fixedSize(horizontal: true, vertical: false)
        }
        .padding(.vertical, 1)
        .frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)
        .background(line.type.backgroundColor)
    }

    private func formattedLineNumber(_ number: Int?) -> String {
        guard let number else { return "" }
        return String(number)
    }
}

#Preview {
    VStack(spacing: 0) {
        DiffLineView(line: DiffLine(type: .context, content: "let x = 1", oldLineNumber: 10, newLineNumber: 10))
        DiffLineView(line: DiffLine(type: .removed, content: "let y = 2", oldLineNumber: 11, newLineNumber: nil))
        DiffLineView(line: DiffLine(type: .added, content: "let y = 3", oldLineNumber: nil, newLineNumber: 11))
        DiffLineView(line: DiffLine(type: .context, content: "let z = 4", oldLineNumber: 12, newLineNumber: 12))
    }
    .padding()
    .background(Color(.systemBackground))
}
