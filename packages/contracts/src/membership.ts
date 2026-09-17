import { createHash } from 'node:crypto';

export interface MembershipSnapshot {
  readonly version: number;
  readonly members: readonly string[];
  readonly hash: string;
}

/**
 * Derives a deterministic SHA-256 hash from canonical representation of (version, sorted(members)).
 * Canonical encoding: UTF-8 string of `{"members":[...sorted],"version":<number>}`
 */
export function computeMembershipHash(version: number, members: readonly string[]): string {
  const sortedMembers = [...members].sort();
  const canonicalString = JSON.stringify({
    members: sortedMembers,
    version
  });
  return createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

/**
 * Creates an immutable MembershipSnapshot with validated sorted members and computed hash.
 */
export function createMembershipSnapshot(version: number, members: readonly string[]): MembershipSnapshot {
  if (version < 1) {
    throw new Error(`Membership version must be >= 1, received: ${version}`);
  }
  if (!members.length) {
    throw new Error('Membership list cannot be empty');
  }

  const sortedMembers = Object.freeze([...new Set(members)].sort());
  const hash = computeMembershipHash(version, sortedMembers);

  return Object.freeze({
    version,
    members: sortedMembers,
    hash
  });
}
