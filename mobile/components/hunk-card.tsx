import { View, Text, Pressable, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import type { DiffHunk, HunkState } from "@/types";
import { isHunkTrusted, isHunkReviewed } from "@/types";
import { CodeBlock } from "./code-block";
import { Icon } from "./icon";
import { colors, spacing, radius, typography, shadows } from "@/theme";
import * as haptics from "@/utils/haptics";

interface HunkCardProps {
  hunk: DiffHunk;
  hunkState?: HunkState;
  trustList: string[];
  onApprove: () => void;
  onReject: () => void;
  compact?: boolean;
}

export function HunkCard({
  hunk,
  hunkState,
  trustList,
  onApprove,
  onReject,
  compact = false,
}: HunkCardProps) {
  const fileName = hunk.filePath.split("/").pop() || hunk.filePath;
  const directory = hunk.filePath.slice(0, -fileName.length - 1);

  const isReviewed = isHunkReviewed(hunkState, trustList);
  const isTrusted = isHunkTrusted(hunkState, trustList);
  const isApproved = hunkState?.status === "approved";
  const isRejected = hunkState?.status === "rejected";

  const labels = hunkState?.label || [];

  // Status-based styling
  const getBorderColor = () => {
    if (isApproved) return "rgba(132, 204, 22, 0.4)";
    if (isRejected) return "rgba(244, 63, 94, 0.4)";
    if (isTrusted) return "rgba(6, 182, 212, 0.4)";
    return "rgba(255, 255, 255, 0.1)";
  };

  const getHeaderOverlay = () => {
    if (isApproved) return "rgba(132, 204, 22, 0.12)";
    if (isRejected) return "rgba(244, 63, 94, 0.12)";
    if (isTrusted) return "rgba(6, 182, 212, 0.12)";
    return "transparent";
  };

  return (
    <View style={[styles.container, { borderColor: getBorderColor() }]}>
      <BlurView intensity={50} tint="dark" style={styles.blur}>
        <View style={styles.overlay}>
          {/* Header */}
          <View style={[styles.header, { backgroundColor: getHeaderOverlay() }]}>
            <View style={styles.headerContent}>
              <Text style={styles.fileName}>{fileName}</Text>
              {directory && !compact && (
                <Text style={styles.directory}>{directory}</Text>
              )}
            </View>

            {isApproved && (
              <Icon name="checkmark.circle.fill" color={colors.success} size={20} />
            )}
            {isRejected && (
              <Icon name="xmark.circle.fill" color={colors.error} size={20} />
            )}
            {isTrusted && !isApproved && !isRejected && (
              <Icon name="checkmark.shield.fill" color={colors.info} size={20} />
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
          <View style={compact ? styles.codeCompact : undefined}>
            <CodeBlock lines={hunk.lines} maxHeight={compact ? 150 : 300} />
          </View>

          {/* Actions */}
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
                  pressed && styles.rejectButtonPressed,
                ]}
              >
                <Icon name="xmark" color={colors.error} size={16} />
                <Text style={styles.rejectText}>Reject</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  haptics.success();
                  onApprove();
                }}
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.approveButton,
                  pressed && styles.approveButtonPressed,
                ]}
              >
                <Icon name="checkmark" color={colors.success} size={16} />
                <Text style={styles.approveText}>Approve</Text>
              </Pressable>
            </View>
          )}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    ...shadows.md,
  },
  blur: {
    flex: 1,
  },
  overlay: {
    backgroundColor: "rgba(28, 25, 23, 0.75)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  headerContent: {
    flex: 1,
  },
  fileName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  directory: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    marginTop: 2,
  },
  labels: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: spacing.sm,
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
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.muted,
  },
  labelTextTrusted: {
    color: colors.info,
  },
  codeCompact: {
    padding: spacing.sm,
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
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  rejectButton: {
    borderRightWidth: 0.5,
    borderRightColor: "rgba(255, 255, 255, 0.08)",
  },
  rejectButtonPressed: {
    backgroundColor: "rgba(244, 63, 94, 0.15)",
  },
  approveButton: {},
  approveButtonPressed: {
    backgroundColor: "rgba(132, 204, 22, 0.15)",
  },
  rejectText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    color: colors.error,
  },
  approveText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    color: colors.success,
  },
});
