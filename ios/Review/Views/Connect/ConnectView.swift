import SwiftUI
import VisionKit

struct ConnectView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @State private var url: String = ""
    @State private var token: String = ""
    @State private var fingerprint: String = ""
    @State private var showSuccess = false
    @State private var didLoadURL = false
    @State private var showScanner = false
    @State private var showManualEntry = false

    private var canSubmit: Bool {
        !url.trimmingCharacters(in: .whitespaces).isEmpty
            && !token.trimmingCharacters(in: .whitespaces).isEmpty
            && !fingerprint.trimmingCharacters(in: .whitespaces).isEmpty
            && !connectionManager.isLoading
    }

    var body: some View {
        VStack(spacing: 0) {
            // Brand section — upper portion
            Spacer()

            VStack(spacing: 6) {
                Image("AppIconSymbol")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 80, height: 80)
                    .padding(.bottom, 12)

                Text("Review")
                    .font(.largeTitle.bold())

                Text("Pair with the desktop app to start reviewing")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            // Actions — bottom portion
            ScrollView {
                VStack(spacing: 16) {
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

                    // Scan QR Code (primary action)
                    if DataScannerViewController.isSupported {
                        Button {
                            showScanner = true
                        } label: {
                            Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .sheet(isPresented: $showScanner) {
                            QRScannerView { pairing in
                                url = pairing.url
                                token = pairing.token
                                fingerprint = pairing.fingerprint
                                handleConnect()
                            }
                        }
                    }

                    Button {
                        showManualEntry = true
                    } label: {
                        Text("Enter Details Manually")
                            .font(.subheadline)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .sheet(isPresented: $showManualEntry) {
                        ManualEntrySheet(
                            url: $url,
                            token: $token,
                            fingerprint: $fingerprint,
                            canSubmit: canSubmit,
                            isLoading: connectionManager.isLoading,
                            onConnect: handleConnect
                        )
                    }
                }
                .padding(.horizontal, 4)
            }
            .scrollBounceBehavior(.basedOnSize)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.bottom, 32)
        }
        .padding(.horizontal, 28)
        .onAppear {
            if !didLoadURL {
                if !connectionManager.serverURL.isEmpty {
                    url = connectionManager.serverURL
                }
                if let savedToken = KeychainHelper.read(key: ConnectionManager.tokenKey) {
                    token = savedToken
                }
                if let savedFingerprint = KeychainHelper.read(key: ConnectionManager.fingerprintKey) {
                    fingerprint = savedFingerprint
                }
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
                    token: token.trimmingCharacters(in: .whitespaces),
                    fingerprint: fingerprint.trimmingCharacters(in: .whitespaces)
                )
                showSuccess = true
            } catch {
                // Error is set in the connection manager
            }
        }
    }
}

private struct ManualEntrySheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var url: String
    @Binding var token: String
    @Binding var fingerprint: String
    let canSubmit: Bool
    let isLoading: Bool
    let onConnect: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://macbook.local:3333", text: $url)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Server URL")
                }

                Section {
                    SecureField("Paste token from desktop app", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Auth Token")
                }

                Section {
                    TextField("AB:CD:EF:...", text: $fingerprint)
                        .font(.system(.body, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Certificate Fingerprint")
                }

                Section {
                    Button {
                        onConnect()
                    } label: {
                        if isLoading {
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
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            }
            .navigationTitle("Manual Connection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    ConnectView()
        .environment(ConnectionManager())
}
