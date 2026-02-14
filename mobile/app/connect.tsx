import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  ActivityIndicator,
  Animated,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useConnectionStore } from "../stores/connection";

// Desktop palette
const stone = {
  950: "#0c0a09",
  900: "#1c1917",
  800: "#292524",
  700: "#44403c",
  600: "#57534e",
  500: "#78716c",
  400: "#a8a29e",
  300: "#d6d3d1",
  200: "#e7e5e3",
  50: "#fafaf9",
};
const amber = {
  500: "#d9923a",
  600: "#b8792e",
};
const sage = {
  400: "#7aad8a",
  900: "#1a2e20",
};

export default function ConnectScreen() {
  const { connect, isLoading, error, serverInfo } = useConnectionStore();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [success, setSuccess] = useState(false);
  const tokenRef = useRef<TextInput>(null);

  // Subtle fade-in animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useState(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  });

  const handleConnect = async () => {
    if (!url.trim() || !token.trim()) return;
    setSuccess(false);
    try {
      await connect(url.trim(), token.trim());
      setSuccess(true);
    } catch {
      // Error is set in the store
    }
  };

  const canSubmit = url.trim() && token.trim() && !isLoading;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"}
        >
          <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
            {/* Brand mark */}
            <View style={styles.brandSection}>
              <Image
                source={require("../assets/icon.png")}
                style={styles.appIcon}
              />
              <Text style={styles.title}>Review</Text>
              <Text style={styles.subtitle}>
                Connect to your desktop companion
              </Text>
            </View>

            {/* Form */}
            <View style={styles.form}>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Server URL</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.input}
                    placeholder="http://macbook.local:3333"
                    placeholderTextColor={stone[600]}
                    value={url}
                    onChangeText={setUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="next"
                    onSubmitEditing={() => tokenRef.current?.focus()}
                    selectionColor={amber[500]}
                  />
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Auth Token</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    ref={tokenRef}
                    style={styles.input}
                    placeholder="Paste token from desktop app"
                    placeholderTextColor={stone[600]}
                    value={token}
                    onChangeText={setToken}
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                    returnKeyType="go"
                    onSubmitEditing={handleConnect}
                    selectionColor={amber[500]}
                  />
                </View>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              {success && serverInfo ? (
                <View style={styles.successContainer}>
                  <View style={styles.successDot} />
                  <View style={styles.successTextGroup}>
                    <Text style={styles.successText}>
                      Connected to {serverInfo.hostname}
                    </Text>
                    <Text style={styles.successDetail}>
                      v{serverInfo.version} · {serverInfo.repos.length} repo
                      {serverInfo.repos.length !== 1 ? "s" : ""}
                    </Text>
                  </View>
                </View>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  !canSubmit && styles.buttonDisabled,
                  pressed && canSubmit && styles.buttonPressed,
                ]}
                onPress={handleConnect}
                disabled={!canSubmit}
              >
                {isLoading ? (
                  <ActivityIndicator color={stone[900]} size="small" />
                ) : (
                  <Text style={styles.buttonText}>Connect</Text>
                )}
              </Pressable>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: stone[950],
  },
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
  },

  // Brand
  brandSection: {
    alignItems: "center",
    marginBottom: 48,
  },
  appIcon: {
    width: 64,
    height: 64,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    color: stone[50],
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: stone[500],
    letterSpacing: 0.1,
  },

  // Form
  form: {
    gap: 16,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: "500",
    color: stone[500],
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginLeft: 2,
  },
  inputWrapper: {
    borderWidth: 1,
    borderColor: "rgba(168, 162, 158, 0.2)",
    borderRadius: 10,
    borderCurve: "continuous",
    backgroundColor: stone[900],
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: stone[50],
  },

  // Feedback
  error: {
    color: "#d45a52",
    fontSize: 13,
    textAlign: "center",
  },
  successContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: sage[900],
    borderWidth: 1,
    borderColor: "rgba(122, 173, 138, 0.2)",
    borderRadius: 10,
    borderCurve: "continuous",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  successDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: sage[400],
  },
  successTextGroup: {
    flex: 1,
  },
  successText: {
    color: sage[400],
    fontWeight: "600",
    fontSize: 14,
  },
  successDetail: {
    color: stone[500],
    fontSize: 12,
    marginTop: 1,
  },

  // Button
  button: {
    backgroundColor: amber[500],
    borderRadius: 10,
    borderCurve: "continuous",
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    backgroundColor: amber[600],
  },
  buttonText: {
    color: stone[950],
    fontSize: 16,
    fontWeight: "600",
  },
});
