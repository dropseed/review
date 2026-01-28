import { View, Text, Pressable, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import type { DiffHunk, HunkState } from "@/types";
import { isHunkTrusted, isHunkReviewed } from "@/types";
import { CodeBlock } from "./code-block";
import { Icon } from "./icon";
import { colors, spacing, radius, typography, shadows } from "@/theme";
import * as haptics from "@/utils/haptics";

interface SwipeableHunkProps {
  hunk: DiffHunk;
  hunkState?: HunkState;
  trustList: string[];
  onApprove: () => void;
  onReject: () => void;
}

export function SwipeableHunk({
  hunk,
  hunkState,
  trustList,
  onApprove,
  onReject,
}: SwipeableHunkProps) {
  const fileName = hunk.filePath.split("/").pop() || hunk.filePath;
  const directory = hunk.filePath.slice(0, -fileName.length - 1);

  const isReviewed = isHunkReviewed(hunkState, trustList);
  const isTrusted = isHunkTrusted(hunkState, trustList);
  const isApproved = hunkState?.status === "approved";
  const isRejected = hunkState?.status === "rejected";

  const labels = hunkState?.label || [];

  // Status-based header styling
  const getHeaderOverlay = () => {
    if (isApproved) return "rgba(132, 204, 22, 0.15)";
    if (isRejected) return "rgba(244, 63, 94, 0.15)";
    if (isTrusted) return "rgba(6, 182, 212, 0.15)";
    return "transparent";
  };

  return (
    <View style={styles.container}>
      {/* Card */}
      <View style={styles.card}>
        <BlurView intensity={60} tint="dark" style={styles.blur}>
          <View style={styles.cardOverlay}>
            {/* Header */}
            <View style={[styles.header, { backgroundColor: getHeaderOverlay() }]}>
              <View style={styles.headerContent}>
                <Text style={styles.fileName}>{fileName}</Text>
                {directory && (
                  <Text style={styles.directory}>{directory}</Text>
                )}
                <Text style={styles.lineNumbers}>
                  Lines {hunk.newStart}–{hunk.newStart + hunk.newCount}
                </Text>
              </View>

              {isApproved && (
                <Icon name="checkmark.circle.fill" color={colors.success} size={24} />
              )}
              {isRejected && (
                <Icon name="xmark.circle.fill" color={colors.error} size={24} />
              )}
              {isTrusted && !isApproved && !isRejected && (
                <Icon name="checkmark.shield.fill" color={colors.info} size={24} />
              )}
            </View>

            {/* Labels */}
            {labels.length > 0 && (
              <View style={styles.labels}>
                {labels.map((label) => (
                  <View
                    key={label}
                    style={[
                      styles.label,
                      isTrusted && styles.labelTrusted,
                    ]}
                  >
                    <Text
                      style={[
                        styles.labelText,
                        isTrusted && styles.labelTextTrusted,
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Code */}
            <View style={styles.codeContainer}>
              <CodeBlock lines={hunk.lines} maxHeight={400} />
            </View>

            {/* Action buttons */}
            {!isReviewed && (
              <View style={styles.actions}>
                <Pressable
                  onPress={() => {
                    haptics.error();
                    onReject();
                  }}
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.rejectButton,
                    pressed && styles.actionButtonPressed,
                  ]}
                >
                  <Icon name="xmark" color={colors.text.primary} size={18} />
                  <Text style={[styles.actionText, { color: colors.error }]}>
                    Reject
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    haptics.success();
                    onApprove();
                  }}
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.approveButton,
                    pressed && styles.actionButtonPressed,
                  ]}
                >
                  <Icon name="checkmark" color={colors.stone[950]} size={18} />
                  <Text style={[styles.actionText, { color: colors.stone[950] }]}>
                    Approve
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  card: {
    flex: 1,
    borderRadius: radius.xl,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    ...shadows.lg,
  },
  blur: {
    flex: 1,
  },
  cardOverlay: {
    flex: 1,
    backgroundColor: "rgba(28, 25, 23, 0.7)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  headerContent: {
    flex: 1,
  },
  fileName: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  directory: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: 2,
  },
  lineNumbers: {
    fontSize: typography.fontSize.sm,
    color: colors.text.faint,
    marginTop: spacing.xs,
  },
  labels: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  label: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  labelTrusted: {
    backgroundColor: "rgba(6, 182, 212, 0.15)",
    borderColor: "rgba(6, 182, 212, 0.3)",
  },
  labelText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.muted,
  },
  labelTextTrusted: {
    color: colors.info,
  },
  codeContainer: {
    flex: 1,
  },
  actions: {
    flexDirection: "row",
    borderTopWidth: 0.5,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  actionButtonPressed: {
    opacity: 0.7,
  },
  rejectButton: {
    backgroundColor: "rgba(244, 63, 94, 0.15)",
  },
  approveButton: {
    backgroundColor: colors.accent.lime,
  },
  actionText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
});
