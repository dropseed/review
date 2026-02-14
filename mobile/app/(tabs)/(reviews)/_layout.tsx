import Stack from "expo-router/stack";
import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";

function SettingsButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push("/settings")}
      hitSlop={8}
      style={styles.settingsButton}
    >
      <SymbolView name="gearshape" size={22} tintColor="#78716c" />
    </Pressable>
  );
}

export default function ReviewsStack() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#1c1917" },
        headerTintColor: "#fafaf9",
        headerTitleStyle: { color: "#fafaf9" },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Reviews",
          headerRight: () => <SettingsButton />,
        }}
      />
    </Stack>
  );
}

const styles = StyleSheet.create({
  settingsButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
