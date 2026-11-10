import { memo } from "react";
import Svg, { Path } from "react-native-svg";

import { ICON_PATHS, type IconName } from "@/constants/icons";
import { colors } from "@/constants/theme";

export type { IconName };

type IconProps = {
  name: IconName;
  /** Rendered width and height. The 2px stroke scales with it, as in Figma. */
  size?: number;
  color?: string;
  accessibilityLabel?: string;
};

/** Draws one icon from the Figma "Icons" frame, by its Figma name (Icon/<name>). */
export const Icon = memo(function Icon({ name, size = 24, color = colors.text, accessibilityLabel }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      // Decorative unless labelled, so screen readers skip it.
      aria-label={accessibilityLabel}
      aria-hidden={!accessibilityLabel}
    >
      {ICON_PATHS[name].map((d) => (
        <Path key={d} d={d} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
});
