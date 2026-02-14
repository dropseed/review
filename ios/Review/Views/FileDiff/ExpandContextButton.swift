import SwiftUI

struct ExpandContextButton: View {
    let remainingLines: Int
    let chunkSize: Int
    let position: GapPosition
    let onTap: () -> Void

    private var iconName: String {
        switch position {
        case .before: "chevron.up"
        case .after: "chevron.down"
        case .between: "ellipsis"
        }
    }

    private var label: String {
        if remainingLines <= chunkSize {
            "Show \(remainingLines) lines"
        } else {
            "Show \(chunkSize) more lines"
        }
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 0) {
                dashedLine
                pill
                dashedLine
            }
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
        .frame(minHeight: 44)
    }

    private var pill: some View {
        HStack(spacing: 5) {
            Image(systemName: iconName)
                .font(.system(size: 9, weight: .semibold))
            Text(label)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
        }
        .foregroundStyle(Color.secondary.opacity(0.8))
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(
            Capsule()
                .fill(Color(white: 0.14))
        )
        .overlay(
            Capsule()
                .strokeBorder(Color.secondary.opacity(0.2), lineWidth: 0.5)
        )
    }

    private var dashedLine: some View {
        Rectangle()
            .fill(Color.secondary.opacity(0.15))
            .frame(height: 1)
    }
}
