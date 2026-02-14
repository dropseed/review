import SwiftUI

struct ConnectionStatusBanner: View {
    @Environment(ConnectionManager.self) private var connectionManager

    var body: some View {
        Group {
            switch connectionManager.status {
            case .connectionLost:
                banner(
                    icon: "wifi.slash",
                    title: "Connection lost",
                    subtitle: "Trying to reconnect...",
                    showSpinner: true,
                    color: .orange
                )
            case .reconnected:
                banner(
                    icon: "checkmark.circle.fill",
                    title: "Connection restored",
                    subtitle: nil,
                    showSpinner: false,
                    color: .green
                )
            default:
                EmptyView()
            }
        }
        .animation(.easeInOut(duration: 0.3), value: connectionManager.status)
    }

    private func banner(icon: String, title: String, subtitle: String?, showSpinner: Bool, color: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.body.weight(.semibold))

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .opacity(0.9)
                }
            }

            Spacer()

            if showSpinner {
                ProgressView()
                    .tint(.white)
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(color.gradient)
        .foregroundStyle(.white)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}
