import Foundation

struct HunkState: Codable, Hashable, Sendable {
    var label: [String]
    var reasoning: String?
    var status: HunkStatus?
    var classifiedVia: String?

    init(label: [String] = [], reasoning: String? = nil, status: HunkStatus? = nil, classifiedVia: String? = nil) {
        self.label = label
        self.reasoning = reasoning
        self.status = status
        self.classifiedVia = classifiedVia
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        label = try container.decodeIfPresent([String].self, forKey: .label) ?? []
        reasoning = try container.decodeIfPresent(String.self, forKey: .reasoning)
        status = try container.decodeIfPresent(HunkStatus.self, forKey: .status)
        classifiedVia = try container.decodeIfPresent(String.self, forKey: .classifiedVia)
    }
}

enum HunkStatus: String, Codable, Sendable {
    case approved
    case rejected
}

struct LineAnnotation: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let filePath: String
    let lineNumber: Int
    let endLineNumber: Int?
    let side: AnnotationSide
    let content: String
    let createdAt: String

    enum AnnotationSide: String, Codable, Sendable {
        case old
        case new
        case file
    }
}

struct ReviewState: Codable, Sendable {
    let comparison: Comparison
    var hunks: [String: HunkState]
    var trustList: [String]
    var notes: String
    var annotations: [LineAnnotation]
    let createdAt: String
    var updatedAt: String
    var version: Int
    var totalDiffHunks: Int
    let githubPr: GitHubPrRef?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        comparison = try container.decode(Comparison.self, forKey: .comparison)
        hunks = try container.decodeIfPresent([String: HunkState].self, forKey: .hunks) ?? [:]
        trustList = try container.decodeIfPresent([String].self, forKey: .trustList) ?? []
        notes = try container.decodeIfPresent(String.self, forKey: .notes) ?? ""
        annotations = try container.decodeIfPresent([LineAnnotation].self, forKey: .annotations) ?? []
        createdAt = try container.decode(String.self, forKey: .createdAt)
        updatedAt = try container.decode(String.self, forKey: .updatedAt)
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? 0
        totalDiffHunks = try container.decodeIfPresent(Int.self, forKey: .totalDiffHunks) ?? 0
        githubPr = try container.decodeIfPresent(GitHubPrRef.self, forKey: .githubPr)
    }
}
