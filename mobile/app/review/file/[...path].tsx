import { useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { useFile, useReviewState, useSaveReviewState } from "../../../api/hooks";
import { HunkView } from "../../../components/HunkView";
import { decodeReviewKey, monoFont } from "../../../lib/utils";
import type { ReviewState } from "../../../api/types";

export default function FileDiffScreen() {
  const { path: pathSegments, reviewKey, mode } =
    useLocalSearchParams<{ path: string[]; reviewKey: string; mode?: string }>();

  const isBrowseMode = mode === "browse";

  const filePath = Array.isArray(pathSegments)
    ? pathSegments.join("/")
    : pathSegments;

  const params = useMemo(() => {
    try {
      return decodeReviewKey(reviewKey);
    } catch {
      return null;
    }
  }, [reviewKey]);

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

  const { data: fileContent, isLoading: fileLoading } = useFile(
    params?.repo,
    filePath,
    comparison
  );
  const { data: reviewState } = useReviewState(params?.repo, comparison);
  const saveState = useSaveReviewState();

  const handleAction = useCallback(
    (hunkId: string, action: "approved" | "rejected") => {
      if (!reviewState || !params?.repo) return;

      const currentHunk = reviewState.hunks[hunkId];
      const newStatus = currentHunk?.status === action ? undefined : action;

      const updatedState: ReviewState = {
        ...reviewState,
        hunks: {
          ...reviewState.hunks,
          [hunkId]: {
            ...(currentHunk ?? { label: [] }),
            status: newStatus,
          },
        },
        updatedAt: new Date().toISOString(),
        version: reviewState.version + 1,
      };

      saveState.mutate({
        repoPath: params.repo,
        state: updatedState,
      });
    },
    [reviewState, params?.repo, saveState]
  );

  const fileName = filePath?.split("/").pop() ?? "File";

  if (fileLoading) {
    return (
      <>
        <Stack.Screen options={{ title: fileName }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      </>
    );
  }

  if (!fileContent) {
    return (
      <>
        <Stack.Screen options={{ title: fileName }} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Failed to load file</Text>
        </View>
      </>
    );
  }

  // Browse mode: show full file content
  if (isBrowseMode) {
    const lines = fileContent.content.split("\n");
    return (
      <>
        <Stack.Screen options={{ title: fileName }} />
        <ScrollView
          style={styles.scroll}
          contentInsetAdjustmentBehavior="automatic"
          horizontal={false}
        >
          <Text style={styles.filePath} numberOfLines={2} selectable>
            {filePath}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.codeBlock}>
              {lines.map((line, i) => (
                <View key={i} style={styles.codeLine}>
                  <Text style={styles.codeLineNumber}>{i + 1}</Text>
                  <Text style={styles.codeLineContent} selectable>
                    {line || " "}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      </>
    );
  }

  // Changes mode: show diff hunks
  return (
    <>
      <Stack.Screen options={{ title: fileName }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <Text style={styles.filePath} numberOfLines={2} selectable>
          {filePath}
        </Text>

        {fileContent.hunks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No changes in this file</Text>
          </View>
        ) : (
          fileContent.hunks.map((hunk) => (
            <HunkView
              key={hunk.id}
              hunk={hunk}
              hunkState={reviewState?.hunks[hunk.id]}
              onApprove={() => handleAction(hunk.id, "approved")}
              onReject={() => handleAction(hunk.id, "rejected")}
            />
          ))
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  content: {
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  filePath: {
    fontSize: 13,
    color: "#666",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  emptyContainer: {
    padding: 32,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
    color: "#999",
  },
  errorText: {
    fontSize: 16,
    color: "#f43f5e",
  },
  codeBlock: {
    backgroundColor: "#fff",
    marginHorizontal: 8,
    borderRadius: 8,
    borderCurve: "continuous",
    overflow: "hidden",
    paddingVertical: 8,
  },
  codeLine: {
    flexDirection: "row",
    minHeight: 20,
    paddingVertical: 1,
  },
  codeLineNumber: {
    width: 44,
    fontSize: 12,
    fontFamily: monoFont,
    color: "#9ca3af",
    textAlign: "right",
    paddingRight: 12,
    fontVariant: ["tabular-nums"],
  },
  codeLineContent: {
    fontSize: 12,
    fontFamily: monoFont,
    color: "#1f2937",
    paddingRight: 16,
  },
});
