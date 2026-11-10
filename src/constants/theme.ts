// Design tokens. Values come from the "MEAH Tokens" variable collection and the
// text and effect styles in the Figma file MEAH (High-Fidelity).

/** Figma variables, by their Figma names. New code should use these. */
export const tokens = {
  brandPrimary: "#166534", // color/brand/primary
  brandPrimaryPressed: "#0F4D27", // color/brand/primary-pressed
  brandTint: "#E7F4EC", // color/brand/tint
  brandTintStrong: "#BBDCC8", // color/brand/tint-strong
  textPrimary: "#14241B", // color/text/primary
  textSecondary: "#5B6B62", // color/text/secondary
  textTertiary: "#8A968E", // color/text/tertiary
  textOnBrand: "#FFFFFF", // color/text/on-brand
  surfacePage: "#F3F7F4", // color/surface/page
  surfaceCard: "#FFFFFF", // color/surface/card
  surfaceMuted: "#E4EBE6", // color/surface/muted
  borderDefault: "#E2EBE4", // color/border/default
  borderStrong: "#C9D6CE", // color/border/strong
  warningBg: "#FEF0C7", // color/status/warning-bg
  warningFg: "#B54708", // color/status/warning-fg
  warningBorder: "#F8D9A0", // color/status/warning-border
  dangerBg: "#FEE4E2", // color/status/danger-bg
  dangerFg: "#B42318", // color/status/danger-fg
  badge: "#D92D20", // color/status/badge
  infoBg: "#D1E9FF", // color/status/info-bg
  infoFg: "#175CD3", // color/status/info-fg
  successBg: "#E7F4EC", // color/status/success-bg
  successFg: "#166534", // color/status/success-fg
  advanceOrderStroke: "#7AB8F5", // color/status/AdvanceOrderStroke
} as const;

/**
 * Older names used across existing screens, now pointing at the Figma values.
 * Kept so current screens keep working while each module moves to the new design.
 */
export const colors = {
  primary: tokens.brandPrimary,
  primaryDark: "#14532D",
  primaryPressed: tokens.brandPrimaryPressed,
  primarySoft: tokens.brandTint,
  primaryMuted: tokens.brandTintStrong,
  background: tokens.surfacePage,
  surface: tokens.surfaceCard,
  surfaceMuted: tokens.surfaceMuted,
  overlay: "rgba(15, 23, 20, 0.45)",
  text: tokens.textPrimary,
  textSecondary: tokens.textSecondary,
  textMuted: tokens.textTertiary,
  onBrand: tokens.textOnBrand,
  border: tokens.borderDefault,
  borderStrong: tokens.borderStrong,
  danger: tokens.dangerFg,
  dangerSoft: tokens.dangerBg,
  warning: tokens.warningFg,
  warningSoft: tokens.warningBg,
  warningBorder: tokens.warningBorder,
  info: tokens.infoFg,
  infoSoft: tokens.infoBg,
  success: tokens.successFg,
  successSoft: tokens.successBg,
  badge: tokens.badge,
  advanceOrderStroke: tokens.advanceOrderStroke,
  tabInactive: tokens.textTertiary,
  surfacePressed: "#F7FBF8",
  track: tokens.borderDefault,
  neutralSoft: tokens.surfaceMuted,
  neutralText: tokens.textSecondary,
  toast: tokens.textPrimary,
  toastIcon: tokens.brandTintStrong,
} as const;

/** Figma space/* variables (xs to 2xl), plus 32 used by a few existing screens. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24, // space/2xl
  xxxl: 32,
} as const;

/** Figma radius/* variables. `pill` is radius/full. */
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 999,
  pill: 999,
} as const;

/** Inter weights loaded in the root layout. Set fontFamily, not fontWeight. */
export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

// Figma letter spacing is a percentage of the font size.
const tracking = (fontSize: number, percent: number) =>
  Math.round(fontSize * percent) / 100;

function textStyle(fontFamily: string, fontSize: number, lineHeight: number, percent = -0.5) {
  return { fontFamily, fontSize, lineHeight, letterSpacing: tracking(fontSize, percent) };
}

/** Figma text styles, by their Figma names. New code should use these. */
export const text = {
  display: textStyle(fonts.bold, 24, 30, -1.5),
  title: textStyle(fonts.bold, 18, 24, -1.5),
  heading: textStyle(fonts.bold, 16, 22),
  bodyStrong: textStyle(fonts.semibold, 15, 20),
  bodyMedium: textStyle(fonts.medium, 15, 20),
  body: textStyle(fonts.regular, 14, 20),
  label: textStyle(fonts.semibold, 14, 18),
  button: textStyle(fonts.semibold, 16, 20),
  caption: textStyle(fonts.regular, 13, 18),
  captionStrong: textStyle(fonts.semibold, 13, 18),
  overline: textStyle(fonts.semibold, 12, 16),
  tab: textStyle(fonts.semibold, 11, 14),
  micro: textStyle(fonts.bold, 10, 12),
} as const;

/**
 * Older type scale used by existing screens. Same sizes as before, now in Inter.
 * Screens move to `text` as each module is redesigned.
 */
export const typography = {
  brand: { fontFamily: fonts.bold, fontSize: 18, letterSpacing: 0.2 },
  display: { fontFamily: fonts.bold, fontSize: 24, letterSpacing: -0.3 },
  stat: { fontFamily: fonts.bold, fontSize: 26, lineHeight: 29 },
  title: { fontFamily: fonts.bold, fontSize: 22 },
  headline: { fontFamily: fonts.bold, fontSize: 20 },
  section: { fontFamily: fonts.bold, fontSize: 16 },
  body: { fontFamily: fonts.regular, fontSize: 15 },
  bodyMedium: { fontFamily: fonts.semibold, fontSize: 15 },
  caption: { fontFamily: fonts.regular, fontSize: 13 },
  captionMedium: { fontFamily: fonts.semibold, fontSize: 12 },
  label: { fontFamily: fonts.semibold, fontSize: 11 },
  button: { fontFamily: fonts.bold, fontSize: 15 },
} as const;

export const touch = {
  minHeight: 48,
  icon: 44,
} as const;

/** Figma effect styles. */
export const shadows = {
  // Elevation/Card: #14241A at 5%, y 1, blur 3
  card: {
    shadowColor: "#14241A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  // Elevation/Raised: #14241A at 14%, y 6, blur 16 (toasts)
  raised: {
    shadowColor: "#14241A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;

export const theme = {
  tokens,
  colors,
  spacing,
  radii,
  fonts,
  text,
  typography,
  touch,
  shadows,
} as const;

export type Theme = typeof theme;
