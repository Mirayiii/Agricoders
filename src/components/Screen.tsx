import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { AppHeader } from "@/components/AppHeader";
import { colors, spacing } from "@/constants/theme";

type ScreenProps = {
  children: ReactNode;
  title?: string;
  scroll?: boolean;
  keyboardAware?: boolean;
  showBackButton?: boolean;
  backIcon?: "chevron-back" | "close";
  onBackPress?: () => void;
  headerRight?: ReactNode;
  // Rendered below the header, outside the scroll area (e.g. wizard progress).
  subHeader?: ReactNode;
  // Sticky action bar pinned to the bottom of stack screens.
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  refreshing?: boolean;
  onRefresh?: () => void;
};

export function Screen({
  children,
  title,
  scroll = true,
  keyboardAware = false,
  showBackButton = false,
  backIcon,
  onBackPress,
  headerRight,
  subHeader,
  footer,
  contentStyle,
  refreshing = false,
  onRefresh,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.fill}>{children}</View>
  );

  const body = (
    <>
      {content}
      {footer ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.md }]}>{footer}</View> : null}
    </>
  );

  return (
    <View style={styles.screen}>
      <AppHeader
        title={title}
        showBackButton={showBackButton}
        backIcon={backIcon}
        onBackPress={onBackPress ?? (() => router.back())}
        rightAction={headerRight}
      />
      {subHeader}
      {keyboardAware ? (
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    flexGrow: 1,
  },
  footer: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
});
