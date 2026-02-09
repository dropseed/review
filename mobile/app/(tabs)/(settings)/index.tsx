import { View, Text, Pressable, StyleSheet, Alert, ScrollView } from "react-native";
import { useConnectionStore } from "../../../stores/connection";
import { ConnectionBadge } from "../../../components/ConnectionBadge";

export default function SettingsScreen() {
  const { serverUrl, serverInfo, disconnect } = useConnectionStore();

  const handleDisconnect = () => {
    Alert.alert("Disconnect", "Are you sure you want to disconnect?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: disconnect,
      },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentInsetAdjustmentBehavior="automatic">
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Status</Text>
            <ConnectionBadge />
          </View>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>Server</Text>
            <Text style={styles.rowValue} numberOfLines={1} selectable>
              {serverUrl || "Not connected"}
            </Text>
          </View>
          {serverInfo && (
            <>
              <View style={[styles.row, styles.rowBorder]}>
                <Text style={styles.rowLabel}>Hostname</Text>
                <Text style={styles.rowValue} selectable>
                  {serverInfo.hostname}
                </Text>
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <Text style={styles.rowLabel}>Version</Text>
                <Text style={styles.rowValue} selectable>
                  {serverInfo.version}
                </Text>
              </View>
              <View style={[styles.row, styles.rowBorder]}>
                <Text style={styles.rowLabel}>Repositories</Text>
                <Text style={styles.rowValue}>{serverInfo.repos.length}</Text>
              </View>
            </>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [
              styles.destructiveRow,
              pressed && styles.rowPressed,
            ]}
            onPress={handleDisconnect}
          >
            <Text style={styles.destructiveText}>Disconnect</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.footer}>
        Review Mobile{serverInfo ? ` -- Server v${serverInfo.version}` : ""}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f2f2f7",
    paddingTop: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "400",
    color: "#6d6d72",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  card: {
    backgroundColor: "#fff",
    marginHorizontal: 16,
    borderRadius: 10,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#c6c6c8",
    marginLeft: 16,
    paddingLeft: 0,
  },
  rowLabel: {
    fontSize: 17,
    color: "#000",
  },
  rowValue: {
    fontSize: 17,
    color: "#8e8e93",
    flex: 1,
    textAlign: "right",
    marginLeft: 16,
  },
  destructiveRow: {
    paddingVertical: 12,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  rowPressed: {
    backgroundColor: "#e5e5ea",
  },
  destructiveText: {
    fontSize: 17,
    color: "#ff3b30",
  },
  footer: {
    textAlign: "center",
    fontSize: 13,
    color: "#8e8e93",
    paddingTop: 8,
  },
});
