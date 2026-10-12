import type { NavigatorScreenParams } from '@react-navigation/native';
import type { JoinResult, ServiceRequest } from '../api/types';
import type { Coordinates } from '../utils/location';

/** Joining a place: from the nearby list (with where the phone is), a QR code or a link. */
export type JoinPlaceParams = { placeId: string; location?: Coordinates | null } | { code: string };

/** The join screens, the same in both navigators. */
type JoinParams = {
  FindPlace: undefined;
  JoinPlace: JoinPlaceParams;
};

/** A number that isn't a customer yet. */
export type RequestStackParams = JoinParams & {
  RequestHome: undefined;
  /** `from`: the open request being changed, to start from its answers. */
  RequestForm: { from?: ServiceRequest } | undefined;
};

export type TabParams = {
  Home: undefined;
  Washes: undefined;
  Vehicles: undefined;
  Visit: undefined;
  Profile: undefined;
};

/** A signed-in customer. */
export type MainStackParams = JoinParams & {
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  WashDetail: { id: string };
  Photo: { photoIds: string[]; index: number };
  /** `washId`: about that wash; otherwise about the branch in general. */
  ReportProblem: { washId?: string; label?: string } | undefined;
  Help: undefined;
  AddVehicle: undefined;
  Refer: undefined;
  JoinResult: { result: JoinResult; placeLabel: string };
  MyPlace: { memberId: string };
  Plan: { orderId: string };
  /** `url`: the checkout, to open again; absent when the app was opened from the payment link. */
  Payment: { paymentId: string; url?: string };
  Receipt: { paymentId: string };
};

/** For the join screens, which sit in both navigators (they check `useJoinMode` before going elsewhere). */
export type JoinStackParams = RequestStackParams & MainStackParams;
