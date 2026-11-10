import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

import { sessionStorage } from "./sessionStorage";
import { isSupabaseConfig } from "./supabaseConfig";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

export const isSupabaseConfigured = isSupabaseConfig(supabaseUrl, supabasePublishableKey);

/**
 * Browser-safe Supabase client. Uses the publishable key only.
 * Authorization is enforced by Row Level Security in Supabase.
 */
export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : "https://placeholder.supabase.co",
  isSupabaseConfigured ? supabasePublishableKey : "public-anon-placeholder-key",
  {
    auth: {
      // Saved to the device or kept in memory, per "Keep me signed in" (D8).
      storage: sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (nextState) => {
    if (nextState === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
