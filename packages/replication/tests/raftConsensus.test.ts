import { describe, it, expect, vi } from 'vitest';
import { RaftLog } from '../src/raftLog.js';
import { RaftNode } from '../src/raftNode.js';
import { PeerClientPool } from '../src/peerClient.js';
import { NotLeaderError } from '../src/leaderReplicationEngine.js';

describe('Raft Consensus & Log Compaction (§Q9)', () => {
  it('RaftLog enforces 1-based indexing, entry append, conflict truncation, and compaction', () => {
    const log = new RaftLog();
    expect(log.lastIndex()).toBe(0);
    expect(log.lastTerm()).toBe(0);

    // 1. Append entries
    const e1 = log.append(1, Buffer.from('cmd1'));
    expect(e1.index).toBe(1);
    expect(e1.term).toBe(1);

    const e2 = log.append(1, Buffer.from('cmd2'));
    expect(e2.index).toBe(2);
    expect(log.lastIndex()).toBe(2);
    expect(log.lastTerm()).toBe(1);

    // 2. Conflict resolution via appendRaw
    // Overwrite entry 2 with term 2
    log.appendRaw([{ term: 2, index: 2, data: Buffer.from('cmd2-new') }]);
    expect(log.lastIndex()).toBe(2);
    expect(log.lastTerm()).toBe(2);
    expect(Buffer.from(log.getEntry(2)!.data).toString()).toBe('cmd2-new');

    // 3. Truncation
    log.append(2, Buffer.from('cmd3'));
    expect(log.lastIndex()).toBe(3);
    log.truncateFrom(3);
    expect(log.lastIndex()).toBe(2);
    expect(log.getEntry(3)).toBeUndefined();

    // 4. Log Compaction (Snapshots)
    log.append(2, Buffer.from('cmd3'));
    log.append(2, Buffer.from('cmd4'));
    expect(log.lastIndex()).toBe(4);

    // Compact up to index 2
    log.compact(2, 2);
    expect(log.lastIndex()).toBe(4);
    expect(log.getEntry(1)).toBeUndefined(); // Discarded from log
    expect(log.getEntry(2)).toBeUndefined(); // Discarded from log
    expect(log.getEntry(3)?.index).toBe(3);
    expect(log.getTerm(2)).toBe(2); // Retained via snapshot metadata
  });

  it('RaftNode handles RequestVote according to election safety and log up-to-dateness', () => {
    const peerPool = new PeerClientPool();
    const applied: any[] = [];
    const node = new RaftNode({
      localNodeId: 'node-1',
      peers: ['node-2', 'node-3'],
      peerPool,
      onApply: async (entry) => applied.push(entry),
      initialTerm: 2
    });

    // 1. Stale term vote rejected
    const r1 = node.handleRequestVote({
      term: 1,
      candidateId: 'node-2',
      lastLogIndex: 10,
      lastLogTerm: 1
    });
    expect(r1.voteGranted).toBe(false);

    // 2. Higher term updates receiver term and grants vote
    const r2 = node.handleRequestVote({
      term: 3,
      candidateId: 'node-2',
      lastLogIndex: 0,
      lastLogTerm: 0
    });
    expect(r2.voteGranted).toBe(true);
    expect(node.currentTerm).toBe(3);
    expect(node.votedFor).toBe('node-2');

    // 3. Already voted for node-2 in term 3 -> rejects another candidate node-3
    const r3 = node.handleRequestVote({
      term: 3,
      candidateId: 'node-3',
      lastLogIndex: 5,
      lastLogTerm: 3
    });
    expect(r3.voteGranted).toBe(false);
  });

  it('RaftNode handles AppendEntries log replication and applies committed entries', async () => {
    const peerPool = new PeerClientPool();
    const applied: string[] = [];
    const node = new RaftNode({
      localNodeId: 'node-follower',
      peers: ['node-leader'],
      peerPool,
      onApply: async (entry) => {
        applied.push(Buffer.from(entry.data).toString());
      },
      initialTerm: 1
    });

    // 1. Valid append entries from leader with commit progression
    const resp1 = await node.handleAppendEntries({
      term: 1,
      leaderId: 'node-leader',
      prevLogIndex: 0,
      prevLogTerm: 0,
      entries: [
        { term: 1, index: 1, data: Buffer.from('mutation-1') },
        { term: 1, index: 2, data: Buffer.from('mutation-2') }
      ],
      leaderCommit: 1
    });

    expect(resp1.success).toBe(true);
    expect(node.commitIndex).toBe(1);
    expect(applied).toEqual(['mutation-1']);

    // 2. Advance leaderCommit to 2
    const resp2 = await node.handleAppendEntries({
      term: 1,
      leaderId: 'node-leader',
      prevLogIndex: 2,
      prevLogTerm: 1,
      entries: [],
      leaderCommit: 2
    });

    expect(resp2.success).toBe(true);
    expect(node.commitIndex).toBe(2);
    expect(applied).toEqual(['mutation-1', 'mutation-2']);

    // 3. Reject entry when prevLogIndex does not match
    const resp3 = await node.handleAppendEntries({
      term: 1,
      leaderId: 'node-leader',
      prevLogIndex: 99, // Non-existent index
      prevLogTerm: 1,
      entries: [],
      leaderCommit: 2
    });
    expect(resp3.success).toBe(false);
  });

  it('RaftNode handles InstallSnapshot and fast-forwards state machine', async () => {
    const peerPool = new PeerClientPool();
    const node = new RaftNode({
      localNodeId: 'node-1',
      peers: ['node-2'],
      peerPool,
      onApply: async () => {},
      initialTerm: 1
    });

    await node.handleInstallSnapshot({
      term: 2,
      leaderId: 'node-leader',
      lastIncludedIndex: 50,
      lastIncludedTerm: 2,
      data: Buffer.from('snapshot-bytes')
    });

    expect(node.currentTerm).toBe(2);
    expect(node.commitIndex).toBe(50);
    expect(node.lastApplied).toBe(50);
    expect(node.log.lastIndex()).toBe(50);
    expect(node.log.lastTerm()).toBe(2);
  });

  it('RaftNode proposes mutations and commits upon majority quorum', async () => {
    const peerPool = new PeerClientPool();
    const applied: string[] = [];

    const leaderNode = new RaftNode({
      localNodeId: 'leader-node',
      peers: ['peer-1', 'peer-2'],
      peerPool,
      onApply: async (entry) => {
        const text = Buffer.from(entry.data).toString();
        applied.push(text);
        return { applied: text, index: entry.index };
      },
      initialTerm: 1,
      initialRole: 'LEADER',
      initialLeaderId: 'leader-node'
    });

    // Mock peer responses to AppendEntries
    vi.spyOn(peerPool, 'appendEntriesOnPeer').mockImplementation(async (params) => {
      return {
        term: params.term,
        success: true,
        matchIndex: params.entries.length > 0 ? params.entries[params.entries.length - 1]!.index : params.prevLogIndex
      };
    });

    const propRes = await leaderNode.propose(Buffer.from('consensus-write-1'));
    expect(propRes.entry.index).toBe(1);
    expect(propRes.entry.term).toBe(1);
    expect(leaderNode.commitIndex).toBe(1);
    expect(applied).toEqual(['consensus-write-1']);

    // Followers cannot propose
    const followerNode = new RaftNode({
      localNodeId: 'follower-node',
      peers: ['leader-node'],
      peerPool,
      onApply: async () => {},
      initialTerm: 1,
      initialRole: 'FOLLOWER'
    });

    await expect(followerNode.propose(Buffer.from('illegal-write'))).rejects.toThrow(NotLeaderError);
  });
});
