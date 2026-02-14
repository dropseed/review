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

    // MARK: - Background Colors (adaptive light/dark)
    static let cardBackground = Color(.secondarySystemBackground)
    static let cardHeaderBackground = Color(.tertiarySystemBackground)
    static let expandButtonBackground = Color(.tertiarySystemFill)
    static let progressTrackBackground = Color(.quaternarySystemFill)
}

extension Font {
    static let mono = Font.system(.caption, design: .monospaced)
    static let monoSmall = Font.system(size: 10, design: .monospaced)
    static let monoBody = Font.system(size: 12, design: .monospaced)
}

// MARK: - File Status Display

extension FileEntry.FileStatus {
    var label: String {
        switch self {
        case .added: "A"
        case .modified: "M"
        case .deleted: "D"
        case .renamed: "R"
        case .untracked: "U"
        case .gitignored: "I"
        }
    }

    var color: Color {
        switch self {
        case .added, .untracked: .fileAdded
        case .modified: .fileModified
        case .deleted: .fileDeleted
        case .renamed: .fileRenamed
        case .gitignored: .secondary
        }
    }
}
