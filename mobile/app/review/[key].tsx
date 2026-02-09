import { useMemo, useState } from "react";
import {
  View,
  Text,
  SectionList,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { useFiles, useAllHunks, useReviewState } from "../../api/hooks";
import { FileListItem } from "../../components/FileListItem";
import { decodeReviewKey } from "../../lib/utils";
import { colors } from "../../lib/colors";
import type { FileEntry, DiffHunk, ReviewState } from "../../api/types";

function hasChangeStatus(status: FileEntry["status"]): boolean {
  return (
    status === "added" ||
    status === "modified" ||
    status === "deleted" ||
    status === "renamed" ||
    status === "untracked"
  );
}

function flattenFiles(entries: FileEntry[]): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.isDirectory && entry.children) {
      result.push(...flattenFiles(entry.children));
    } else if (!entry.isDirectory) {
      result.push(entry);
    }
  }
  return result;
}

/** Count hunks for a file from the batch-fetched hunks array */
function countFileHunks(filePath: string, hunks: DiffHunk[]): number {
  return hunks.filter((h) => h.filePath === filePath).length;
}

/** Count reviewed hunks from review state (approved, rejected, or trusted) */
function countReviewedHunks(
  filePath: string,
  hunks: DiffHunk[],
  reviewState: ReviewState | undefined
): number {
  if (!reviewState) return 0;
  let count = 0;
  for (const hunk of hunks) {
    if (hunk.filePath !== filePath) continue;
    const state = reviewState.hunks[hunk.id];
    if (state?.status) {
      count++;
    } else if (state?.label && state.label.length > 0) {
      for (const label of state.label) {
        if (reviewState.trustList.some((p) => matchesPattern(label, p))) {
          count++;
          break;
        }
      }
    }
  }
  return count;
}

function matchesPattern(label: string, pattern: string): boolean {
  if (!pattern.includes("*")) return label === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regexPattern = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${regexPattern}$`).test(label);
}

export default function ReviewDetailScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const router = useRouter();
  const [tabIndex, setTabIndex] = useState(0);

  const params = useMemo(() => {
    try {
      return decodeReviewKey(key);
    } catch {
      return null;
    }
  }, [key]);

  const comparison = useMemo(
    () =>
      params
        ? {
            old: params.old,
            new: params.new,
            workingTree: params.workingTree,
            key: `${params.old}..${params.new}`,
          }
        : undefined,
    [params]
  );

  const {
    data: files,
    isLoading: filesLoading,
    refetch: refetchFiles,
    isRefetching: isRefetchingFiles,
  } = useFiles(params?.repo, comparison);
  const {
    data: reviewState,
    refetch: refetchState,
    isRefetching: isRefetchingState,
  } = useReviewState(params?.repo, comparison);

  // Get only files with changes for the hunks request
  const flatFiles = useMemo(() => (files ? flattenFiles(files) : []), [files]);
  const changedFiles = useMemo(
    () => flatFiles.filter((f) => hasChangeStatus(f.status)),
    [flatFiles]
  );
  const changedPaths = useMemo(
    () => changedFiles.map((f) => f.path),
    [changedFiles]
  );

  // Batch-fetch all hunks for changed files
  const {
    data: allHunks,
    refetch: refetchHunks,
    isRefetching: isRefetchingHunks,
  } = useAllHunks(params?.repo, comparison, changedPaths);
  const hunks = allHunks ?? [];

  // Sections for "Changes" tab
  const sections = useMemo(() => {
    const needsReview: FileEntry[] = [];
    const reviewed: FileEntry[] = [];

    for (const file of changedFiles) {
      const totalHunks = countFileHunks(file.path, hunks);
      const reviewedHunks = countReviewedHunks(file.path, hunks, reviewState);
      if (totalHunks > 0 && reviewedHunks >= totalHunks) {
        reviewed.push(file);
      } else {
        needsReview.push(file);
      }
    }

    const result = [];
    if (needsReview.length > 0) {
      result.push({ title: "Needs Review", data: needsReview });
    }
    if (reviewed.length > 0) {
      result.push({ title: "Reviewed", data: reviewed });
    }
    return result;
  }, [changedFiles, hunks, reviewState]);

  // Stats
  const totalHunks = hunks.length;
  const reviewedHunkCount = useMemo(() => {
    if (!reviewState) return 0;
    let count = 0;
    for (const hunk of hunks) {
      const state = reviewState.hunks[hunk.id];
      if (state?.status) {
        count++;
      } else if (state?.label && state.label.length > 0) {
        for (const label of state.label) {
          if (reviewState.trustList.some((p) => matchesPattern(label, p))) {
            count++;
            break;
          }
        }
      }
    }
    return count;
  }, [hunks, reviewState]);

  const handleFilePress = (file: FileEntry, mode?: "browse") => {
    const params = mode
      ? `?reviewKey=${key}&mode=${mode}`
      : `?reviewKey=${key}`;
    router.push(`/review/file/${file.path}${params}`);
  };

  const handleRefresh = () => {
    refetchFiles();
    refetchState();
    refetchHunks();
  };

  if (filesLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Review" }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      </>
    );
  }

  const repoName = params?.repo?.split("/").pop() ?? "Review";

  const renderChangesItem = ({ item }: { item: FileEntry }) => (
    <FileListItem
      name={item.name}
      path={item.path}
      status={item.status}
      hunkCount={countFileHunks(item.path, hunks)}
      reviewedCount={countReviewedHunks(item.path, hunks, reviewState)}
      onPress={() => handleFilePress(item)}
    />
  );

  const renderBrowseItem = ({ item }: { item: FileEntry }) => (
    <FileListItem
      name={item.name}
      path={item.path}
      status={item.status}
      hunkCount={countFileHunks(item.path, hunks)}
      reviewedCount={countReviewedHunks(item.path, hunks, reviewState)}
      onPress={() => handleFilePress(item, "browse")}
    />
  );

  const isRefreshing = isRefetchingFiles || isRefetchingState || isRefetchingHunks;

  const header = (
    <View>
      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{changedFiles.length}</Text>
          <Text style={styles.statLabel}>files</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statNumber, { color: colors.approved }]}>
            {reviewedHunkCount}
          </Text>
          <Text style={styles.statLabel}>reviewed</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{totalHunks}</Text>
          <Text style={styles.statLabel}>hunks</Text>
        </View>
      </View>

      {/* Native segmented control */}
      <View style={styles.segmentedWrapper}>
        <SegmentedControl
          values={[`Changes (${changedFiles.length})`, "Browse"]}
          selectedIndex={tabIndex}
          onChange={({ nativeEvent }) =>
            setTabIndex(nativeEvent.selectedSegmentIndex)
          }
        />
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: repoName }} />
      {tabIndex === 0 ? (
        <SectionList
          style={styles.list}
          contentInsetAdjustmentBehavior="automatic"
          sections={sections}
          keyExtractor={(item) => item.path}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
          )}
          renderItem={renderChangesItem}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No changed files</Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
            />
          }
        />
      ) : (
        <FlatList
          style={styles.list}
          contentInsetAdjustmentBehavior="automatic"
          data={flatFiles}
          keyExtractor={(item) => item.path}
          renderItem={renderBrowseItem}
          ListHeaderComponent={header}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
            />
          }
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  statsRow: {
    flexDirection: "row",
    gap: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  stat: {
    alignItems: "center",
  },
  statNumber: {
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  segmentedWrapper: {
    marginHorizontal: 16,
    marginVertical: 8,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#f2f2f7",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  emptyContainer: {
    padding: 32,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
    color: "#999",
  },
});
