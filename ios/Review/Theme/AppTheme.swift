import SwiftUI

extension Color {
    // MARK: - Status Colors
    static let statusApproved = Color.green
    static let statusRejected = Color.red
    static let statusTrusted = Color.blue
    static let statusPending = Color.secondary

    // MARK: - Diff Colors
    static let diffAdded = Color.green
    static let diffRemoved = Color.red
    static let diffAddedBackground = Color.green.opacity(0.12)
    static let diffRemovedBackground = Color.red.opacity(0.12)

    // MARK: - File Status Colors
    static let fileAdded = Color.green
    static let fileModified = Color.yellow
    static let fileDeleted = Color.red
    static let fileRenamed = Color.blue
}

extension Font {
    static let mono = Font.system(.caption, design: .monospaced)
    static let monoSmall = Font.system(size: 10, design: .monospaced)
    static let monoBody = Font.system(size: 12, design: .monospaced)
}
