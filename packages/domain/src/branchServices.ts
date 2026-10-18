/**
 * What a branch offers: washes at its hub, at communities (the team on fixed wash days) and at
 * customers' doors (the same team, one home at a time). Head office decides what the branch's
 * agreement allows; within that the owner switches on what it runs now. A service runs when
 * both say yes — doorstep washes also need the community team.
 */

/** How far a branch's community team goes when it's first made, in km. */
export const COMMUNITY_TEAM_RADIUS_KM = 10;

export type BranchServiceKey = 'hub' | 'community' | 'doorstep';

export const BRANCH_SERVICE_KEYS: readonly BranchServiceKey[] = ['hub', 'community', 'doorstep'];

export type BranchServices = Record<BranchServiceKey, boolean>;

export const ALL_BRANCH_SERVICES: BranchServices = { hub: true, community: true, doorstep: true };

export const BRANCH_SERVICE_LABEL: Readonly<Record<BranchServiceKey, string>> = {
  hub: 'Hub',
  community: 'Community',
  doorstep: 'Doorstep',
};

/** Why a set of services can't be a branch's (null when it can). */
export function branchServicesProblem(s: BranchServices): string | null {
  if (!s.hub && !s.community) return 'A branch needs the hub or communities. Keep one on.';
  if (s.doorstep && !s.community) return 'Doorstep washes are done by the community team, so Community must be on too.';
  return null;
}

/** What runs: allowed by head office and switched on by the owner (doorstep only with the team). */
export function liveBranchServices(allowed: BranchServices, offered: BranchServices): BranchServices {
  const community = allowed.community && offered.community;
  return { hub: allowed.hub && offered.hub, community, doorstep: community && allowed.doorstep && offered.doorstep };
}

/**
 * The owner's switches after head office changes what's allowed: nothing outside the agreement,
 * and never a branch with neither the hub nor the community team running — then whatever the
 * agreement allows of those two comes on.
 */
export function offerWithin(allowed: BranchServices, offered: BranchServices): BranchServices {
  const next: BranchServices = {
    hub: allowed.hub && offered.hub,
    community: allowed.community && offered.community,
    doorstep: allowed.doorstep && offered.doorstep,
  };
  if (!next.hub && !next.community) {
    next.hub = allowed.hub;
    next.community = !allowed.hub && allowed.community;
  }
  if (!next.community) next.doorstep = false;
  return next;
}

/** The owner's switches as stored (offer_*) and head office's (allow_*), from a shop row. */
export function branchServicesOf(shop: {
  allowHub: boolean;
  allowCommunity: boolean;
  allowDoorstep: boolean;
  offerHub: boolean;
  offerCommunity: boolean;
  offerDoorstep: boolean;
}): { allowed: BranchServices; offered: BranchServices; live: BranchServices } {
  const allowed = { hub: shop.allowHub, community: shop.allowCommunity, doorstep: shop.allowDoorstep };
  const offered = { hub: shop.offerHub, community: shop.offerCommunity, doorstep: shop.offerDoorstep };
  return { allowed, offered, live: liveBranchServices(allowed, offered) };
}

/** Prisma select for `branchServicesOf`. */
export const BRANCH_SERVICES_SELECT = {
  allowHub: true,
  allowCommunity: true,
  allowDoorstep: true,
  offerHub: true,
  offerCommunity: true,
  offerDoorstep: true,
} as const;
