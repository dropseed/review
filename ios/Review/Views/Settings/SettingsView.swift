import SwiftUI

struct SettingsView: View {
    @Environment(ConnectionManager.self) private var connectionManager
    @Environment(\.dismiss) private var dismiss
    @State private var showDisconnectConfirmation = false

    var body: some View {
        NavigationStack {
            List {
                Section("Connection") {
                    HStack {
                        Text("Status")
                        Spacer()
                        HStack(spacing: 6) {
                            Circle()
                                .fill(connectionManager.isConnected ? .green : .red)
                                .frame(width: 8, height: 8)
                            Text(connectionManager.isConnected ? "Connected" : "Disconnected")
                                .foregroundStyle(.secondary)
                        }
                    }

                    if !connectionManager.serverURL.isEmpty {
                        HStack {
                            Text("Server")
                            Spacer()
                            Text(connectionManager.serverURL)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .textSelection(.enabled)
                        }
                    }

                    if let info = connectionManager.serverInfo {
                        HStack {
                            Text("Hostname")
                            Spacer()
                            Text(info.hostname)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }

                        HStack {
                            Text("Version")
                            Spacer()
                            Text(info.version)
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }

                        HStack {
                            Text("Repositories")
                            Spacer()
                            Text("\(info.repos.count)")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section {
                    Button("Disconnect", role: .destructive) {
                        showDisconnectConfirmation = true
                    }
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                }

                Section {
                    Text("Review Mobile\(connectionManager.serverInfo.map { " \u{00B7} Server v\($0.version)" } ?? "")")
                        .font(.footnote)
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .listRowBackground(Color.clear)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .confirmationDialog(
                "Disconnect",
                isPresented: $showDisconnectConfirmation,
                titleVisibility: .visible
            ) {
                Button("Disconnect", role: .destructive) {
                    connectionManager.disconnect()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Are you sure you want to disconnect from the server?")
            }
        }
    }
}

#Preview {
    SettingsView()
        .environment(ConnectionManager())
}
