import SwiftUI
import UserNotifications

@main
struct ReviewApp: App {
    @State private var connectionManager = ConnectionManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(connectionManager)
                .task {
                    let center = UNUserNotificationCenter.current()
                    try? await center.requestAuthorization(options: .badge)
                }
        }
    }
}
