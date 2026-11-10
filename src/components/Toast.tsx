import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { Icon } from "./Icon";

const TOAST_DURATION_MS = 2600;
// Clears the bottom tab bar so the toast is never hidden behind it.
const TAB_BAR_CLEARANCE = 76;

/** Figma toasts: "Positive Toast" and "False Toast" (error). */
export type ToastTone = "positive" | "error";

export type ToastContent = {
  title: string;
  message?: string;
  tone?: ToastTone;
  /** Right-hand time label. Figma shows "Just now". */
  time?: string;
};

type ShowToast = (content: string | ToastContent) => void;

const ToastContext = createContext<ShowToast | null>(null);

const TONES = {
  positive: { background: colors.primary, icon: "check", iconColor: colors.primary, title: colors.onBrand, detail: colors.primaryMuted },
  error: { background: colors.dangerSoft, icon: "x", iconColor: colors.text, title: colors.danger, detail: colors.danger },
} as const;

/** The toast card on its own, for the toast host and the component preview. */
export function ToastCard({ title, message, tone = "positive", time = "Just now" }: ToastContent) {
  const palette = TONES[tone];
  return (
    <View style={[styles.toast, { backgroundColor: palette.background }]}>
      <View style={styles.iconCircle}>
        <Icon name={palette.icon} size={12} color={palette.iconColor} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: palette.title }]}>{title}</Text>
        {message ? <Text style={[styles.message, { color: palette.detail }]}>{message}</Text> : null}
      </View>
      {time ? <Text style={[styles.time, { color: palette.detail }]}>{time}</Text> : null}
    </View>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ToastContent | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const insets = useSafeAreaInsets();

  const show = useCallback<ShowToast>((next) => {
    clearTimeout(timer.current);
    setContent(typeof next === "string" ? { title: next } : next);
    timer.current = setTimeout(() => setContent(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {content ? (
        <View
          pointerEvents="none"
          style={[styles.host, { bottom: insets.bottom + TAB_BAR_CLEARANCE }]}
          accessibilityLiveRegion="polite"
        >
          <ToastCard {...content} />
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

/** Returns a function that shows a toast: a plain string, or a title, message and tone. */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used within a ToastProvider.");
  return show;
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
  },
  toast: {
    borderRadius: radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    ...shadows.raised,
  },
  iconCircle: {
    width: 24,
    height: 24,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    gap: 1,
  },
  title: {
    ...text.label,
  },
  message: {
    ...text.caption,
  },
  time: {
    ...text.overline,
  },
});
