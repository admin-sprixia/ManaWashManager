import { describe, expect, it } from 'vitest';
import { ALL_BRANCH_SERVICES as ALL, branchServicesOf, branchServicesProblem, liveBranchServices, offerWithin } from '..';

const s = (hub: boolean, community: boolean, doorstep: boolean) => ({ hub, community, doorstep });

describe('branch services', () => {
  it('needs the hub or communities, and communities for doorstep', () => {
    expect(branchServicesProblem(ALL)).toBeNull();
    expect(branchServicesProblem(s(true, false, false))).toBeNull();
    expect(branchServicesProblem(s(false, true, true))).toBeNull();
    expect(branchServicesProblem(s(false, false, false))).toMatch(/hub or communities/);
    expect(branchServicesProblem(s(true, false, true))).toMatch(/community team/);
  });

  it('runs what head office allows and the owner switched on', () => {
    expect(liveBranchServices(ALL, ALL)).toEqual(ALL);
    expect(liveBranchServices(s(true, true, false), ALL)).toEqual(s(true, true, false));
    expect(liveBranchServices(ALL, s(true, false, false))).toEqual(s(true, false, false));
    // Doorstep rides on the community team.
    expect(liveBranchServices(s(true, false, true), ALL)).toEqual(s(true, false, false));
    expect(liveBranchServices(ALL, s(true, false, true))).toEqual(s(true, false, false));
  });

  it('keeps the owner inside the agreement when head office changes it', () => {
    expect(offerWithin(s(true, true, false), ALL)).toEqual(s(true, true, false));
    expect(offerWithin(s(true, false, false), s(false, true, true))).toEqual(s(true, false, false));
    expect(offerWithin(s(false, true, true), s(true, false, false))).toEqual(s(false, true, false));
    expect(offerWithin(ALL, s(false, false, true))).toEqual(s(true, false, false));
  });

  it('reads a shop row', () => {
    const row = { allowHub: true, allowCommunity: true, allowDoorstep: false, offerHub: true, offerCommunity: true, offerDoorstep: true };
    expect(branchServicesOf(row).live).toEqual(s(true, true, false));
  });
});
