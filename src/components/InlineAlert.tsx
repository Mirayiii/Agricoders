import { StyleSheet, Text, View } from "react-native";

import { colors, radii, text } from "@/constants/theme";

type InlineAlertProps = {
  title: string;
  message?: string;
};

/** Figma "Inline Alert" (danger), for form errors such as a failed sign-in. */
export function InlineAlert({ title, message }: InlineAlertProps) {
  return (
    <View style={styles.alert} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <View style={styles.icon}>
        <Text style={styles.iconText} maxFontSizeMultiplier={1}>!</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  alert: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingTop: 12,
    paddingRight: 14,
    paddingBottom: 12,
    paddingLeft: 12,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
  },
  icon: {
    width: 16,
    height: 16,
    marginTop: 1,
    borderRadius: radii.full,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    ...text.micro,
    color: colors.onBrand,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...text.label,
    color: colors.danger,
  },
  message: {
    ...text.caption,
    color: colors.danger,
  },
});
