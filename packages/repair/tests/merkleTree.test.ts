import { describe, it, expect } from 'vitest';
import {
  buildMerkleTree,
  findDifferingBuckets,
  keyToBucket,
  computeBucketDigest,
  BucketEntry
} from '../src/merkleTree.js';
import { createVersionStamp } from '@quorum-lab/consistency';

describe('MerkleTree Anti-Entropy (§Q6)', () => {
  function makeEntry(key: string, counter: number, valStr: string): BucketEntry {
    return {
      key,
      version: createVersionStamp({
        nodeId: 'node-a',
        counter,
        vectorClock: { 'node-a': counter },
        lamport: counter,
        wallTimeMs: 1000 + counter
      }),
      tombstone: false,
      value: Buffer.from(valStr)
    };
  }

  it('computes identical root hashes for identically partitioned datasets', () => {
    const entriesA: BucketEntry[] = [
      makeEntry('user:101', 1, 'Alice'),
      makeEntry('user:102', 2, 'Bob'),
      makeEntry('user:103', 1, 'Charlie')
    ];

    // Same entries in different order
    const entriesB: BucketEntry[] = [
      makeEntry('user:103', 1, 'Charlie'),
      makeEntry('user:101', 1, 'Alice'),
      makeEntry('user:102', 2, 'Bob')
    ];

    const treeA = buildMerkleTree(entriesA, 16);
    const treeB = buildMerkleTree(entriesB, 16);

    expect(treeA.getRootHash()).toBe(treeB.getRootHash());
    expect(treeA.bucketHashes).toEqual(treeB.bucketHashes);
    expect(findDifferingBuckets(treeA, treeB)).toEqual([]);
  });

  it('isolates the exact differing bucket ID when a single key differs', () => {
    const commonEntries: BucketEntry[] = [
      makeEntry('user:101', 1, 'Alice'),
      makeEntry('user:102', 1, 'Bob'),
      makeEntry('user:104', 1, 'David')
    ];

    const entriesA: BucketEntry[] = [
      ...commonEntries,
      makeEntry('user:target', 1, 'TargetV1')
    ];

    const entriesB: BucketEntry[] = [
      ...commonEntries,
      makeEntry('user:target', 2, 'TargetV2') // Updated version
    ];

    const expectedBucket = keyToBucket('user:target', 16);

    const treeA = buildMerkleTree(entriesA, 16);
    const treeB = buildMerkleTree(entriesB, 16);

    expect(treeA.getRootHash()).not.toBe(treeB.getRootHash());

    const differing = findDifferingBuckets(treeA, treeB);
    expect(differing).toEqual([expectedBucket]);
  });

  it('compares against remote leaf digests efficiently without requiring full remote tree', () => {
    const entriesA: BucketEntry[] = [
      makeEntry('key-1', 1, 'val1'),
      makeEntry('key-2', 1, 'val2')
    ];

    const entriesB: BucketEntry[] = [
      makeEntry('key-1', 1, 'val1'),
      makeEntry('key-2', 2, 'val2-modified')
    ];

    const treeA = buildMerkleTree(entriesA, 16);
    const treeB = buildMerkleTree(entriesB, 16);
    const remoteDigests = treeB.toRemoteDigests();

    const differing = findDifferingBuckets(treeA, remoteDigests);
    const expectedBucket = keyToBucket('key-2', 16);
    expect(differing).toEqual([expectedBucket]);
  });
});
