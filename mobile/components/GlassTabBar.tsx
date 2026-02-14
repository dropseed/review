import { View, Text, Pressable, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { stone, borderSubtle } from "../lib/colors";

interface GlassTabBarProps {
  tabs: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  badges?: (string | number | undefined)[];
}

const AMBER_500 = "#f59e0b";
const AMBER_BG = "rgba(245, 158, 11, 0.12)";

export function GlassTabBar({
  tabs,
  selectedIndex,
  onSelect,
  badges,
}: GlassTabBarProps) {
  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <BlurView tint="dark" intensity={80} style={styles.pill}>
        <View style={styles.inner}>
          {tabs.map((tab, index) => {
            const isSelected = index === selectedIndex;
            const badge = badges?.[index];

            return (
              <Pressable
                key={tab}
                style={[styles.tab, isSelected && styles.tabSelected]}
                onPress={() => {
                  if (index !== selectedIndex) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onSelect(index);
                  }
                }}
              >
                <Text
                  style={[styles.tabText, isSelected && styles.tabTextSelected]}
                >
                  {tab}
                </Text>
                {badge !== undefined && (
                  <View
                    style={[
                      styles.badge,
                      isSelected && styles.badgeSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        isSelected && styles.badgeTextSelected,
                      ]}
                    >
                      {badge}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
    elevation: 10,
  },
  pill: {
    borderRadius: 25,
    borderCurve: "continuous",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: borderSubtle,
  },
  inner: {
    flexDirection: "row",
    backgroundColor: "rgba(28, 25, 23, 0.6)",
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 2,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 21,
    borderCurve: "continuous",
    gap: 6,
  },
  tabSelected: {
    backgroundColor: AMBER_BG,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: stone[400],
  },
  tabTextSelected: {
    color: AMBER_500,
  },
  badge: {
    backgroundColor: "rgba(168, 162, 158, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    borderCurve: "continuous",
  },
  badgeSelected: {
    backgroundColor: "rgba(245, 158, 11, 0.2)",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
    color: stone[500],
  },
  badgeTextSelected: {
    color: AMBER_500,
  },
});
