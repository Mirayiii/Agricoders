import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { createSessionStore, type KeyValueStore } from "./sessionStore";

/**
 * The Supabase session store (D8 and task 0.6): the secure store on phones,
 * the browser's storage on the web, memory only when "Keep me signed in" is
 * off. See sessionStore.ts.
 */
const secure: KeyValueStore | null = Platform.OS === "web"
  ? null
  : {
    getItem: (key) => SecureStore.getItemAsync(key),
    // Readable after the phone is first unlocked, so a token refresh in the background still works; never synced to other devices.
    setItem: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
    removeItem: (key) => SecureStore.deleteItemAsync(key),
  };

export const sessionStorage = createSessionStore({
  secure,
  plain: AsyncStorage,
  // Only the reason is reported; never a key's value.
  onProblem: (reason) => { if (__DEV__) console.warn(`[session] ${reason}`); },
});
