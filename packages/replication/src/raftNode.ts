import { RaftLog, RaftLogEntry } from './raftLog.js';
import { PeerClientPool } from './peerClient.js';
import { NotLeaderError } from './leaderReplicationEngine.js';

export type RaftRole = 'FOLLOWER' | 'CANDIDATE' | 'LEADER';

export interface RaftNodeOptions {
  readonly localNodeId: string;
  readonly peers: readonly string[];
  readonly peerPool: PeerClientPool;
  readonly onApply: (entry: RaftLogEntry) => Promise<any>;
  readonly initialTerm?: number;
  readonly initialRole?: RaftRole;
  readonly initialLeaderId?: string;
}

export class RaftNode {
  public readonly localNodeId: string;
  public readonly peers: readonly string[];
  private readonly peerPool: PeerClientPool;
  private readonly onApply: (entry: RaftLogEntry) => Promise<any>;

  public currentTerm: number;
  public votedFor: string | null = null;
  public role: RaftRole;
  public leaderId: string | null;
  public commitIndex = 0;
  public lastApplied = 0;

  public readonly log: RaftLog;
  public readonly nextIndex = new Map<string, number>();
  public readonly matchIndex = new Map<string, number>();

  constructor(options: RaftNodeOptions) {
    this.localNodeId = options.localNodeId;
    this.peers = [...options.peers];
    this.peerPool = options.peerPool;
    this.onApply = options.onApply;
    this.currentTerm = options.initialTerm ?? 0;
    this.role = options.initialRole ?? 'FOLLOWER';
    this.leaderId = options.initialLeaderId ?? null;
    this.log = new RaftLog();

    for (const peerId of this.peers) {
      this.nextIndex.set(peerId, 1);
      this.matchIndex.set(peerId, 0);
    }
  }

  public isLeader(): boolean {
    return this.role === 'LEADER';
  }

  public getLeaderId(): string | null {
    return this.leaderId;
  }

  public handleRequestVote(req: {
    term: number;
    candidateId: string;
    lastLogIndex: number;
    lastLogTerm: number;
  }): { term: number; voteGranted: boolean } {
    if (req.term < this.currentTerm) {
      return { term: this.currentTerm, voteGranted: false };
    }

    if (req.term > this.currentTerm) {
      this.currentTerm = req.term;
      this.role = 'FOLLOWER';
      this.votedFor = null;
      this.leaderId = null;
    }

    const canVote = this.votedFor === null || this.votedFor === req.candidateId;
    const lastTerm = this.log.lastTerm();
    const lastIndex = this.log.lastIndex();
    const isLogUpToDate =
      req.lastLogTerm > lastTerm ||
      (req.lastLogTerm === lastTerm && req.lastLogIndex >= lastIndex);

    if (canVote && isLogUpToDate) {
      this.votedFor = req.candidateId;
      return { term: this.currentTerm, voteGranted: true };
    }

    return { term: this.currentTerm, voteGranted: false };
  }

  public async handleAppendEntries(req: {
    term: number;
    leaderId: string;
    prevLogIndex: number;
    prevLogTerm: number;
    entries: readonly RaftLogEntry[];
    leaderCommit: number;
  }): Promise<{ term: number; success: boolean; matchIndex: number }> {
    if (req.term < this.currentTerm) {
      return { term: this.currentTerm, success: false, matchIndex: this.log.lastIndex() };
    }

    if (req.term > this.currentTerm || this.role === 'CANDIDATE') {
      this.currentTerm = req.term;
      this.role = 'FOLLOWER';
      this.votedFor = null;
    }
    this.leaderId = req.leaderId;

    // Log consistency verification
    if (req.prevLogIndex > 0) {
      if (this.log.lastIndex() < req.prevLogIndex) {
        return { term: this.currentTerm, success: false, matchIndex: this.log.lastIndex() };
      }
      if (this.log.getTerm(req.prevLogIndex) !== req.prevLogTerm) {
        return { term: this.currentTerm, success: false, matchIndex: this.log.lastIndex() };
      }
    }

    // Append new entries not already in log
    if (req.entries.length > 0) {
      this.log.appendRaw(req.entries);
    }

    // Advance commitIndex and apply to state machine
    if (req.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(req.leaderCommit, this.log.lastIndex());
      await this.applyCommittedEntries();
    }

    return { term: this.currentTerm, success: true, matchIndex: this.log.lastIndex() };
  }

  public async handleInstallSnapshot(req: {
    term: number;
    leaderId: string;
    lastIncludedIndex: number;
    lastIncludedTerm: number;
    data: Uint8Array;
  }): Promise<{ term: number }> {
    if (req.term < this.currentTerm) {
      return { term: this.currentTerm };
    }

    if (req.term > this.currentTerm) {
      this.currentTerm = req.term;
      this.role = 'FOLLOWER';
      this.votedFor = null;
    }
    this.leaderId = req.leaderId;

    this.log.compact(req.lastIncludedIndex, req.lastIncludedTerm);
    if (req.lastIncludedIndex > this.commitIndex) {
      this.commitIndex = req.lastIncludedIndex;
      this.lastApplied = req.lastIncludedIndex;
    }

    return { term: this.currentTerm };
  }

  public async startElection(targetTerm?: number): Promise<boolean> {
    this.role = 'CANDIDATE';
    this.currentTerm = targetTerm ?? (this.currentTerm + 1);
    this.votedFor = this.localNodeId;
    this.leaderId = null;

    let votesGranted = 1; // Vote for self
    const clusterSize = this.peers.length + 1;
    const needed = Math.floor(clusterSize / 2) + 1;

    if (needed === 1) {
      // Single node cluster: automatically elected
      this.role = 'LEADER';
      this.leaderId = this.localNodeId;
      return true;
    }

    const lastLogIndex = this.log.lastIndex();
    const lastLogTerm = this.log.lastTerm();

    const voteResults = await Promise.all(
      this.peers.map(async (peerId) => {
        try {
          const resp = await this.peerPool.requestVoteOnPeer({
            peerNodeId: peerId,
            term: this.currentTerm,
            candidateId: this.localNodeId,
            lastLogIndex,
            lastLogTerm
          });
          if (resp.term > this.currentTerm) {
            this.currentTerm = resp.term;
            this.role = 'FOLLOWER';
            this.votedFor = null;
            return false;
          }
          return Boolean(resp.voteGranted);
        } catch {
          return false;
        }
      })
    );

    for (const v of voteResults) {
      if (v) votesGranted++;
    }

    if (this.role === 'CANDIDATE' && votesGranted >= needed) {
      this.role = 'LEADER';
      this.leaderId = this.localNodeId;
      for (const peerId of this.peers) {
        this.nextIndex.set(peerId, this.log.lastIndex() + 1);
        this.matchIndex.set(peerId, 0);
      }
      return true;
    }

    return false;
  }

  public stepDown(newTerm?: number, newLeaderId?: string): void {
    if (newTerm && newTerm > this.currentTerm) {
      this.currentTerm = newTerm;
    }
    this.role = 'FOLLOWER';
    this.votedFor = null;
    this.leaderId = newLeaderId ?? null;
  }

  public async propose(data: Uint8Array): Promise<{ entry: RaftLogEntry; result: any }> {
    if (this.role !== 'LEADER') {
      throw new NotLeaderError(
        `Node ${this.localNodeId} is not the Raft leader for term ${this.currentTerm}`,
        this.leaderId ?? undefined
      );
    }

    const entry = this.log.append(this.currentTerm, data);
    const clusterSize = this.peers.length + 1;
    const needed = Math.floor(clusterSize / 2) + 1;
    let matchCount = 1; // Local node has the entry

    if (this.peers.length > 0) {
      const prevLogIndex = entry.index - 1;
      const prevLogTerm = this.log.getTerm(prevLogIndex);

      const replicateResults = await Promise.all(
        this.peers.map(async (peerId) => {
          try {
            const resp = await this.peerPool.appendEntriesOnPeer({
              peerNodeId: peerId,
              term: this.currentTerm,
              leaderId: this.localNodeId,
              prevLogIndex,
              prevLogTerm,
              entries: [entry],
              leaderCommit: this.commitIndex
            });

            if (resp.success) {
              this.matchIndex.set(peerId, resp.matchIndex);
              this.nextIndex.set(peerId, resp.matchIndex + 1);
              return true;
            } else if (resp.term > this.currentTerm) {
              this.stepDown(resp.term);
            }
            return false;
          } catch {
            return false;
          }
        })
      );

      for (const ok of replicateResults) {
        if (ok) matchCount++;
      }
    }

    if (matchCount < needed) {
      throw new Error(`Raft consensus quorum not satisfied: only ${matchCount}/${needed} replicas acknowledged`);
    }

    // Quorum achieved: commit and apply
    this.commitIndex = entry.index;
    const result = await this.applyCommittedEntries();
    // Notify followers of updated commitIndex
    await this.broadcastHeartbeats().catch(() => {});
    return { entry, result };
  }

  public async broadcastHeartbeats(): Promise<void> {
    if (this.role !== 'LEADER') return;
    await Promise.all(
      this.peers.map(async (peerId) => {
        try {
          const next = this.nextIndex.get(peerId) ?? (this.log.lastIndex() + 1);
          const prevLogIndex = next - 1;
          const prevLogTerm = this.log.getTerm(prevLogIndex);
          const entries = this.log.getEntriesFrom(next);

          const resp = await this.peerPool.appendEntriesOnPeer({
            peerNodeId: peerId,
            term: this.currentTerm,
            leaderId: this.localNodeId,
            prevLogIndex,
            prevLogTerm,
            entries,
            leaderCommit: this.commitIndex
          });

          if (resp.success) {
            this.matchIndex.set(peerId, resp.matchIndex);
            this.nextIndex.set(peerId, resp.matchIndex + 1);
          } else if (resp.term > this.currentTerm) {
            this.stepDown(resp.term);
          } else {
            this.nextIndex.set(peerId, Math.max(1, next - 1));
          }
        } catch {
          // ignore transient failure
        }
      })
    );
  }

  public async applyCommittedEntries(): Promise<any> {
    let lastResult: any = null;
    while (this.commitIndex > this.lastApplied) {
      this.lastApplied += 1;
      const entry = this.log.getEntry(this.lastApplied);
      if (entry) {
        lastResult = await this.onApply(entry);
      }
    }
    return lastResult;
  }
}
