import * as grpc from '@grpc/grpc-js';
import { RaftNode } from '@quorum-lab/replication';

export class RaftServiceImpl {
  private readonly raftNode: RaftNode;

  constructor(raftNode: RaftNode) {
    this.raftNode = raftNode;
  }

  public requestVote = (
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void => {
    try {
      const { term, candidate_id, last_log_index, last_log_term } = call.request;
      const resp = this.raftNode.handleRequestVote({
        term: Number(term ?? 0),
        candidateId: candidate_id ?? '',
        lastLogIndex: Number(last_log_index ?? 0),
        lastLogTerm: Number(last_log_term ?? 0)
      });

      callback(null, {
        term: resp.term,
        vote_granted: resp.voteGranted
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message ?? 'Internal error during RequestVote'
      });
    }
  };

  public appendEntries = async (
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): Promise<void> => {
    try {
      const { term, leader_id, prev_log_index, prev_log_term, entries, leader_commit } = call.request;

      const mappedEntries = (entries ?? []).map((e: any) => ({
        term: Number(e.term ?? 0),
        index: Number(e.index ?? 0),
        data: Buffer.isBuffer(e.data)
          ? new Uint8Array(e.data)
          : e.data instanceof Uint8Array
            ? e.data
            : new Uint8Array(Buffer.from(e.data ?? ''))
      }));

      const resp = await this.raftNode.handleAppendEntries({
        term: Number(term ?? 0),
        leaderId: leader_id ?? '',
        prevLogIndex: Number(prev_log_index ?? 0),
        prevLogTerm: Number(prev_log_term ?? 0),
        entries: mappedEntries,
        leaderCommit: Number(leader_commit ?? 0)
      });

      callback(null, {
        term: resp.term,
        success: resp.success,
        match_index: resp.matchIndex
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message ?? 'Internal error during AppendEntries'
      });
    }
  };

  public installSnapshot = async (
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): Promise<void> => {
    try {
      const { term, leader_id, last_included_index, last_included_term, data } = call.request;

      const rawData = Buffer.isBuffer(data)
        ? new Uint8Array(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(Buffer.from(data ?? ''));

      const resp = await this.raftNode.handleInstallSnapshot({
        term: Number(term ?? 0),
        leaderId: leader_id ?? '',
        lastIncludedIndex: Number(last_included_index ?? 0),
        lastIncludedTerm: Number(last_included_term ?? 0),
        data: rawData
      });

      callback(null, {
        term: resp.term
      });
    } catch (err: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: err?.message ?? 'Internal error during InstallSnapshot'
      });
    }
  };

  public getServiceImplementation(): grpc.UntypedServiceImplementation {
    return {
      RequestVote: this.requestVote,
      AppendEntries: this.appendEntries,
      InstallSnapshot: this.installSnapshot
    };
  }
}
