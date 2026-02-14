import { useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useReviewsGlobal, useReviewDiffStats, useRepoAvatars } from "../../../api/hooks";
import { ReviewRow } from "../../../components/ReviewCard";
import { encodeReviewKey } from "../../../lib/utils";
import { stone, borderSubtle } from "../../../lib/colors";
import type { GlobalReviewSummary } from "../../../api/types";

export default function ReviewsScreen() {
  const router = useRouter();
  const {
    data: reviews,
    isLoading,
    refetch,
    isRefetching,
  } = useReviewsGlobal();
  const { data: diffInfoMap } = useReviewDiffStats(reviews);
  const { data: avatarMap } = useRepoAvatars(reviews);

  const activeReviews = useMemo(() => {
    if (!reviews) return [];
    if (!diffInfoMap) return reviews; // Show all while loading
    return reviews.filter((r) => {
      const key = `${r.repoPath}:${r.comparison.key}`;
      return diffInfoMap[key]?.isActive ?? true;
    });
  }, [reviews, diffInfoMap]);

  const handlePress = (review: GlobalReviewSummary) => {
    const key = encodeReviewKey(
      review.repoPath,
      review.comparison.base,
      review.comparison.head,
    );
    router.push(`/review/${key}`);
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={stone[400]} />
      </View>
    );
  }

  if (!reviews || reviews.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>No Reviews</Text>
        <Text style={styles.emptyText}>
          Start a review in the desktop app to see it here.
        </Text>
      </View>
    );
  }

  if (activeReviews.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>No Active Reviews</Text>
        <Text style={styles.emptyText}>
          All reviews have empty diffs. Start a new comparison in the desktop
          app.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      contentInsetAdjustmentBehavior="automatic"
      data={activeReviews}
      keyExtractor={(item) => `${item.repoPath}:${item.comparison.key}`}
      ItemSeparatorComponent={Separator}
      renderItem={({ item }) => (
        <ReviewRow
          review={item}
          diffStats={
            diffInfoMap?.[`${item.repoPath}:${item.comparison.key}`]?.stats ??
            null
          }
          avatarUrl={avatarMap?.[item.repoPath] ?? null}
          onPress={() => handlePress(item)}
        />
      )}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    />
  );
}

function Separator() {
  return (
    <View style={styles.separatorOuter}>
      <View style={styles.separatorLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: stone[950],
  },
  listContent: {
    backgroundColor: stone[900],
  },
  separatorOuter: {
    backgroundColor: stone[900],
    paddingLeft: 16,
  },
  separatorLine: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: borderSubtle,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: stone[950],
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
    color: stone[50],
  },
  emptyText: {
    fontSize: 15,
    color: stone[500],
    textAlign: "center",
  },
});
