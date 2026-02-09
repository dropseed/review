import { useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  PanResponder,
} from "react-native";
import * as Haptics from "expo-haptics";
import type { DiffHunk, HunkState } from "../api/types";
import { DiffLine } from "./DiffLine";
import { colors } from "../lib/colors";
import { monoFont } from "../lib/utils";

interface HunkViewProps {
  hunk: DiffHunk;
  hunkState?: HunkState;
  onApprove: () => void;
  onReject: () => void;
}

const SWIPE_THRESHOLD = 80;

export function HunkView({
  hunk,
  hunkState,
  onApprove,
  onReject,
}: HunkViewProps) {
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 20,
      onPanResponderMove: (_, gestureState) => {
        translateX.setValue(gestureState.dx);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > SWIPE_THRESHOLD) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onApprove();
        } else if (gestureState.dx < -SWIPE_THRESHOLD) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          onReject();
        }
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  const status = hunkState?.status;
  const labels = hunkState?.label ?? [];
  const borderColor =
    status === "approved"
      ? colors.approved
      : status === "rejected"
        ? colors.rejected
        : "#e5e5ea";

  return (
    <View style={styles.container}>
      {/* Swipe background indicators */}
      <View style={styles.swipeBackground}>
        <View style={[styles.swipeAction, styles.swipeApprove]}>
          <Text style={styles.swipeText}>Approve</Text>
        </View>
        <View style={[styles.swipeAction, styles.swipeReject]}>
          <Text style={styles.swipeText}>Reject</Text>
        </View>
      </View>

      <Animated.View
        style={[
          styles.hunk,
          { borderLeftColor: borderColor },
          { transform: [{ translateX }] },
        ]}
        {...panResponder.panHandlers}
      >
        {/* Hunk header */}
        <View style={styles.header}>
          <Text style={styles.headerText} numberOfLines={1}>
            @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},
            {hunk.newCount} @@
          </Text>
          {labels.length > 0 && (
            <View style={styles.labels}>
              {labels.map((label) => (
                <View key={label} style={styles.labelPill}>
                  <Text style={styles.labelText}>{label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Diff lines */}
        <View style={styles.lines}>
          {hunk.lines.map((line, i) => (
            <DiffLine key={i} line={line} />
          ))}
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          <Pressable
            style={[
              styles.actionButton,
              status === "approved" && styles.approveActive,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onApprove();
            }}
          >
            <Text
              style={[
                styles.actionText,
                { color: status === "approved" ? "#fff" : colors.approved },
              ]}
            >
              Approve
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.actionButton,
              status === "rejected" && styles.rejectActive,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onReject();
            }}
          >
            <Text
              style={[
                styles.actionText,
                { color: status === "rejected" ? "#fff" : colors.rejected },
              ]}
            >
              Reject
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 6,
    marginHorizontal: 8,
  },
  swipeBackground: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 8,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  swipeAction: {
    width: 100,
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  swipeApprove: {
    backgroundColor: colors.approved,
    alignItems: "flex-start",
    paddingLeft: 16,
  },
  swipeReject: {
    backgroundColor: colors.rejected,
    alignItems: "flex-end",
    paddingRight: 16,
  },
  swipeText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  hunk: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderCurve: "continuous",
    borderLeftWidth: 3,
    overflow: "hidden",
    boxShadow: "0px 1px 3px rgba(0, 0, 0, 0.06)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#f9fafb",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5ea",
    gap: 8,
  },
  headerText: {
    fontSize: 11,
    fontFamily: monoFont,
    color: "#6b7280",
    flex: 1,
    fontVariant: ["tabular-nums"],
  },
  labels: {
    flexDirection: "row",
    gap: 4,
    flexWrap: "wrap",
  },
  labelPill: {
    backgroundColor: "#ede9fe",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderCurve: "continuous",
  },
  labelText: {
    fontSize: 10,
    color: "#7c3aed",
    fontWeight: "500",
  },
  lines: {
    overflow: "hidden",
  },
  actions: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e5ea",
  },
  actionButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  approveActive: {
    backgroundColor: colors.approved,
  },
  rejectActive: {
    backgroundColor: colors.rejected,
  },
  actionText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
