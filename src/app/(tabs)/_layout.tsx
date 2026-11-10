import { Tabs } from "expo-router";

import { BottomNavigation } from "@/components/BottomNavigation";
import { MAIN_TABS } from "@/constants/navigation";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomNavigation {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
      }}
    >
      {MAIN_TABS.map((tab) => (
        <Tabs.Screen
          key={tab.key}
          name={tab.key}
          options={{
            title: tab.label,
          }}
        />
      ))}
    </Tabs>
  );
}
