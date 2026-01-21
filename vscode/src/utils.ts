import type * as vscode from "vscode";

/**
 * Extract relative path from a VS Code URI (handles file:// and git:// schemes)
 */
export function getRelativePath(
	uri: vscode.Uri,
	workspaceRoot: string,
): string | null {
	if (uri.scheme === "file") {
		const fsPath = uri.fsPath;
		if (fsPath.startsWith(workspaceRoot)) {
			return fsPath.slice(workspaceRoot.length + 1);
		}
	}

	if (uri.scheme === "git") {
		try {
			const query = JSON.parse(uri.query);
			if (query.path?.startsWith(workspaceRoot)) {
				return query.path.slice(workspaceRoot.length + 1);
			}
		} catch {
			// Fallback: try using uri.path directly
			const fsPath = uri.path;
			if (fsPath.startsWith(workspaceRoot)) {
				return fsPath.slice(workspaceRoot.length + 1);
			}
		}
	}

	return null;
}
