import SwiftUI

struct ContentView: View {
    @Environment(ConnectionManager.self) private var connectionManager

    var body: some View {
        Group {
            if connectionManager.isRestoring {
                ProgressView("Reconnecting...")
            } else if connectionManager.status == .disconnected {
                ConnectView()
            } else {
                ReviewsListView()
            }
        }
        .preferredColorScheme(.dark)
    }
}
