import Svg, { Path } from "react-native-svg";

/** Figma "LOGO": the MEAH sun over green fields, drawn from the Figma vectors. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none" accessibilityLabel="MEAH" accessibilityRole="image">
      <Path d="M20 39.5C30.7696 39.5 39.5 30.7696 39.5 20C39.5 9.23045 30.7696 0.5 20 0.5C9.23045 0.5 0.5 9.23045 0.5 20C0.5 30.7696 9.23045 39.5 20 39.5Z" fill="#FFFFFF" stroke="#BBDCC8" />
      <Path d="M20 8.5V11.5" stroke="#F5B71A" strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M12 11.7998L14.1 13.8998" stroke="#F5B71A" strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M28 11.7998L25.9 13.8998" stroke="#F5B71A" strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M8.5 19.5H11.5" stroke="#F5B71A" strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M28.5 19.5H31.5" stroke="#F5B71A" strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M13 21.5C13 19.6435 13.7375 17.863 15.0503 16.5503C16.363 15.2375 18.1435 14.5 20 14.5C21.8565 14.5 23.637 15.2375 24.9497 16.5503C26.2625 17.863 27 19.6435 27 21.5H13Z" fill="#F5B71A" />
      <Path d="M8 24.5C13 21.5 20 21.5 32 24.5" stroke="#166534" strokeWidth={2} strokeLinecap="round" />
      <Path d="M9.5 28.2998C14.5 25.2998 20.5 25.2998 30.5 28.2998" stroke="#2E9E55" strokeWidth={2} strokeLinecap="round" />
      <Path d="M13 31.7998C17 29.7998 22 29.7998 27 31.7998" stroke="#166534" strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
