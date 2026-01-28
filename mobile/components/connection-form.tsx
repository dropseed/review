import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  StyleSheet,
} from "react-native";
import { BlurView } from "expo-blur";
import { useStore } from "@/stores";
import { Icon } from "@/components/icon";
import { colors, spacing, radius, typography, shadows } from "@/theme";
import * as haptics from "@/utils/haptics";

export function ConnectionForm() {
  const connectionStatus = useStore((s) => s.connectionStatus);
  const connectionError = useStore((s) => s.connectionError);
  const serverUrl = useStore((s) => s.serverUrl);
  const authToken = useStore((s) => s.authToken);
  const setServerUrl = useStore((s) => s.setServerUrl);
  const setAuthToken = useStore((s) => s.setAuthToken);
  const connect = useStore((s) => s.connect);

  const [localServerUrl, setLocalServerUrl] = useState(serverUrl);
  const [localAuthToken, setLocalAuthToken] = useState(authToken);

  const isConnecting = connectionStatus === "connecting";

  const handleConnect = async () => {
    haptics.mediumImpact();
    await setServerUrl(localServerUrl);
    await setAuthToken(localAuthToken);
    await connect();
  };

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={styles.container}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <BlurView intensity={40} tint="dark" style={styles.iconBlur}>
                <View style={styles.iconOverlay}>
                  <Icon name="link" color={colors.accent.lime} size={40} />
                </View>
              </BlurView>
            </View>

            <Text style={styles.title}>Connect to Desktop</Text>
            <Text style={styles.subtitle}>
              Enter the sync server URL and token from your desktop Compare app
            </Text>
          </View>

          {/* Error message */}
          {connectionError && (
            <View style={styles.errorContainer}>
              <BlurView intensity={30} tint="dark" style={styles.errorBlur}>
                <View style={styles.errorContent}>
                  <Icon
                    name="exclamationmark.triangle.fill"
                    color={colors.error}
                    size={18}
                  />
                  <Text style={styles.errorText}>{connectionError}</Text>
                </View>
              </BlurView>
            </View>
          )}

          {/* Form */}
          <Text style={styles.label}>Server URL</Text>
          <View style={styles.inputContainer}>
            <BlurView intensity={40} tint="dark" style={styles.inputBlur}>
              <View style={styles.inputOverlay}>
                <TextInput
                  value={localServerUrl}
                  onChangeText={setLocalServerUrl}
                  placeholder="http://192.168.1.x:17950"
                  placeholderTextColor={colors.text.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  editable={!isConnecting}
                  style={styles.input}
                />
              </View>
            </BlurView>
          </View>

          <Text style={styles.label}>Auth Token</Text>
          <View style={styles.inputContainer}>
            <BlurView intensity={40} tint="dark" style={styles.inputBlur}>
              <View style={styles.inputOverlay}>
                <TextInput
                  value={localAuthToken}
                  onChangeText={setLocalAuthToken}
                  placeholder="Paste token from desktop app"
                  placeholderTextColor={colors.text.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  editable={!isConnecting}
                  style={styles.input}
                />
              </View>
            </BlurView>
          </View>

          {/* Connect button */}
          <Pressable
            onPress={handleConnect}
            disabled={isConnecting || !localServerUrl || !localAuthToken}
            style={({ pressed }) => [
              styles.button,
              isConnecting || !localServerUrl || !localAuthToken
                ? styles.buttonDisabled
                : pressed
                  ? styles.buttonPressed
                  : styles.buttonActive,
            ]}
          >
            {isConnecting ? (
              <>
                <ActivityIndicator
                  color={colors.stone[950]}
                  style={styles.buttonSpinner}
                />
                <Text style={styles.buttonText}>Connecting...</Text>
              </>
            ) : (
              <Text
                style={[
                  styles.buttonText,
                  (!localServerUrl || !localAuthToken) && styles.buttonTextDisabled,
                ]}
              >
                Connect
              </Text>
            )}
          </Pressable>

          {/* Help text */}
          <View style={styles.helpContainer}>
            <Text style={styles.helpText}>
              Open Compare on your desktop and go to Settings → Mobile Sync to
              find the server URL and generate an auth token.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
  },
  header: {
    alignItems: "center",
    paddingVertical: spacing["4xl"],
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: radius.xl,
    overflow: "hidden",
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    ...shadows.lg,
  },
  iconBlur: {
    flex: 1,
  },
  iconOverlay: {
    flex: 1,
    backgroundColor: "rgba(28, 25, 23, 0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: typography.fontSize["2xl"],
    fontWeight: typography.fontWeight.bold,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: typography.fontSize.base,
    color: colors.text.muted,
    textAlign: "center",
    paddingHorizontal: spacing["2xl"],
    lineHeight: 22,
  },
  errorContainer: {
    borderRadius: radius.md,
    overflow: "hidden",
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.3)",
  },
  errorBlur: {
    flex: 1,
  },
  errorContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: "rgba(244, 63, 94, 0.1)",
  },
  errorText: {
    color: colors.error,
    fontSize: typography.fontSize.sm,
    flex: 1,
  },
  label: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.lg,
  },
  inputContainer: {
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing["2xl"],
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  inputBlur: {
    flex: 1,
  },
  inputOverlay: {
    backgroundColor: "rgba(28, 25, 23, 0.7)",
  },
  input: {
    padding: spacing.lg,
    fontSize: typography.fontSize.lg,
    color: colors.text.primary,
  },
  button: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginTop: spacing.sm,
    ...shadows.md,
  },
  buttonActive: {
    backgroundColor: colors.accent.lime,
  },
  buttonPressed: {
    backgroundColor: colors.accent.emerald,
  },
  buttonDisabled: {
    backgroundColor: colors.stone[700],
  },
  buttonSpinner: {
    marginRight: spacing.sm,
  },
  buttonText: {
    color: colors.stone[950],
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
  },
  buttonTextDisabled: {
    color: colors.text.muted,
  },
  helpContainer: {
    marginTop: spacing["2xl"],
    paddingHorizontal: spacing.lg,
  },
  helpText: {
    fontSize: typography.fontSize.sm,
    color: colors.text.faint,
    textAlign: "center",
    lineHeight: 20,
  },
});
