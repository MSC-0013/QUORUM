import { describe, it, expect } from 'vitest';
import {
  computeMembershipHash,
  createMembershipSnapshot,
  isValidLifecycleTransition,
  assertValidLifecycleTransition
} from '../src/index.js';

describe('Contracts: Membership Snapshot', () => {
  it('computes deterministic SHA-256 hash regardless of member ordering', () => {
    const members1 = ['node-c', 'node-a', 'node-b'];
    const members2 = ['node-a', 'node-b', 'node-c'];
    const members3 = ['node-b', 'node-c', 'node-a'];

    const hash1 = computeMembershipHash(1, members1);
    const hash2 = computeMembershipHash(1, members2);
    const hash3 = computeMembershipHash(1, members3);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
    expect(hash1).toHaveLength(64); // SHA-256 hex string
  });

  it('produces different hash when version changes', () => {
    const members = ['node-a', 'node-b'];
    const hashV1 = computeMembershipHash(1, members);
    const hashV2 = computeMembershipHash(2, members);

    expect(hashV1).not.toBe(hashV2);
  });

  it('creates immutable MembershipSnapshot with sorted members', () => {
    const snapshot = createMembershipSnapshot(1, ['node-z', 'node-m', 'node-a']);
    expect(snapshot.version).toBe(1);
    expect(snapshot.members).toEqual(['node-a', 'node-m', 'node-z']);
    expect(snapshot.hash).toBe(computeMembershipHash(1, ['node-a', 'node-m', 'node-z']));
  });

  it('throws on invalid version or empty members', () => {
    expect(() => createMembershipSnapshot(0, ['node-a'])).toThrow('Membership version must be >= 1');
    expect(() => createMembershipSnapshot(1, [])).toThrow('Membership list cannot be empty');
  });
});

describe('Contracts: Lifecycle Transitions', () => {
  it('permits valid transitions from STARTING to HEALTHY', () => {
    expect(isValidLifecycleTransition('STARTING', 'BOOTSTRAPPING')).toBe(true);
    expect(isValidLifecycleTransition('BOOTSTRAPPING', 'READY')).toBe(true);
    expect(isValidLifecycleTransition('READY', 'HEALTHY')).toBe(true);
  });

  it('rejects illegal jumps', () => {
    expect(isValidLifecycleTransition('STARTING', 'HEALTHY')).toBe(false);
    expect(isValidLifecycleTransition('TERMINATED', 'STARTING')).toBe(false);
    expect(() => assertValidLifecycleTransition('STARTING', 'HEALTHY')).toThrow(
      'Invalid node lifecycle transition from STARTING to HEALTHY'
    );
  });
});
