import SwiftUI

struct SplitDiffLineView: View {
    let row: SplitDiffRow
    var oldHighlight: AttributedString?
    var newHighlight: AttributedString?
    var onTapOldLineNumber: (() -> Void)?
    var onTapNewLineNumber: (() -> Void)?

    var body: some View {
        HStack(spacing: 0) {
            sideView(line: row.old, isOld: true, highlight: oldHighlight, onTap: onTapOldLineNumber)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(row.old?.type.backgroundColor ?? .clear)

            Rectangle()
                .fill(Color.secondary.opacity(0.3))
                .frame(width: 1)

            sideView(line: row.new, isOld: false, highlight: newHighlight, onTap: onTapNewLineNumber)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(row.new?.type.backgroundColor ?? .clear)
        }
        .frame(minHeight: 22)
    }

    @ViewBuilder
    private func sideView(line: DiffLine?, isOld: Bool, highlight: AttributedString?, onTap: (() -> Void)?) -> some View {
        if let line {
            HStack(spacing: 0) {
                let lineNum = isOld ? line.oldLineNumber : line.newLineNumber
                Text(lineNum.map(String.init) ?? "")
                    .frame(width: 28, alignment: .trailing)
                    .font(.monoSmall)
                    .foregroundStyle(Color.secondary.opacity(0.6))
                    .padding(.trailing, 6)
                    .contentShape(Rectangle())
                    .onTapGesture { onTap?() }

                Group {
                    if let highlight {
                        Text(highlight)
                    } else {
                        Text(line.content)
                            .foregroundStyle(line.type.textColor)
                    }
                }
                .font(.monoBody)
                .lineLimit(1)
            }
            .padding(.vertical, 1)
        } else {
            Color.clear
                .padding(.vertical, 1)
        }
    }
}

#Preview {
    let rows = pairLinesForSplitDiff([
        DiffLine(type: .context, content: "let x = 1", oldLineNumber: 10, newLineNumber: 10),
        DiffLine(type: .removed, content: "let y = 2", oldLineNumber: 11, newLineNumber: nil),
        DiffLine(type: .added, content: "let y = 3", oldLineNumber: nil, newLineNumber: 11),
        DiffLine(type: .context, content: "let z = 4", oldLineNumber: 12, newLineNumber: 12),
    ])

    VStack(spacing: 0) {
        ForEach(rows) { row in
            SplitDiffLineView(row: row)
        }
    }
    .padding()
    .background(Color(.systemBackground))
}
