import type { InferResponseType } from 'hono/client';
import type { api } from '../../api/client';

export type BranchSheet = InferResponseType<(typeof api)['services']['branch-prices']['$get'], 200>;
export type SheetService = BranchSheet['services'][number];
export type SheetCell = SheetService['cells'][number];
export type SheetPolicy = BranchSheet['policy'];
export type SheetGroup = BranchSheet['groups'][number];
