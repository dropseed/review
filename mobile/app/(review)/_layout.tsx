import { Stack } from "expo-router";

export default function ReviewLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Review",
        }}
      />
      <Stack.Screen
        name="[id]"
        options={{
          title: "Review",
        }}
      />
    </Stack>
  );
}
