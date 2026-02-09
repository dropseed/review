import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useConnectionStore } from "../stores/connection";

export default function ConnectScreen() {
  const { connect, isLoading, error, serverInfo } = useConnectionStore();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [success, setSuccess] = useState(false);

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={process.env.EXPO_OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>{"</>"}</Text>
          </View>
          <Text style={styles.title}>Review</Text>
          <Text style={styles.subtitle}>Connect to your desktop app</Text>

          <View style={styles.form}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              style={styles.input}
              placeholder="http://macbook.local:3333"
              placeholderTextColor="#8e8e93"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="next"
            />

            <Text style={styles.label}>Auth Token</Text>
            <TextInput
              style={styles.input}
              placeholder="Paste token from desktop app"
              placeholderTextColor="#8e8e93"
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={handleConnect}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {success && serverInfo ? (
              <View style={styles.successContainer}>
                <Text style={styles.successText}>
                  Connected to {serverInfo.hostname}
                </Text>
                <Text style={styles.successDetail}>
                  v{serverInfo.version} -- {serverInfo.repos.length} repo
                  {serverInfo.repos.length !== 1 ? "s" : ""}
                </Text>
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                (!url.trim() || !token.trim() || isLoading) &&
                  styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleConnect}
              disabled={!url.trim() || !token.trim() || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Connect</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f2f2f7",
  },
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  iconContainer: {
    alignSelf: "center",
    width: 72,
    height: 72,
    borderRadius: 18,
    borderCurve: "continuous",
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  icon: {
    fontSize: 28,
    fontWeight: "700",
    color: "#fff",
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 4,
    color: "#000",
  },
  subtitle: {
    fontSize: 17,
    color: "#8e8e93",
    textAlign: "center",
    marginBottom: 40,
  },
  form: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#3c3c43",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 8,
    marginLeft: 4,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#c6c6c8",
    borderRadius: 10,
    borderCurve: "continuous",
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    backgroundColor: "#fff",
    color: "#000",
  },
  error: {
    color: "#ff3b30",
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
  },
  successContainer: {
    backgroundColor: "#f0fdf4",
    borderRadius: 10,
    borderCurve: "continuous",
    padding: 12,
    alignItems: "center",
    marginTop: 8,
  },
  successText: {
    color: "#10b981",
    fontWeight: "600",
    fontSize: 15,
  },
  successDetail: {
    color: "#6b7280",
    fontSize: 13,
    marginTop: 2,
  },
  button: {
    backgroundColor: "#007AFF",
    borderRadius: 12,
    borderCurve: "continuous",
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 24,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
});
