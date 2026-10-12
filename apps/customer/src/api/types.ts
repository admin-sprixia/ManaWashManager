import type { InferResponseType } from 'hono/client';
import type { api } from './client';

/** Shapes the app shows, read straight off the API's route types so they can't drift. */

type Ok<T> = Exclude<T, { error: unknown } | { success: false }>;

export type VerifyResult = Ok<InferResponseType<typeof api.auth.verify.$post, 200>>;
export type ServiceRequest = Ok<InferResponseType<(typeof api)['service-requests']['mine']['$post'], 200>>['requests'][number];
export type ServiceArea = InferResponseType<(typeof api)['service-areas']['$get'], 200>['areas'][number];
export type StartingPrices = InferResponseType<(typeof api)['prices']['from']['$get'], 200>;
export type AreaCheck = Ok<InferResponseType<(typeof api)['service-area']['check']['$post'], 200>>;
export type Vehicle = InferResponseType<typeof api.vehicles.$get, 200>['vehicles'][number];
export type Wash = InferResponseType<typeof api.washes.$get, 200>['washes'][number];
export type WashDetail = Ok<InferResponseType<(typeof api.washes)[':id']['$get'], 200>>['wash'];
export type VehicleRequest = InferResponseType<typeof api.vehicles.$get, 200>['requests'][number];
export type Branch = InferResponseType<typeof api.branches.$get, 200>['branches'][number];
export type LiveWash = InferResponseType<typeof api.live.$get, 200>['washes'][number];
export type Problem = InferResponseType<typeof api.problems.$get, 200>['problems'][number];
export type Referrals = InferResponseType<typeof api.referrals.$get, 200>;

// Places and plans
export type NearbyPlace = InferResponseType<typeof api.places.near.$get, 200>['places'][number];
export type PlaceInfo = Ok<InferResponseType<(typeof api.places)[':id']['$get'], 200>>;
export type PlaceMenu = PlaceInfo['menu'];
export type MenuPlan = PlaceMenu['plans'][number];
export type MenuService = PlaceMenu['services'][number];
export type MenuVehicleType = PlaceMenu['vehicleTypes'][number];
export type PlaceUnit = PlaceInfo['units'][number];
export type JoinResult = Ok<InferResponseType<(typeof api.places)[':id']['join']['$post'], 201>>;
export type Membership = InferResponseType<typeof api.home.places.$get, 200>['memberships'][number];
export type PlaceOrder = Ok<InferResponseType<(typeof api.orders)[':id']['$get'], 200>>['order'];
export type OrderReceipt = Ok<InferResponseType<(typeof api.orders)[':id']['$get'], 200>>['receipts'][number];
export type PaymentState = Ok<InferResponseType<(typeof api.payments)[':id']['$get'], 200>>['payment'];
export type Receipt = Ok<InferResponseType<(typeof api.receipts)[':id']['$get'], 200>>['receipt'];
