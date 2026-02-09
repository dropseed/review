import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { useReviewsGlobal } from "../../../api/hooks";
import { ReviewCard } from "../../../components/ReviewCard";
import { encodeReviewKey } from "../../../lib/utils";
import type { GlobalReviewSummary } from "../../../api/types";

export default function ReviewsScreen() {
  const router = useRouter();
  const { data: reviews, isLoading, refetch, isRefetching } = useReviewsGlobal();

  const handlePress = (review: GlobalReviewSummary) => {
    const key = encodeReviewKey(
      review.repoPath,
      review.comparison.old,
      review.comparison.new,
      review.comparison.workingTree
    );
    router.push(`/review/${key}`);
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
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

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      contentInsetAdjustmentBehavior="automatic"
      data={reviews}
      keyExtractor={(item) => `${item.repoPath}:${item.comparison.key}`}
      renderItem={({ item }) => (
        <ReviewCard review={item} onPress={() => handlePress(item)} />
      )}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  listContent: {
    paddingVertical: 8,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f2f2f7",
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
  },
});
