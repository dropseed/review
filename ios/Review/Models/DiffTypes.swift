import Foundation

struct DiffLine: Codable, Hashable, Sendable {
    let type: LineType
    let content: String
    let oldLineNumber: Int?
    let newLineNumber: Int?

    enum LineType: String, Codable, Sendable {
        case context
        case added
        case removed
    }
}

struct DiffHunk: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let filePath: String
    let oldStart: Int
    let oldCount: Int
    let newStart: Int
    let newCount: Int
    let content: String
    let lines: [DiffLine]
    let contentHash: String
    let movePairId: String?
}

struct DiffShortStat: Codable, Hashable, Sendable {
    let fileCount: Int
    let additions: Int
    let deletions: Int
}

enum ContentType: String, Codable, Sendable {
    case text
    case image
    case svg
    case binary
}

struct FileContent: Codable, Sendable {
    let content: String
    let oldContent: String?
    let diffPatch: String
    let hunks: [DiffHunk]
    let contentType: ContentType
}
