import { View, Text, ScrollView, Pressable, Alert, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { useStore } from "@/stores";
import { Icon } from "@/components/icon";
import { colors, spacing, radius, typography } from "@/theme";
import * as haptics from "@/utils/haptics";

export default function SettingsScreen() {
  const connectionStatus = useStore((s) => s.connectionStatus);
  const serverUrl = useStore((s) => s.serverUrl);
  const disconnect = useStore((s) => s.disconnect);
  const resetSyncState = useStore((s) => s.resetSyncState);
  const layoutMode = useStore((s) => s.layoutMode);
  const setLayoutMode = useStore((s) => s.setLayoutMode);

  const handleDisconnect = () => {
    Alert.alert(
      "Disconnect",
      "Are you sure you want to disconnect from the server?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            haptics.warning();
            disconnect();
            resetSyncState();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.container}
    >
      <View style={styles.content}>
        {/* Connection Section */}
        <Text style={styles.sectionLabel}>Connection</Text>
        <View style={styles.card}>
          <BlurView intensity={50} tint="dark" style={styles.blur}>
            <View style={styles.cardOverlay}>
              {/* Status row */}
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Status</Text>
                <View style={styles.statusContainer}>
                  <View
                    style={[
                      styles.statusDot,
                      connectionStatus === "connected" && styles.statusConnected,
                      connectionStatus === "connecting" && styles.statusConnecting,
                    ]}
                  />
                  <Text style={styles.rowValue}>
                    {connectionStatus === "connected"
                      ? "Connected"
                      : connectionStatus === "connecting"
                        ? "Connecting..."
                        : "Disconnected"}
                  </Text>
                </View>
              </View>

              {/* Server row */}
              {serverUrl && (
                <View style={[styles.row, styles.rowBorder]}>
                  <Text style={styles.rowLabel}>Server</Text>
                  <Text style={styles.rowValueSmall} numberOfLines={1}>
                    {serverUrl}
                  </Text>
                </View>
              )}

              {/* Disconnect button */}
              {connectionStatus === "connected" && (
                <Pressable
                  onPress={handleDisconnect}
                  style={({ pressed }) => [
                    styles.disconnectButton,
                    pressed && styles.disconnectButtonPressed,
                  ]}
                >
                  <Text style={styles.disconnectText}>Disconnect</Text>
                </Pressable>
              )}
            </View>
          </BlurView>
        </View>

        {/* Display Section */}
        <Text style={styles.sectionLabel}>Display</Text>
        <View style={styles.card}>
          <BlurView intensity={50} tint="dark" style={styles.blur}>
            <View style={styles.cardOverlay}>
              {/* Card Stack option */}
              <Pressable
                onPress={() => {
                  haptics.selection();
                  setLayoutMode("cards");
                }}
                style={({ pressed }) => [
                  styles.optionRow,
                  pressed && styles.optionPressed,
                ]}
              >
                <View style={styles.optionIcon}>
                  <Icon name="square.stack" color={colors.accent.lime} size={18} />
                </View>
                <Text style={styles.optionLabel}>Card Stack</Text>
                {layoutMode === "cards" && (
                  <Icon name="checkmark" color={colors.accent.lime} size={18} />
                )}
              </Pressable>

              {/* List View option */}
              <Pressable
                onPress={() => {
                  haptics.selection();
                  setLayoutMode("list");
                }}
                style={({ pressed }) => [
                  styles.optionRow,
                  styles.optionRowLast,
                  pressed && styles.optionPressed,
                ]}
              >
                <View style={styles.optionIcon}>
                  <Icon name="list.bullet" color={colors.accent.lime} size={18} />
                </View>
                <Text style={styles.optionLabel}>List View</Text>
                {layoutMode === "list" && (
                  <Icon name="checkmark" color={colors.accent.lime} size={18} />
                )}
              </Pressable>
            </View>
          </BlurView>
        </View>

        {/* About Section */}
        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.card}>
          <BlurView intensity={50} tint="dark" style={styles.blur}>
            <View style={styles.cardOverlay}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>Version</Text>
                <Text style={styles.rowValue}>1.0.0</Text>
              </View>
              <View style={[styles.row, styles.rowBorder, styles.rowLast]}>
                <Text style={styles.rowLabel}>Compare</Text>
                <Text style={styles.rowValue}>Mobile Companion</Text>
              </View>
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
    marginTop: spacing.lg,
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
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  rowBorder: {
    borderTopWidth: 0.5,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowLabel: {
    flex: 1,
    fontSize: typography.fontSize.lg,
    color: colors.text.primary,
  },
  rowValue: {
    fontSize: typography.fontSize.lg,
    color: colors.text.muted,
  },
  rowValueSmall: {
    fontSize: typography.fontSize.base,
    color: colors.text.muted,
    maxWidth: "50%",
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.text.faint,
    marginRight: spacing.sm,
  },
  statusConnected: {
    backgroundColor: colors.success,
  },
  statusConnecting: {
    backgroundColor: colors.warning,
  },
  disconnectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    borderTopWidth: 0.5,
    borderTopColor: "rgba(255, 255, 255, 0.08)",
  },
  disconnectButtonPressed: {
    backgroundColor: "rgba(244, 63, 94, 0.15)",
  },
  disconnectText: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.medium,
    color: colors.error,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255, 255, 255, 0.08)",
  },
  optionRowLast: {
    borderBottomWidth: 0,
  },
  optionPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  optionIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.md,
  },
  optionLabel: {
    flex: 1,
    fontSize: typography.fontSize.lg,
    color: colors.text.primary,
  },
});
