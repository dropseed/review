import Stack from "expo-router/stack";

export default function SettingsStack() {
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
          title: "Settings",
        }}
      />
    </Stack>
  );
}
