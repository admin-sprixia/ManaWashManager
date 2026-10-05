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
