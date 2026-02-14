import Stack from "expo-router/stack";

export default function TabsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#1c1917" },
        headerTintColor: "#fafaf9",
      }}
    >
      <Stack.Screen
        name="(reviews)"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="(settings)"
        options={{
          headerShown: false,
        }}
      />
    </Stack>
  );
}
