import React from 'react';
import Svg, { Path } from 'react-native-svg';
import type { ExpenseCategory } from '@mana/domain';

interface Props {
  category: ExpenseCategory;
  size?: number;
  color: string;
}

const STROKE = {
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
};

/** Outline glyphs for expense categories — same stroke language as `Icons.tsx`. */
export function ExpenseCategoryIcon({ category, size = 22, color }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {category === 'chemicals' ? (
        <>
          {/* Spray bottle */}
          <Path d="M9 8h5l1 3v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9l1-3z" stroke={color} {...STROKE} />
          <Path d="M10 8V5h3v3" stroke={color} {...STROKE} />
          <Path d="M13 5h3l2 1.5" stroke={color} {...STROKE} />
          <Path d="M8 14h7" stroke={color} {...STROKE} />
          <Path d="M19.5 9.5h.01M21 7.5h.01M21 11.5h.01" stroke={color} {...STROKE} strokeWidth={2.4} />
        </>
      ) : category === 'labour' ? (
        <>
          {/* Worker: hard hat + shoulders */}
          <Path d="M6.5 11a5.5 5.5 0 0 1 11 0" stroke={color} {...STROKE} />
          <Path d="M5 11h14" stroke={color} {...STROKE} />
          <Path d="M12 5.5V8" stroke={color} {...STROKE} />
          <Path d="M8.5 11.5a3.5 3.5 0 0 0 7 0" stroke={color} {...STROKE} />
          <Path d="M5 21a7 7 0 0 1 14 0" stroke={color} {...STROKE} />
        </>
      ) : category === 'electricity' ? (
        <Path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8z" stroke={color} {...STROKE} />
      ) : category === 'water' ? (
        <>
          <Path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z" stroke={color} {...STROKE} />
          <Path d="M9.2 14.5a2.8 2.8 0 0 0 2.8 2.8" stroke={color} {...STROKE} />
        </>
      ) : category === 'maintenance' ? (
        <Path
          d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.1-3.1a6 6 0 0 1-7.9 7.9l-6.4 6.4a2.1 2.1 0 0 1-3-3l6.4-6.4a6 6 0 0 1 7.9-7.9l-3.1 3.1z"
          stroke={color}
          {...STROKE}
        />
      ) : (
        <>
          {/* Receipt */}
          <Path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21V3z" stroke={color} {...STROKE} />
          <Path d="M9 8h6M9 12h6M9 16h3.5" stroke={color} {...STROKE} />
        </>
      )}
    </Svg>
  );
}