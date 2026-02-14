import Foundation

func compactTree(_ entries: [FileEntry]) -> [FileEntry] {
    return entries.map { entry in
        if !entry.isDirectory || entry.children == nil {
            return entry
        }

        var compacted = FileEntry(
            name: entry.name,
            path: entry.path,
            isDirectory: entry.isDirectory,
            children: compactTree(entry.children!),
            status: entry.status
        )

        while let children = compacted.children,
              children.count == 1,
              children[0].isDirectory,
              children[0].status == nil {
            let onlyChild = children[0]
            compacted = FileEntry(
                name: "\(compacted.name)/\(onlyChild.name)",
                path: onlyChild.path,
                isDirectory: compacted.isDirectory,
                children: onlyChild.children,
                status: compacted.status
            )
        }

        return compacted
    }
}

func countFiles(_ entries: [FileEntry]) -> Int {
    var count = 0
    for entry in entries {
        if entry.isDirectory, let children = entry.children {
            count += countFiles(children)
        } else if !entry.isDirectory {
            count += 1
        }
    }
    return count
}

func getTopLevelDirPaths(_ entries: [FileEntry]) -> [String] {
    return entries.filter { $0.isDirectory }.map { $0.path }
}
