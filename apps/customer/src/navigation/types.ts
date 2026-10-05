import type { NavigatorScreenParams } from '@react-navigation/native';
import type { ServiceRequest } from '../api/types';

/** A number that isn't a customer yet. */
export type RequestStackParams = {
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
export type MainStackParams = {
  Tabs: NavigatorScreenParams<TabParams> | undefined;
  WashDetail: { id: string };
  Photo: { photoIds: string[]; index: number };
  /** `washId`: about that wash; otherwise about the branch in general. */
  ReportProblem: { washId?: string; label?: string } | undefined;
  Help: undefined;
  AddVehicle: undefined;
  Refer: undefined;
};
