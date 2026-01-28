import { StyleSheet, View, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { colors, radius } from "@/theme";

interface GlassViewProps {
  children: React.ReactNode;
  intensity?: number;
  style?: ViewStyle;
  tint?: "light" | "dark" | "default";
  borderRadius?: number;
}

/**
 * A liquid glass container with blur effect
 * Uses Apple's glass material aesthetic
 */
export function GlassView({
  children,
  intensity = 40,
  style,
  tint = "dark",
  borderRadius = radius.lg,
}: GlassViewProps) {
  return (
    <View
      style={[
        styles.container,
        { borderRadius },
        style,
      ]}
    >
      <BlurView
        intensity={intensity}
        tint={tint}
        style={[styles.blur, { borderRadius }]}
      >
        <View style={[styles.overlay, { borderRadius }]}>
          {children}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  blur: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(28, 25, 23, 0.6)", // Semi-transparent stone-900
  },
});
