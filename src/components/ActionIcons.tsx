import { colors } from '../theme/colors';
import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
}

export function ExportIcon({ size = 20, color = colors.primary }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="14" width="18" height="8" rx="2" stroke={color} strokeWidth="1.5" />
      <Path d="M12 3v10M8 7l4-4 4 4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CopyIcon({ size = 20, color = '#FFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="8" y="2" width="13" height="17" rx="2" stroke={color} strokeWidth="1.5" />
      <Path d="M3 5v15a2 2 0 0 0 2 2h11" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function DeleteIcon({ size = 20, color = '#FFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10 11v6M14 11v6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}
