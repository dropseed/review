import Stack from "expo-router/stack";

export default function SettingsStack() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: "Settings",
          headerLargeTitle: true,
          headerTransparent: true,
          headerBlurEffect: "systemChromeMaterial",
          headerLargeTitleShadowVisible: false,
        }}
      />
    </Stack>
  );
}
