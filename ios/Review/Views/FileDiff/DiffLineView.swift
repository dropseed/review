import SwiftUI

struct DiffLineView: View {
    let line: DiffLine
    var highlightedContent: AttributedString?
    var onTapLineNumber: (() -> Void)?

    var body: some View {
        HStack(spacing: 0) {
            // Old line number
            Text(line.type != .added ? formattedLineNumber(line.oldLineNumber) : "")
                .frame(width: 28, alignment: .trailing)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(Color.secondary.opacity(0.6))
                .padding(.trailing, 3)
                .contentShape(Rectangle())
                .onTapGesture { onTapLineNumber?() }

            // New line number
            Text(line.type != .removed ? formattedLineNumber(line.newLineNumber) : "")
                .frame(width: 28, alignment: .trailing)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(Color.secondary.opacity(0.6))
                .padding(.trailing, 3)
                .contentShape(Rectangle())
                .onTapGesture { onTapLineNumber?() }

            // Prefix
            Text(prefix)
                .frame(width: 14)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(textColor)
                .multilineTextAlignment(.center)

            // Content
            Group {
                if let highlightedContent {
                    Text(highlightedContent)
                } else {
                    Text(line.content)
                        .foregroundStyle(textColor)
                }
            }
            .font(.system(size: 12, design: .monospaced))
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 1)
        .frame(minHeight: 20)
        .background(backgroundColor)
    }

    private var prefix: String {
        switch line.type {
        case .added: "+"
        case .removed: "-"
        case .context: " "
        }
    }

    private var textColor: Color {
        switch line.type {
        case .added: .green
        case .removed: .red
        case .context: .secondary
        }
    }

    private var backgroundColor: Color {
        switch line.type {
        case .added: .green.opacity(0.12)
        case .removed: .red.opacity(0.12)
        case .context: .clear
        }
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
    .background(.black)
}
