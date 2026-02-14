import { Text, Pressable, StyleSheet } from "react-native";
import { colors, stone, borderSubtle } from "../lib/colors";

interface FileListItemProps {
  name: string;
  path: string;
  status?: string;
  hunkCount: number;
  reviewedCount: number;
  onPress: () => void;
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

export function FileListItem({
  name,
  path,
  status,
  hunkCount,
  reviewedCount,
  onPress,
}: FileListItemProps) {
  const statusColor = status ? statusColors[status] ?? stone[500] : stone[500];
  const statusLabel = status ? statusLabels[status] ?? "?" : "?";
  const allReviewed = hunkCount > 0 && reviewedCount >= hunkCount;

  // Split path into directory and filename
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash > 0 ? path.substring(0, lastSlash + 1) : "";
  const fileName = lastSlash >= 0 ? path.substring(lastSlash + 1) : name;

  return (
    <Pressable
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
      onPress={onPress}
    >
      <Text style={[styles.statusLetter, { color: statusColor }]}>
        {statusLabel}
      </Text>
      <Text
        style={[styles.path, allReviewed && styles.pathReviewed]}
        numberOfLines={1}
      >
        {dir ? <Text style={styles.dir}>{dir}</Text> : null}
        {fileName}
      </Text>
      {hunkCount > 0 && (
        <Text
          style={[
            styles.count,
            allReviewed && styles.countReviewed,
          ]}
        >
          {reviewedCount}/{hunkCount}
        </Text>
      )}
      <Text style={styles.chevron}>&rsaquo;</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: stone[900],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: borderSubtle,
  },
  itemPressed: {
    backgroundColor: stone[800],
  },
  statusLetter: {
    width: 16,
    fontSize: 13,
    fontWeight: "700",
    marginRight: 8,
  },
  path: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: stone[50],
  },
  pathReviewed: {
    color: stone[500],
  },
  dir: {
    color: stone[500],
    fontWeight: "400",
  },
  count: {
    fontSize: 13,
    color: stone[500],
    fontVariant: ["tabular-nums"],
    marginLeft: 8,
  },
  countReviewed: {
    color: colors.approved,
  },
  chevron: {
    fontSize: 22,
    color: stone[600],
    marginLeft: 8,
  },
});
