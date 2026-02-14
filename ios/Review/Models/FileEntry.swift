import Foundation

struct FileEntry: Codable, Identifiable, Hashable, Sendable {
    var id: String { path }

    let name: String
    let path: String
    let isDirectory: Bool
    var children: [FileEntry]?
    let status: FileStatus?

    enum FileStatus: String, Codable, Sendable {
        case added
        case modified
        case deleted
        case renamed
        case untracked
        case gitignored
    }
}
