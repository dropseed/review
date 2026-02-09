import { View, Text, StyleSheet } from "react-native";
import { useConnectionStore } from "../stores/connection";

export function ConnectionBadge() {
  const { isConnected, serverInfo } = useConnectionStore();

  if (!isConnected) {
    return (
      <View style={[styles.badge, styles.disconnected]}>
        <View style={[styles.dot, { backgroundColor: "#f43f5e" }]} />
        <Text style={styles.text}>Disconnected</Text>
      </View>
    );
  }

  return (
    <View style={[styles.badge, styles.connected]}>
      <View style={[styles.dot, { backgroundColor: "#10b981" }]} />
      <Text style={styles.text}>{serverInfo?.hostname ?? "Connected"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderCurve: "continuous",
    gap: 6,
  },
  connected: {
    backgroundColor: "#f0fdf4",
  },
  disconnected: {
    backgroundColor: "#fff1f2",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontSize: 13,
    fontWeight: "500",
    color: "#333",
  },
});
