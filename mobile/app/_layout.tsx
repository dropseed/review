import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Tabs } from "expo-router";
import { Icon } from "@/components/icon";
import { useStore } from "@/stores";
import { colors } from "@/theme";
import "@/utils/storage"; // Initialize localStorage polyfill

export default function RootLayout() {
  const loadSettings = useStore((s) => s.loadSettings);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg.primary }}>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent.lime,
          tabBarInactiveTintColor: colors.text.muted,
        }}
      >
        <Tabs.Screen
          name="(review)"
          options={{
            title: "Review",
            tabBarIcon: ({ color }) => (
              <Icon
                name="doc.text.magnifyingglass"
                size={24}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="(settings)"
          options={{
            title: "Settings",
            tabBarIcon: ({ color }) => (
              <Icon name="gear" size={24} color={color} />
            ),
          }}
        />
      </Tabs>
    </GestureHandlerRootView>
  );
}
