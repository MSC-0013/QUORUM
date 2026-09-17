import { VersionStamp } from './versionStamp.js';
import { KeyState } from './keyState.js';

/**
 * A pure projection of KeyState.entries, representing the current set of maximal versions.
 * Invariant: maximalVersions = entries.map(e => e.version)
 */
export interface VersionFrontier {
  readonly maximalVersions: readonly VersionStamp[];
}

/**
 * Derives the VersionFrontier projection from KeyState.
 */
export function toVersionFrontier(keyState: KeyState): VersionFrontier {
  return Object.freeze({
    maximalVersions: Object.freeze(keyState.entries.map((entry) => entry.version))
  });
}
