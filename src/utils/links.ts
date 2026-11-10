import { Alert, Linking } from "react-native";

async function open(url: string, failure: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert("Unable to open", failure);
  }
}

export function callPhone(phone: string) {
  return open(`tel:${phone.replace(/[^0-9+]/g, "")}`, "This device cannot place calls.");
}

export function openDirections(address: string) {
  return open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, "No maps app is available.");
}
