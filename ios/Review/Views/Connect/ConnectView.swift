import SwiftUI

struct ConnectView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var url: String = ""
    @State private var token: String = ""
    @State private var showSuccess = false
    @State private var didLoadURL = false

    private var canSubmit: Bool {
        !url.trimmingCharacters(in: .whitespaces).isEmpty
            && !token.trimmingCharacters(in: .whitespaces).isEmpty
            && !connectionManager.isLoading
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Brand section
            VStack(spacing: 6) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 48))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 12)

                Text("Review")
                    .font(.largeTitle.bold())

                Text("Connect to your desktop companion")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.bottom, 48)

            // Form
            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Server URL")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)

                    TextField("http://macbook.local:3333", text: $url)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("Auth Token")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)

                    SecureField("Paste token from desktop app", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                }

                if let error = connectionManager.error {
                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }

                if showSuccess, let info = connectionManager.serverInfo {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(.green)
                            .frame(width: 8, height: 8)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Connected to \(info.hostname)")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.green)

                            Text("v\(info.version) \u{00B7} \(info.repos.count) repo\(info.repos.count == 1 ? "" : "s")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()
                    }
                    .padding(12)
                    .background(.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                }

                Button {
                    handleConnect()
                } label: {
                    if connectionManager.isLoading {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Text("Connect")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!canSubmit)
                .padding(.top, 8)
            }
            .padding(.horizontal, 4)

            Spacer()
        }
        .padding(.horizontal, 28)
        .onAppear {
            if !didLoadURL, !connectionManager.serverURL.isEmpty {
                url = connectionManager.serverURL
                didLoadURL = true
            }
        }
    }

    private func handleConnect() {
        showSuccess = false
        Task {
            do {
                try await connectionManager.connect(
                    url: url.trimmingCharacters(in: .whitespaces),
                    token: token.trimmingCharacters(in: .whitespaces)
                )
                showSuccess = true
            } catch {
                // Error is set in the connection manager
            }
        }
    }
}

#Preview {
    ConnectView()
        .environment(ConnectionManager())
}
