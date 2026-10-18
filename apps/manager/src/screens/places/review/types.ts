import type React from 'react';
import type { ApiResponse } from '../../../api/client';
import type { PlaceDetail, PlaceListItem, PlaceMember, StaffMenu, TeamUser } from '../shared';
import type { WashSettings } from './useWashSettings';

/** Everything a review tab can read. */
export interface ReviewContext {
  place: PlaceDetail['place'];
  placeId: string;
  settings: WashSettings;
  users: TeamUser[];
  teamError: string | null;
  /** The branch's other communities, to spot a washer booked in two places at once. */
  others: PlaceListItem[];
  /** The flats (or houses) members pick from. */
  units: PlaceDetail['units'];
  /** The plans and one-off washes residents can buy here, with this branch's prices. */
  menu: StaffMenu['menu'] | null;
  menuError: string | null;
  /** Who has joined: their flat, vehicles and plans (none yet on a review). */
  members: PlaceMember[];
  /** Sends a change to the community and reloads it; resolves with an error message or null. */
  run: (call: () => Promise<ApiResponse>, done?: string) => Promise<string | null>;
}

export type TabState = 'done' | 'attention' | 'needed' | 'optional';

/**
 * One tab on the review / wash settings screen. A new part of the screen is one of these in its
 * own file, added to the list in PlaceFormScreen.
 */
export interface ReviewTab {
  key: string;
  /** Short, for the tab bar. */
  label: string;
  /** Heading inside the tab. */
  title: string;
  icon: (color: string) => React.ReactNode;
  show: (c: ReviewContext) => boolean;
  state: (c: ReviewContext) => TabState;
  /** What's chosen now, in one line. */
  summary: (c: ReviewContext) => string;
  Body: React.ComponentType<{ ctx: ReviewContext }>;
}
