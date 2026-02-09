import { View, Text, Pressable, StyleSheet } from "react-native";
import { colors } from "../lib/colors";

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
  const statusColor = status ? statusColors[status] ?? "#999" : "#999";
  const statusLabel = status ? statusLabels[status] ?? "?" : "?";
  const allReviewed = hunkCount > 0 && reviewedCount >= hunkCount;

  return (
    <Pressable
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
      onPress={onPress}
    >
      <View style={[styles.statusBadge, { backgroundColor: statusColor + "20" }]}>
        <Text style={[styles.statusText, { color: statusColor }]}>
          {statusLabel}
        </Text>
      </View>
      <View style={styles.info}>
        <Text
          style={[styles.name, allReviewed && styles.nameReviewed]}
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text style={styles.path} numberOfLines={1}>
          {path}
        </Text>
        <Text style={styles.hunkCount}>
          {reviewedCount}/{hunkCount} hunks
        </Text>
      </View>
      <Text style={styles.chevron}>&rsaquo;</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
  },
  itemPressed: {
    backgroundColor: "#f2f2f7",
  },
  statusBadge: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  statusText: {
    fontSize: 13,
    fontWeight: "700",
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: "500",
    marginBottom: 1,
  },
  nameReviewed: {
    color: "#999",
  },
  path: {
    fontSize: 12,
    color: "#8e8e93",
    marginBottom: 2,
  },
  hunkCount: {
    fontSize: 13,
    color: "#999",
    fontVariant: ["tabular-nums"],
  },
  chevron: {
    fontSize: 22,
    color: "#c7c7cc",
    marginLeft: 8,
  },
});
