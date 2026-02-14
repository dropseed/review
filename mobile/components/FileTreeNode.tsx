import { View, Text, Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, stone, borderSubtle } from "../lib/colors";
import { countFiles } from "../lib/tree-utils";
import type { FileEntry } from "../api/types";

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onFilePress: (file: FileEntry) => void;
  hunkCounts?: Map<string, { total: number; reviewed: number }>;
}

const statusColors: Record<string, string> = {
  added: colors.added,
  modified: colors.modified,
  deleted: colors.deleted,
  renamed: colors.renamed,
  untracked: colors.added,
};

const statusLabels: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

export function FileTreeNode({
  entry,
  depth,
  expandedPaths,
  onToggleExpand,
  onFilePress,
  hunkCounts,
}: FileTreeNodeProps) {
  if (entry.isDirectory) {
    const isExpanded = expandedPaths.has(entry.path);
    const fileCount = entry.children ? countFiles(entry.children) : 0;

    return (
      <View>
        <Pressable
          style={({ pressed }) => [
            styles.row,
            pressed && styles.rowPressed,
            { paddingLeft: 16 + depth * 16 },
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onToggleExpand(entry.path);
          }}
        >
          <Text style={[styles.chevron, isExpanded && styles.chevronExpanded]}>
            &rsaquo;
          </Text>
          <Text style={styles.dirName} numberOfLines={1}>
            {entry.name}/
          </Text>
          <Text style={styles.dirCount}>{fileCount}</Text>
        </Pressable>
        {isExpanded &&
          entry.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onFilePress={onFilePress}
              hunkCounts={hunkCounts}
            />
          ))}
      </View>
    );
  }

  // File node
  const statusColor = entry.status
    ? statusColors[entry.status] ?? stone[500]
    : stone[500];
  const statusLabel = entry.status
    ? statusLabels[entry.status] ?? ""
    : "";
  const counts = hunkCounts?.get(entry.path);
  const allReviewed =
    counts && counts.total > 0 && counts.reviewed >= counts.total;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        { paddingLeft: 16 + depth * 16 },
      ]}
      onPress={() => onFilePress(entry)}
    >
      {statusLabel ? (
        <Text style={[styles.statusLetter, { color: statusColor }]}>
          {statusLabel}
        </Text>
      ) : (
        <View style={styles.statusSpacer} />
      )}
      <Text
        style={[styles.fileName, allReviewed && styles.fileNameReviewed]}
        numberOfLines={1}
      >
        {entry.name}
      </Text>
      {counts && counts.total > 0 && (
        <Text
          style={[styles.hunkCount, allReviewed && styles.hunkCountReviewed]}
        >
          {counts.reviewed}/{counts.total}
        </Text>
      )}
      <Text style={styles.fileChevron}>&rsaquo;</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: borderSubtle,
  },
  rowPressed: {
    backgroundColor: stone[800],
  },
  chevron: {
    fontSize: 18,
    color: stone[500],
    width: 16,
    textAlign: "center",
    marginRight: 4,
  },
  chevronExpanded: {
    transform: [{ rotate: "90deg" }],
  },
  dirName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: stone[300],
  },
  dirCount: {
    fontSize: 12,
    color: stone[600],
    fontVariant: ["tabular-nums"],
    marginLeft: 8,
  },
  statusLetter: {
    width: 16,
    fontSize: 13,
    fontWeight: "700",
    marginRight: 6,
    textAlign: "center",
  },
  statusSpacer: {
    width: 16,
    marginRight: 6,
  },
  fileName: {
    flex: 1,
    fontSize: 14,
    color: stone[50],
  },
  fileNameReviewed: {
    color: stone[500],
  },
  hunkCount: {
    fontSize: 12,
    color: stone[500],
    fontVariant: ["tabular-nums"],
    marginLeft: 8,
  },
  hunkCountReviewed: {
    color: colors.approved,
  },
  fileChevron: {
    fontSize: 18,
    color: stone[600],
    marginLeft: 8,
  },
});
