import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { useLocalSearchParams, Stack } from "expo-router";
import { useStore } from "@/stores";
import { HunkCard } from "@/components/hunk-card";
import { SwipeableHunk } from "@/components/swipeable-hunk";
import { Icon } from "@/components/icon";
import { isHunkReviewed } from "@/types";
import { colors, spacing, radius, typography } from "@/theme";
import * as haptics from "@/utils/haptics";

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const syncClient = useStore((s) => s.syncClient);
  const currentRepoId = useStore((s) => s.currentRepoId);
  const remoteState = useStore((s) => s.remoteState);
  const layoutMode = useStore((s) => s.layoutMode);
  const selectedFile = useStore((s) => s.selectedFile);
  const currentHunkIndex = useStore((s) => s.currentHunkIndex);
  const setLayoutMode = useStore((s) => s.setLayoutMode);
  const setSelectedFile = useStore((s) => s.setSelectedFile);
  const approveHunk = useStore((s) => s.approveHunk);
  const rejectHunk = useStore((s) => s.rejectHunk);
  const nextHunk = useStore((s) => s.nextHunk);
  const getAllHunks = useStore((s) => s.getAllHunks);
  const getFilteredHunks = useStore((s) => s.getFilteredHunks);
  const getCurrentHunk = useStore((s) => s.getCurrentHunk);

  const allHunks = getAllHunks();
  const filteredHunks = getFilteredHunks();
  const currentHunk = getCurrentHunk();
  const trustList = remoteState?.trustList || [];

  const filesWithHunks = Array.from(
    new Set(allHunks.map((h) => h.filePath)),
  ).sort();

  const reviewedCount = allHunks.filter((hunk) =>
    isHunkReviewed(remoteState?.hunks[hunk.id], trustList),
  ).length;

  const progressPercent =
    allHunks.length > 0 ? (reviewedCount / allHunks.length) * 100 : 0;

  const handleApprove = async () => {
    if (!currentHunk || !syncClient || !currentRepoId) return;
    haptics.success();
    await approveHunk(syncClient, currentRepoId, currentHunk.id);
    nextHunk();
  };

  const handleReject = async () => {
    if (!currentHunk || !syncClient || !currentRepoId) return;
    haptics.error();
    await rejectHunk(syncClient, currentRepoId, currentHunk.id);
    nextHunk();
  };

  const comparisonKey = id ? decodeURIComponent(id) : "";

  return (
    <>
      <Stack.Screen
        options={{
          title: comparisonKey.split("+")[0] || "Review",
          headerStyle: {
            backgroundColor: colors.bg.secondary,
          },
          headerTintColor: colors.text.primary,
          headerTitleStyle: {
            fontWeight: typography.fontWeight.semibold,
            color: colors.text.primary,
          },
          headerRight: () => (
            <Pressable
              onPress={() => {
                haptics.selection();
                setLayoutMode(layoutMode === "cards" ? "list" : "cards");
              }}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                padding: spacing.sm,
              })}
            >
              <Icon
                name={layoutMode === "cards" ? "list.bullet" : "square.stack"}
                color={colors.accent.lime}
                size={22}
              />
            </Pressable>
          ),
        }}
      />

      <View style={styles.container}>
        {/* Glass progress section */}
        <View style={styles.progressSection}>
          <BlurView intensity={60} tint="dark" style={styles.blur}>
            <View style={styles.progressContent}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>
                  {reviewedCount} of {allHunks.length} hunks reviewed
                </Text>
                <Text
                  style={[
                    styles.progressPercent,
                    progressPercent === 100 && styles.progressComplete,
                  ]}
                >
                  {Math.round(progressPercent)}%
                </Text>
              </View>

              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${progressPercent}%` },
                  ]}
                />
              </View>
            </View>
          </BlurView>
        </View>

        {/* Glass file filter */}
        <View style={styles.filterSection}>
          <BlurView intensity={50} tint="dark" style={styles.blur}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterContent}
            >
              <Pressable
                onPress={() => {
                  haptics.selection();
                  setSelectedFile(null);
                }}
                style={[
                  styles.chip,
                  selectedFile === null && styles.chipActive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    selectedFile === null && styles.chipTextActive,
                  ]}
                >
                  All ({allHunks.length})
                </Text>
              </Pressable>

              {filesWithHunks.map((filePath) => {
                const fileName = filePath.split("/").pop() || filePath;
                const fileHunks = allHunks.filter((h) => h.filePath === filePath);
                const isSelected = selectedFile === filePath;

                return (
                  <Pressable
                    key={filePath}
                    onPress={() => {
                      haptics.selection();
                      setSelectedFile(filePath);
                    }}
                    style={[styles.chip, isSelected && styles.chipActive]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        isSelected && styles.chipTextActive,
                      ]}
                    >
                      {fileName} ({fileHunks.length})
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </BlurView>
        </View>

        {/* Main content */}
        {layoutMode === "cards" ? (
          <View style={styles.cardContainer}>
            {currentHunk ? (
              <SwipeableHunk
                hunk={currentHunk}
                hunkState={remoteState?.hunks[currentHunk.id]}
                trustList={trustList}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ) : (
              <View style={styles.completionContainer}>
                <View style={styles.completionIcon}>
                  <BlurView intensity={40} tint="dark" style={styles.blur}>
                    <View style={styles.completionIconOverlay}>
                      <Icon
                        name="checkmark.circle.fill"
                        color={colors.success}
                        size={48}
                      />
                    </View>
                  </BlurView>
                </View>
                <Text style={styles.completionTitle}>All Done!</Text>
                <Text style={styles.completionSubtitle}>
                  All hunks have been reviewed
                </Text>
              </View>
            )}

            {filteredHunks.length > 0 && currentHunk && (
              <View style={styles.cardNav}>
                <Text style={styles.cardNavText}>
                  {currentHunkIndex + 1} of {filteredHunks.length}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            style={styles.listScroll}
          >
            <View style={styles.listContent}>
              {filteredHunks.map((hunk) => (
                <HunkCard
                  key={hunk.id}
                  hunk={hunk}
                  hunkState={remoteState?.hunks[hunk.id]}
                  trustList={trustList}
                  onApprove={async () => {
                    if (syncClient && currentRepoId) {
                      haptics.success();
                      await approveHunk(syncClient, currentRepoId, hunk.id);
                    }
                  }}
                  onReject={async () => {
                    if (syncClient && currentRepoId) {
                      haptics.error();
                      await rejectHunk(syncClient, currentRepoId, hunk.id);
                    }
                  }}
                />
              ))}
            </View>
          </ScrollView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  blur: {
    flex: 1,
  },
  progressSection: {
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  progressContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: "rgba(28, 25, 23, 0.8)",
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  progressLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
  },
  progressPercent: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.secondary,
  },
  progressComplete: {
    color: colors.success,
  },
  progressBar: {
    height: 4,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.success,
    borderRadius: 2,
  },
  filterSection: {
    maxHeight: 52,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  filterContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    backgroundColor: "rgba(28, 25, 23, 0.75)",
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.05)",
  },
  chipActive: {
    backgroundColor: colors.accent.lime,
    borderColor: colors.accent.lime,
  },
  chipText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.secondary,
  },
  chipTextActive: {
    color: colors.stone[950],
  },
  cardContainer: {
    flex: 1,
    padding: spacing.lg,
  },
  completionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing["2xl"],
  },
  completionIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: "hidden",
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(132, 204, 22, 0.3)",
  },
  completionIconOverlay: {
    flex: 1,
    backgroundColor: "rgba(132, 204, 22, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  completionTitle: {
    fontSize: typography.fontSize["2xl"],
    fontWeight: typography.fontWeight.bold,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  completionSubtitle: {
    fontSize: typography.fontSize.base,
    color: colors.text.muted,
    textAlign: "center",
  },
  cardNav: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing.lg,
  },
  cardNavText: {
    fontSize: typography.fontSize.base,
    color: colors.text.muted,
    fontWeight: typography.fontWeight.medium,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
});
