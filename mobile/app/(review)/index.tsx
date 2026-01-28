import { useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { useStore } from "@/stores";
import { ConnectionForm } from "@/components/connection-form";
import { Icon } from "@/components/icon";
import { colors, spacing, radius, typography } from "@/theme";
import * as haptics from "@/utils/haptics";

export default function ReviewIndex() {
  const router = useRouter();

  const connectionStatus = useStore((s) => s.connectionStatus);
  const repos = useStore((s) => s.repos);
  const currentRepoId = useStore((s) => s.currentRepoId);
  const comparisons = useStore((s) => s.comparisons);
  const syncClient = useStore((s) => s.syncClient);
  const selectRepo = useStore((s) => s.selectRepo);
  const fetchComparisons = useStore((s) => s.fetchComparisons);
  const selectComparison = useStore((s) => s.selectComparison);

  useEffect(() => {
    if (syncClient && currentRepoId) {
      fetchComparisons(syncClient, currentRepoId);
    }
  }, [syncClient, currentRepoId, fetchComparisons]);

  if (connectionStatus !== "connected") {
    return <ConnectionForm />;
  }

  if (!currentRepoId) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.container}
      >
        <View style={styles.content}>
          <Text style={styles.sectionLabel}>Repositories</Text>

          <View style={styles.card}>
            <BlurView intensity={50} tint="dark" style={styles.blur}>
              <View style={styles.cardOverlay}>
                {repos.length === 0 ? (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyIcon}>
                      <Icon name="folder" color={colors.text.faint} size={32} />
                    </View>
                    <Text style={styles.emptyTitle}>No repositories available</Text>
                    <Text style={styles.emptySubtitle}>
                      Open a repo in the desktop app to get started
                    </Text>
                  </View>
                ) : (
                  repos.map((repo, index) => (
                    <Pressable
                      key={repo.id}
                      onPress={() => {
                        haptics.selection();
                        selectRepo(repo.id);
                      }}
                      style={({ pressed }) => [
                        styles.listItem,
                        index < repos.length - 1 && styles.listItemBorder,
                        pressed && styles.listItemPressed,
                      ]}
                    >
                      <View style={styles.listIcon}>
                        <Icon name="folder.fill" color={colors.accent.amber} size={18} />
                      </View>
                      <View style={styles.listContent}>
                        <Text style={styles.listTitle}>{repo.name}</Text>
                        <Text style={styles.listSubtitle} numberOfLines={1}>
                          {repo.path}
                        </Text>
                      </View>
                      <Icon name="chevron.right" color={colors.text.faint} size={14} />
                    </Pressable>
                  ))
                )}
              </View>
            </BlurView>
          </View>
        </View>
      </ScrollView>
    );
  }

  const selectedRepo = repos.find((r) => r.id === currentRepoId);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.container}
    >
      <View style={styles.content}>
        <Pressable
          onPress={() => selectRepo("")}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
        >
          <Icon name="chevron.left" color={colors.accent.lime} size={16} />
          <Text style={styles.backText}>Repositories</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>{selectedRepo?.name || "Reviews"}</Text>

        <View style={styles.card}>
          <BlurView intensity={50} tint="dark" style={styles.blur}>
            <View style={styles.cardOverlay}>
              {comparisons.length === 0 ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator
                    color={colors.accent.lime}
                    style={styles.loadingSpinner}
                  />
                  <Text style={styles.emptyTitle}>Loading reviews...</Text>
                </View>
              ) : (
                comparisons.map((comparison, index) => (
                  <Pressable
                    key={comparison.key}
                    onPress={async () => {
                      if (syncClient && currentRepoId) {
                        haptics.selection();
                        await selectComparison(
                          syncClient,
                          currentRepoId,
                          comparison.key,
                        );
                        router.push(
                          `/(review)/${encodeURIComponent(comparison.key)}`,
                        );
                      }
                    }}
                    style={({ pressed }) => [
                      styles.listItem,
                      index < comparisons.length - 1 && styles.listItemBorder,
                      pressed && styles.listItemPressed,
                    ]}
                  >
                    <View style={styles.listIcon}>
                      <Icon
                        name="arrow.left.arrow.right"
                        color={colors.accent.lime}
                        size={18}
                      />
                    </View>
                    <View style={styles.listContent}>
                      <Text style={styles.listTitle}>
                        {comparison.old}..{comparison.new}
                      </Text>
                      <Text style={styles.listSubtitle}>
                        {comparison.workingTree && "Working tree · "}
                        {comparison.stagedOnly && "Staged only · "}
                        {new Date(comparison.updatedAt).toLocaleDateString()}
                      </Text>
                    </View>
                    <Icon name="chevron.right" color={colors.text.faint} size={14} />
                  </Pressable>
                ))
              )}
            </View>
          </BlurView>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  content: {
    padding: spacing.lg,
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.lg,
  },
  card: {
    borderRadius: radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  blur: {
    flex: 1,
  },
  cardOverlay: {
    backgroundColor: "rgba(28, 25, 23, 0.75)",
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: "center",
  },
  emptyIcon: {
    marginBottom: spacing.md,
  },
  emptyTitle: {
    color: colors.text.muted,
    fontSize: typography.fontSize.base,
  },
  emptySubtitle: {
    color: colors.text.faint,
    fontSize: typography.fontSize.sm,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  loadingSpinner: {
    marginBottom: spacing.sm,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
  },
  listItemBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  listItemPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  listIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.md,
  },
  listContent: {
    flex: 1,
  },
  listTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.primary,
    marginBottom: 2,
  },
  listSubtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  backButtonPressed: {
    opacity: 0.7,
  },
  backText: {
    color: colors.accent.lime,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.medium,
    marginLeft: spacing.xs,
  },
});
