import crypto from 'node:crypto';
import { VersionStamp } from '@quorum-lab/consistency';

export interface BucketEntry {
  readonly key: string;
  readonly version: VersionStamp;
  readonly tombstone?: boolean;
  readonly value?: Uint8Array | null;
}

export interface MerkleNode {
  readonly level: number;
  readonly index: number;
  readonly hash: string;
  readonly leftChild?: MerkleNode;
  readonly rightChild?: MerkleNode;
  readonly bucketRange: { min: number; max: number };
}

export interface RemoteTreeDigests {
  readonly bucketCount: number;
  readonly rootHash: string;
  readonly bucketHashes: readonly string[];
}

export class MerkleTree {
  public readonly bucketCount: number;
  public readonly root: MerkleNode;
  public readonly bucketHashes: readonly string[];

  constructor(bucketCount: number, root: MerkleNode, bucketHashes: readonly string[]) {
    this.bucketCount = bucketCount;
    this.root = root;
    this.bucketHashes = Object.freeze([...bucketHashes]);
  }

  public getRootHash(): string {
    return this.root.hash;
  }

  public getBucketHash(bucketId: number): string {
    if (bucketId < 0 || bucketId >= this.bucketCount) {
      throw new Error(`Bucket ID ${bucketId} out of range [0, ${this.bucketCount - 1}]`);
    }
    return this.bucketHashes[bucketId]!;
  }

  public toRemoteDigests(): RemoteTreeDigests {
    return {
      bucketCount: this.bucketCount,
      rootHash: this.getRootHash(),
      bucketHashes: this.bucketHashes
    };
  }
}

/**
 * Maps a key to a bucket in [0, bucketCount - 1] deterministically using SHA-256.
 */
export function keyToBucket(key: string, bucketCount = 16): number {
  if (bucketCount <= 0 || (bucketCount & (bucketCount - 1)) !== 0) {
    throw new Error(`bucketCount must be a power of 2, received ${bucketCount}`);
  }
  const hash = crypto.createHash('sha256').update(key).digest();
  const u32 = hash.readUInt32BE(0);
  return u32 % bucketCount;
}

/**
 * Computes a deterministic SHA-256 digest for all entries in a single bucket.
 */
export function computeBucketDigest(entries: readonly BucketEntry[]): string {
  if (!entries || entries.length === 0) {
    return crypto.createHash('sha256').update('__EMPTY_BUCKET__').digest('hex');
  }

  // Sort entries deterministically by key, then dot.nodeId, then dot.counter
  const sorted = [...entries].sort((a, b) => {
    if (a.key !== b.key) return a.key.localeCompare(b.key);
    if (a.version.dot.nodeId !== b.version.dot.nodeId) {
      return a.version.dot.nodeId.localeCompare(b.version.dot.nodeId);
    }
    return a.version.dot.counter - b.version.dot.counter;
  });

  const hasher = crypto.createHash('sha256');
  for (const item of sorted) {
    const valHash = item.value && item.value.length > 0
      ? crypto.createHash('sha256').update(item.value).digest('hex')
      : 'empty';

    const vcStr = Object.entries(item.version.vectorClock)
      .sort(([k1], [k2]) => k1.localeCompare(k2))
      .map(([k, v]) => `${k}:${v}`)
      .join(',');

    const itemStr = `${item.key}|${item.tombstone ? 1 : 0}|${item.version.dot.nodeId}:${item.version.dot.counter}|${item.version.lamport}|${item.version.wallTimeMs}|vc=[${vcStr}]|val=${valHash}`;
    hasher.update(itemStr).update(';');
  }

  return hasher.digest('hex');
}

/**
 * Builds a binary Merkle tree over the provided entries partitioned into bucketCount buckets.
 */
export function buildMerkleTree(entries: readonly BucketEntry[], bucketCount = 16): MerkleTree {
  if (bucketCount <= 0 || (bucketCount & (bucketCount - 1)) !== 0) {
    throw new Error(`bucketCount must be a power of 2, received ${bucketCount}`);
  }

  // 1. Partition entries into buckets
  const buckets: BucketEntry[][] = Array.from({ length: bucketCount }, () => []);
  for (const entry of entries) {
    const bId = keyToBucket(entry.key, bucketCount);
    buckets[bId]!.push(entry);
  }

  // 2. Compute leaf digests (level 0)
  const leafHashes: string[] = [];
  let currentLevelNodes: MerkleNode[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const hash = computeBucketDigest(buckets[i]!);
    leafHashes.push(hash);
    currentLevelNodes.push({
      level: 0,
      index: i,
      hash,
      bucketRange: { min: i, max: i }
    });
  }

  // 3. Bottom-up binary Merkle construction
  let level = 1;
  while (currentLevelNodes.length > 1) {
    const nextLevelNodes: MerkleNode[] = [];
    for (let i = 0; i < currentLevelNodes.length; i += 2) {
      const left = currentLevelNodes[i]!;
      const right = currentLevelNodes[i + 1]!;

      const combinedHash = crypto
        .createHash('sha256')
        .update(left.hash)
        .update(right.hash)
        .digest('hex');

      nextLevelNodes.push({
        level,
        index: Math.floor(i / 2),
        hash: combinedHash,
        leftChild: left,
        rightChild: right,
        bucketRange: { min: left.bucketRange.min, max: right.bucketRange.max }
      });
    }
    currentLevelNodes = nextLevelNodes;
    level += 1;
  }

  const root = currentLevelNodes[0]!;
  return new MerkleTree(bucketCount, root, leafHashes);
}

/**
 * Compares two Merkle trees and recursively identifies all differing bucket IDs.
 */
export function findDifferingBuckets(
  localTree: MerkleTree,
  remote: MerkleTree | RemoteTreeDigests
): number[] {
  if (localTree.bucketCount !== remote.bucketCount) {
    throw new Error(
      `Cannot compare Merkle trees with different bucket counts (${localTree.bucketCount} vs ${remote.bucketCount})`
    );
  }

  // Quick exit if root hashes match
  const remoteRoot = 'root' in remote ? remote.root.hash : remote.rootHash;
  if (localTree.getRootHash() === remoteRoot) {
    return [];
  }

  // If remote is another full MerkleTree, walk the binary tree top-down
  if ('root' in remote) {
    const differing: number[] = [];

    function compareNodes(localNode: MerkleNode, remoteNode: MerkleNode) {
      if (localNode.hash === remoteNode.hash) {
        return;
      }
      if (localNode.level === 0) {
        differing.push(localNode.index);
        return;
      }
      if (localNode.leftChild && remoteNode.leftChild) {
        compareNodes(localNode.leftChild, remoteNode.leftChild);
      }
      if (localNode.rightChild && remoteNode.rightChild) {
        compareNodes(localNode.rightChild, remoteNode.rightChild);
      }
    }

    compareNodes(localTree.root, remote.root);
    return differing.sort((a, b) => a - b);
  }

  // If remote only provided leaf bucket hashes
  const differing: number[] = [];
  for (let i = 0; i < localTree.bucketCount; i++) {
    if (localTree.getBucketHash(i) !== remote.bucketHashes[i]) {
      differing.push(i);
    }
  }
  return differing;
}
