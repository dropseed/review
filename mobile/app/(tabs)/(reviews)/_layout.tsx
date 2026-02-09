import Stack from "expo-router/stack";

export default function ReviewsStack() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: "Reviews",
          headerLargeTitle: true,
          headerTransparent: true,
          headerBlurEffect: "systemChromeMaterial",
          headerLargeTitleShadowVisible: false,
        }}
      />
    </Stack>
  );
}
