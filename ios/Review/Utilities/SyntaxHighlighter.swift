import Foundation
import HighlightSwift

struct SyntaxHighlighter: Sendable {
    static let shared = Highlight()

    static func languageName(for fileExtension: String?) -> String? {
        guard let ext = fileExtension?.lowercased() else { return nil }
        let map: [String: String] = [
            "swift": "swift", "js": "javascript", "jsx": "javascript",
            "ts": "typescript", "tsx": "typescript", "py": "python",
            "rs": "rust", "go": "go", "json": "json", "html": "html",
            "css": "css", "scss": "scss", "less": "less",
            "rb": "ruby", "java": "java", "kt": "kotlin",
            "c": "c", "cpp": "cpp", "h": "c", "hpp": "cpp",
            "m": "objectivec", "mm": "objectivec",
            "sh": "bash", "bash": "bash", "zsh": "bash",
            "yaml": "yaml", "yml": "yaml", "toml": "ini",
            "xml": "xml", "sql": "sql", "md": "markdown",
            "r": "r", "lua": "lua", "php": "php",
            "cs": "csharp", "fs": "fsharp",
        ]
        return map[ext]
    }

    static func highlightLines(code: String, fileExtension: String?) async -> [AttributedString] {
        let colors = HighlightColors.dark(.atomOne)
        do {
            let highlighted: AttributedString
            if let language = languageName(for: fileExtension) {
                highlighted = try await shared.attributedText(code, language: language, colors: colors)
            } else {
                highlighted = try await shared.attributedText(code, colors: colors)
            }
            return splitAttributedStringByNewlines(highlighted)
        } catch {
            return code.split(separator: "\n", omittingEmptySubsequences: false)
                .map { AttributedString(String($0)) }
        }
    }

    private static func splitAttributedStringByNewlines(_ str: AttributedString) -> [AttributedString] {
        var lines: [AttributedString] = []
        var currentLine = AttributedString()

        for run in str.runs {
            let runText = String(str[run.range].characters)
            let parts = runText.split(separator: "\n", omittingEmptySubsequences: false)

            for (i, part) in parts.enumerated() {
                var segment = AttributedString(String(part))
                segment.mergeAttributes(run.attributes)
                currentLine.append(segment)

                if i < parts.count - 1 {
                    lines.append(currentLine)
                    currentLine = AttributedString()
                }
            }
        }
        lines.append(currentLine)

        return lines
    }
}
