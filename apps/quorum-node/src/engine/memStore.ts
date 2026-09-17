import {
  KeyState,
  VersionedEntry,
  VersionStamp,
  VersionFrontier,
  applyIncomingEntry,
  createEmptyKeyState,
  toVersionFrontier
} from '@quorum-lab/consistency';

export interface StorageEngineMetrics {
  keyCount: number;
  totalEntriesCount: number;
  tombstoneCount: number;
}

export class MemStore {
  private readonly store = new Map<string, KeyState>();

  /**
   * Retrieves the raw KeyState for a key. Returns an empty KeyState if not found.
   */
  public get(key: string): KeyState {
    return this.store.get(key) ?? createEmptyKeyState(key);
  }

  /**
   * Returns true if key exists and has at least one active (non-tombstone) entry.
   */
  public hasActiveKey(key: string): boolean {
    const state = this.store.get(key);
    if (!state || state.entries.length === 0) return false;
    return state.entries.some((e) => !e.tombstone);
  }

  /**
   * Applies a PUT mutation by appending a new active VersionedEntry to KeyState.entries.
   */
  public put(
    key: string,
    value: Uint8Array,
    version: VersionStamp
  ): { keyState: KeyState; frontier: VersionFrontier } {
    const entry: VersionedEntry = Object.freeze({
      value,
      tombstone: false,
      version
    });

    const updatedState = this.applyEntry(key, entry);
    return {
      keyState: updatedState,
      frontier: toVersionFrontier(updatedState)
    };
  }

  /**
   * Applies a DELETE mutation by appending a tombstone VersionedEntry to KeyState.entries.
   */
  public delete(
    key: string,
    version: VersionStamp
  ): { keyState: KeyState; frontier: VersionFrontier } {
    const entry: VersionedEntry = Object.freeze({
      value: null,
      tombstone: true,
      version
    });

    const updatedState = this.applyEntry(key, entry);
    return {
      keyState: updatedState,
      frontier: toVersionFrontier(updatedState)
    };
  }

  /**
   * Applies an arbitrary VersionedEntry directly to the key, maintaining the invariant
   * that KeyState.entries holds only maximal undominated versions.
   */
  public applyEntry(key: string, entry: VersionedEntry): KeyState {
    const current = this.get(key);
    const updatedEntries = applyIncomingEntry(current.entries, entry);

    const updatedState: KeyState = Object.freeze({
      key,
      entries: updatedEntries
    });

    this.store.set(key, updatedState);
    return updatedState;
  }

  /**
   * Returns the VersionFrontier projection for the given key.
   */
  public getVersions(key: string): VersionFrontier {
    const state = this.get(key);
    return toVersionFrontier(state);
  }

  public size(): number {
    return this.store.size;
  }

  public getAllKeys(): readonly string[] {
    return Array.from(this.store.keys());
  }

  public getMetrics(): StorageEngineMetrics {
    let totalEntries = 0;
    let tombstones = 0;

    for (const state of this.store.values()) {
      totalEntries += state.entries.length;
      for (const entry of state.entries) {
        if (entry.tombstone) tombstones++;
      }
    }

    return {
      keyCount: this.store.size,
      totalEntriesCount: totalEntries,
      tombstoneCount: tombstones
    };
  }

  public clear(): void {
    this.store.clear();
  }
}
