import { useState } from "react";
import { View, Text, Image, Pressable, StyleSheet } from "react-native";
import type { DiffShortStat, GlobalReviewSummary } from "../api/types";
import { colors, stone, borderSubtle } from "../lib/colors";
import { formatRelativeTime } from "../lib/utils";

interface ReviewRowProps {
  review: GlobalReviewSummary;
  diffStats: DiffShortStat | null;
  avatarUrl: string | null;
  onPress: () => void;
}

function getInitials(repoName: string): string {
  return repoName.slice(0, 2).toUpperCase();
}

export function ReviewRow({ review, diffStats, avatarUrl, onPress }: ReviewRowProps) {
  const progress =
    review.totalHunks > 0 ? review.reviewedHunks / review.totalHunks : 0;
  const [avatarFailed, setAvatarFailed] = useState(false);

  const comparisonLabel = review.githubPr
    ? `PR #${review.githubPr.number}: ${review.githubPr.title}`
    : `${review.comparison.base}..${review.comparison.head}`;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      {avatarUrl && !avatarFailed ? (
        <Image
          source={{ uri: avatarUrl }}
          style={styles.avatar}
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarInitials}>
            {getInitials(review.repoName)}
          </Text>
        </View>
      )}

      <View style={styles.main}>
        <View style={styles.header}>
          <Text style={styles.repoName} numberOfLines={1}>
            {review.repoName}
          </Text>
          {review.state && <StatusBadge state={review.state} />}
        </View>

        <Text style={styles.comparison} numberOfLines={1}>
          {comparisonLabel}
        </Text>

        <View style={styles.meta}>
          {diffStats && (
            <>
              <Text style={styles.metaText}>
                {diffStats.fileCount} file
                {diffStats.fileCount !== 1 ? "s" : ""}
              </Text>
              <Text style={styles.diffAdded}>+{diffStats.additions}</Text>
              <Text style={styles.diffRemoved}>-{diffStats.deletions}</Text>
              <Text style={styles.metaDot}> · </Text>
            </>
          )}
          <Text style={styles.metaText}>
            {review.reviewedHunks}/{review.totalHunks} reviewed
          </Text>
          <Text style={styles.metaDot}> · </Text>
          <Text style={styles.metaText}>
            {formatRelativeTime(review.updatedAt)}
          </Text>
        </View>

        <View style={styles.progressBar}>
          <View
            style={[styles.progressFill, { width: `${progress * 100}%` }]}
          />
        </View>
      </View>

      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function StatusBadge({ state }: { state: "approved" | "changes_requested" }) {
  const isApproved = state === "approved";
  return (
    <View
      style={[
        styles.statusBadge,
        { backgroundColor: isApproved ? "rgba(16, 185, 129, 0.15)" : "rgba(244, 63, 94, 0.15)" },
      ]}
    >
      <Text
        style={[
          styles.statusText,
          { color: isApproved ? colors.approved : colors.rejected },
        ]}
      >
        {isApproved ? "Approved" : "Changes"}
      </Text>
    </View>
  );
}

const AVATAR_SIZE = 36;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: stone[900],
  },
  rowPressed: {
    backgroundColor: stone[800],
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    marginRight: 12,
    backgroundColor: stone[800],
  },
  avatarFallback: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    marginRight: 12,
    backgroundColor: stone[800],
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
    fontSize: 13,
    fontWeight: "600",
    color: stone[500],
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
  },
  repoName: {
    fontSize: 17,
    fontWeight: "600",
    flexShrink: 1,
    color: stone[50],
  },
  comparison: {
    fontSize: 14,
    color: stone[500],
    marginBottom: 6,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  metaText: {
    fontSize: 12,
    color: stone[500],
    fontVariant: ["tabular-nums"],
  },
  metaDot: {
    fontSize: 12,
    color: stone[700],
  },
  diffAdded: {
    fontSize: 12,
    fontWeight: "500",
    color: "#4ade80",
    fontVariant: ["tabular-nums"],
    marginLeft: 6,
  },
  diffRemoved: {
    fontSize: 12,
    fontWeight: "500",
    color: "#fb7185",
    fontVariant: ["tabular-nums"],
    marginLeft: 4,
  },
  progressBar: {
    height: 3,
    backgroundColor: stone[800],
    borderRadius: 1.5,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.approved,
    borderRadius: 1.5,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderCurve: "continuous",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "600",
  },
  chevron: {
    fontSize: 22,
    fontWeight: "300",
    color: stone[600],
    marginLeft: 10,
  },
});
