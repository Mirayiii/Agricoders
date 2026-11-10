import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii, spacing, text } from "@/constants/theme";
import { useTabBadges } from "@/hooks/useTabBadges";
import { useVisibleTabs } from "@/hooks/useVisibleTabs";
import { Icon, type IconName } from "./Icon";

export type TabBarItem = {
  key: string;
  label: string;
  icon: IconName;
  /** Count shown in the red badge. Hidden on the active tab and when 0. */
  badge?: number;
};

type TabBarProps = {
  items: TabBarItem[];
  activeKey: string;
  onPress: (key: string) => void;
  /** Space below the tabs, normally the bottom safe-area inset. */
  bottomInset?: number;
};

/** Figma "Tab Bar" (Active = Home, Orders, Purchasing, Deliveries, More). */
export function TabBar({ items, activeKey, onPress, bottomInset = spacing.sm }: TabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: bottomInset }]}>
      {items.map((item) => {
        const focused = item.key === activeKey;
        const color = focused ? colors.primary : colors.tabInactive;
        const badge = focused ? 0 : (item.badge ?? 0);

        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={badge ? `${item.label}, ${badge} waiting` : item.label}
            onPress={() => onPress(item.key)}
            style={[styles.tab, focused && styles.tabActive]}
          >
            <View style={styles.iconBox}>
              <Icon name={item.icon} size={22} color={color} />
              {badge > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText} maxFontSizeMultiplier={1.3}>{badge > 99 ? "99+" : badge}</Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[styles.label, { color }]}
              // Grows with the system text size up to 1.3x, then shrinks to fit the tab
              // instead of being cut off with "…".
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type BottomNavigationProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/** Connects the Figma tab bar to the Expo Router tabs navigator. */
export function BottomNavigation({ state, emitter, navigateToTab }: BottomNavigationProps) {
  const insets = useSafeAreaInsets();
  const visibleTabs = useVisibleTabs();
  const badges = useTabBadges(visibleTabs.map((tab) => tab.key), state.index);
  const activeRoute = state.routes[state.index];

  const items: TabBarItem[] = state.routes.flatMap((route) => {
    const tab = visibleTabs.find((item) => item.key === route.name);
    return tab ? [{ key: route.key, label: tab.label, icon: tab.icon, badge: badges[tab.key] ?? 0 }] : [];
  });

  const onPress = (routeKey: string) => {
    const route = state.routes.find((item) => item.key === routeKey);
    if (!route) return;
    const focused = route.key === activeRoute?.key;
    const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigateToTab(route.key);
  };

  return (
    <TabBar
      items={items}
      activeKey={activeRoute?.key ?? ""}
      onPress={onPress}
      bottomInset={Math.max(insets.bottom, spacing.sm)}
    />
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    gap: 4,
    paddingTop: 8,
    paddingHorizontal: 8,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 55,
    alignItems: "center",
    gap: 4,
    paddingTop: 7,
    paddingBottom: 6,
    borderRadius: radii.md,
  },
  tabActive: {
    backgroundColor: colors.primarySoft,
  },
  iconBox: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    left: 14,
    top: -5,
    minWidth: 16,
    minHeight: 16,
    paddingHorizontal: 5,
    borderRadius: radii.full,
    borderWidth: 1.5,
    borderColor: colors.surface,
    backgroundColor: colors.badge,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    ...text.micro,
    color: colors.onBrand,
  },
  label: {
    ...text.tab,
  },
});
