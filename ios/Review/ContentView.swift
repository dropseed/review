import SwiftUI

struct ContentView: View {
    @Environment(ConnectionManager.self) private var connectionManager

    var body: some View {
        Group {
            if connectionManager.isConnected {
                TabView {
                    Tab("Reviews", systemImage: "list.bullet") {
                        ReviewsListView()
                    }
                    Tab("Settings", systemImage: "gear") {
                        SettingsView()
                    }
                }
            } else {
                ConnectView()
            }
        }
        .preferredColorScheme(.dark)
    }
}
