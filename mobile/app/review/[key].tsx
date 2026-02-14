import { useState } from "react";
import {
  View,
  Text,
  SectionList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { FileListItem } from "../../components/FileListItem";
import { GlassTabBar } from "../../components/GlassTabBar";
import { FileTreeNode } from "../../components/FileTreeNode";
import { colors, stone } from "../../lib/colors";
import { useReviewDetail } from "../../hooks/useReviewDetail";
import type { FileEntry } from "../../api/types";

export default function ReviewDetailScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const [tabIndex, setTabIndex] = useState(0);

  const {
    sections,
    changedFiles,
    browseTree,
    expandedPaths,
    toggleExpand,
    hunkCountsMap,
    stats,
    isLoading,
    isRefreshing,
    handleRefresh,
    handleFilePress,
    reviewState,
    repoName,
    hunks,
    countFileHunks,
    countReviewedHunks,
  } = useReviewDetail(key);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Review" }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={stone[400]} />
        </View>
      </>
    );
  }

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

  const header = (
    <View style={styles.statsRow}>
      <View style={styles.stat}>
        <Text style={styles.statNumber}>{stats.fileCount}</Text>
        <Text style={styles.statLabel}>files</Text>
      </View>
      <View style={styles.stat}>
        <Text style={[styles.statNumber, { color: colors.approved }]}>
          {stats.reviewedHunkCount}
        </Text>
        <Text style={styles.statLabel}>reviewed</Text>
      </View>
      {stats.trustedHunkCount > 0 && (
        <View style={styles.stat}>
          <Text style={[styles.statNumber, { color: colors.trusted }]}>
            {stats.trustedHunkCount}
          </Text>
          <Text style={styles.statLabel}>trusted</Text>
        </View>
      )}
      <View style={styles.stat}>
        <Text style={styles.statNumber}>{stats.totalHunks}</Text>
        <Text style={styles.statLabel}>hunks</Text>
      </View>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: repoName }} />
      <View style={styles.container}>
        {tabIndex === 0 ? (
          <SectionList
            style={styles.list}
            contentContainerStyle={styles.listContent}
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
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            contentInsetAdjustmentBehavior="automatic"
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
              />
            }
          >
            {header}
            {browseTree.map((entry) => (
              <FileTreeNode
                key={entry.path}
                entry={entry}
                depth={0}
                expandedPaths={expandedPaths}
                onToggleExpand={toggleExpand}
                onFilePress={(file) => handleFilePress(file, "browse")}
                hunkCounts={hunkCountsMap}
              />
            ))}
          </ScrollView>
        )}
        <GlassTabBar
          tabs={["Changes", "Browse"]}
          selectedIndex={tabIndex}
          onSelect={setTabIndex}
          badges={[changedFiles.length, undefined]}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: stone[950],
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 70,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: stone[950],
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
    color: stone[50],
  },
  statLabel: {
    fontSize: 12,
    color: stone[500],
    marginTop: 2,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: stone[950],
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: stone[500],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  emptyContainer: {
    padding: 32,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
    color: stone[500],
  },
});
