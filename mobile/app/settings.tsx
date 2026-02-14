import { View, Text, Pressable, StyleSheet, Alert, ScrollView } from "react-native";
import { useConnectionStore } from "../stores/connection";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { stone, borderSubtle } from "../lib/colors";

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
        Review Mobile{serverInfo ? ` · Server v${serverInfo.version}` : ""}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: stone[950],
    paddingTop: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "400",
    color: stone[500],
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  card: {
    backgroundColor: stone[900],
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
    borderTopColor: borderSubtle,
    marginLeft: 16,
    paddingLeft: 0,
  },
  rowLabel: {
    fontSize: 17,
    color: stone[50],
  },
  rowValue: {
    fontSize: 17,
    color: stone[500],
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
    backgroundColor: stone[800],
  },
  destructiveText: {
    fontSize: 17,
    color: "#ff3b30",
  },
  footer: {
    textAlign: "center",
    fontSize: 13,
    color: stone[600],
    paddingTop: 8,
  },
});
