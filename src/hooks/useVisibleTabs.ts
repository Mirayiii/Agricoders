import { isTabVisible, MAIN_TABS } from "@/constants/navigation";
import { useAuth } from "@/features/auth/useAuth";

export function useVisibleTabs() {
  const { profile } = useAuth();
  const role = profile?.role ?? null;
  return MAIN_TABS.filter((tab) => isTabVisible(tab, role));
}
