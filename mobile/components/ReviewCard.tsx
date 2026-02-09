import { View, Text, Pressable, StyleSheet } from "react-native";
import type { GlobalReviewSummary } from "../api/types";
import { colors } from "../lib/colors";
import { formatRelativeTime } from "../lib/utils";

interface ReviewCardProps {
  review: GlobalReviewSummary;
  onPress: () => void;
}

export function ReviewCard({ review, onPress }: ReviewCardProps) {
  const progress =
    review.totalHunks > 0 ? review.reviewedHunks / review.totalHunks : 0;

  const comparisonLabel = review.comparison.githubPr
    ? `PR #${review.comparison.githubPr.number}: ${review.comparison.githubPr.title}`
    : `${review.comparison.old}..${review.comparison.new}`;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View style={styles.header}>
        <Text style={styles.repoName} numberOfLines={1}>
          {review.repoName}
        </Text>
        {review.state && <StatusBadge state={review.state} />}
      </View>

      <Text style={styles.comparison} numberOfLines={1} selectable>
        {comparisonLabel}
      </Text>

      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View
            style={[styles.progressFill, { width: `${progress * 100}%` }]}
          />
        </View>
        <Text style={styles.progressText}>
          {review.reviewedHunks}/{review.totalHunks}
        </Text>
      </View>

      <View style={styles.stats}>
        <StatPill
          label="Trusted"
          count={review.trustedHunks}
          color={colors.trusted}
        />
        <StatPill
          label="Approved"
          count={review.approvedHunks}
          color={colors.approved}
        />
        <StatPill
          label="Rejected"
          count={review.rejectedHunks}
          color={colors.rejected}
        />
      </View>

      <Text style={styles.updatedAt}>
        {formatRelativeTime(review.updatedAt)}
      </Text>
    </Pressable>
  );
}

function StatusBadge({ state }: { state: "approved" | "changes_requested" }) {
  const isApproved = state === "approved";
  return (
    <View
      style={[
        styles.statusBadge,
        { backgroundColor: isApproved ? "#f0fdf4" : "#fff1f2" },
      ]}
    >
      <Text
        style={[
          styles.statusText,
          { color: isApproved ? colors.approved : colors.rejected },
        ]}
      >
        {isApproved ? "Approved" : "Changes Requested"}
      </Text>
    </View>
  );
}

function StatPill({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  if (count === 0) return null;
  return (
    <View style={[styles.statPill, { backgroundColor: color + "18" }]}>
      <Text style={[styles.statText, { color }]}>
        {count} {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
    boxShadow: "0px 1px 4px rgba(0, 0, 0, 0.08)",
  },
  cardPressed: {
    opacity: 0.7,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  repoName: {
    fontSize: 17,
    fontWeight: "600",
    flex: 1,
  },
  comparison: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
  },
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: "#f0f0f0",
    borderRadius: 3,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.approved,
    borderRadius: 3,
    borderCurve: "continuous",
  },
  progressText: {
    fontSize: 13,
    color: "#999",
    fontVariant: ["tabular-nums"],
  },
  stats: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 8,
  },
  statPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderCurve: "continuous",
  },
  statText: {
    fontSize: 12,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderCurve: "continuous",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  updatedAt: {
    fontSize: 12,
    color: "#aaa",
  },
});
