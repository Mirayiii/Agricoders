import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors, fonts } from "@/constants/theme";
import { LoadingState, ToastProvider } from "@/components";
import { AuthProvider, RolePreviewFrame, useAuth } from "@/features/auth";
import { DataProvider } from "@/services/data";

// Keep the splash screen up until Inter has loaded, so no screen flashes the system font.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    [fonts.regular]: Inter_400Regular,
    [fonts.medium]: Inter_500Medium,
    [fonts.semibold]: Inter_600SemiBold,
    [fonts.bold]: Inter_700Bold,
  });
  const fontsReady = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (fontsReady) SplashScreen.hide();
  }, [fontsReady]);

  // If a font fails to load, carry on with the system font rather than blocking the app.
  if (!fontsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <ToastProvider><AuthProvider><DataProvider><RootNavigator /></DataProvider></AuthProvider></ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

type AuthStep = "login" | "set-password" | "welcome" | null;

function RootNavigator() {
  const { initialized, isActive, needsPasswordChange, welcomePending } = useAuth();
  const router = useRouter();
  const segments = useSegments() as string[];
  const inAuthGroup = segments[0] === "(auth)";
  const currentStep = inAuthGroup ? (segments[1] ?? "login") : null;

  // Which sign-in step the person must be on, or null when the app is open.
  const requiredStep: AuthStep = needsPasswordChange ? "set-password" : !isActive ? "login" : welcomePending ? "welcome" : null;
  // Dev-only previews (/dev/...) open without an account; they redirect away in production builds.
  const inDevPreview = __DEV__ && segments[0] === "dev";
  const onRightScreen = inDevPreview || (requiredStep === null ? !inAuthGroup : currentStep === requiredStep);

  useEffect(() => {
    if (!initialized || onRightScreen) return;
    router.replace(requiredStep === null ? "/" : `/${requiredStep}`);
  }, [initialized, onRightScreen, requiredStep, router]);

  if (!initialized || !onRightScreen) {
    return <View style={{ flex: 1, backgroundColor: colors.background }}><LoadingState message="Checking your account..." /></View>;
  }

  return <RolePreviewFrame><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: "slide_from_right" }}>
    <Stack.Screen name="(auth)" />
    <Stack.Screen name="(tabs)" />
    <Stack.Screen name="users" />
    <Stack.Screen name="customers/index" />
    <Stack.Screen name="products/index" />
    <Stack.Screen name="pricing/index" />
    <Stack.Screen name="reports/index" />
    <Stack.Screen name="notifications" />
    <Stack.Screen name="change-password" />
    <Stack.Screen name="inventory/index" />
  </Stack></RolePreviewFrame>;
}
