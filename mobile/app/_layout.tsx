import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnectionStore } from "../stores/connection";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

function ConnectionGuard({ children }: { children: React.ReactNode }) {
  const { isConnected, loadSaved } = useConnectionStore();
  const segments = useSegments();
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    loadSaved().finally(() => setIsReady(true));
  }, []);

  useEffect(() => {
    if (!isReady) return;

    const onConnectScreen = segments[0] === "connect";

    if (!isConnected && !onConnectScreen) {
      router.replace("/connect");
    } else if (isConnected && onConnectScreen) {
      router.replace("/");
    }
  }, [isConnected, segments, isReady]);

  if (!isReady) return null;

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <View style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ConnectionGuard>
          <Stack
            screenOptions={{
              headerShown: false,
              ...(process.env.EXPO_OS === "ios" && {
                headerTransparent: true,
                headerBlurEffect: "systemChromeMaterial",
                headerLargeTitleShadowVisible: false,
              }),
            }}
          >
            <Stack.Screen
              name="connect"
              options={{
                headerShown: false,
                presentation: "fullScreenModal",
              }}
            />
            <Stack.Screen
              name="(tabs)"
              options={{ headerShown: false, headerBackTitle: "" }}
            />
            <Stack.Screen
              name="review/[key]"
              options={{
                headerShown: true,
                title: "Review",
                headerBackTitle: "",
              }}
            />
            <Stack.Screen
              name="review/file/[...path]"
              options={{
                headerShown: true,
                title: "File",
                headerBackTitle: "",
              }}
            />
          </Stack>
        </ConnectionGuard>
      </QueryClientProvider>
    </View>
  );
}
