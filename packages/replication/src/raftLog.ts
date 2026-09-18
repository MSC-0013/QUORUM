export interface RaftLogEntry {
  readonly term: number;
  readonly index: number;
  readonly data: Uint8Array;
}

/**
 * Dedicated append-only log for Raft consensus entries.
 * Strictly separated from the KV state machine WAL to guarantee clean consensus replication (§Q9).
 */
export class RaftLog {
  private entries: RaftLogEntry[] = [];
  private lastIncludedIndex = 0;
  private lastIncludedTerm = 0;

  constructor(initialEntries?: RaftLogEntry[], lastIncludedIndex = 0, lastIncludedTerm = 0) {
    if (initialEntries) {
      this.entries = [...initialEntries];
    }
    this.lastIncludedIndex = lastIncludedIndex;
    this.lastIncludedTerm = lastIncludedTerm;
  }

  public lastIndex(): number {
    if (this.entries.length === 0) {
      return this.lastIncludedIndex;
    }
    return this.entries[this.entries.length - 1]!.index;
  }

  public lastTerm(): number {
    if (this.entries.length === 0) {
      return this.lastIncludedTerm;
    }
    return this.entries[this.entries.length - 1]!.term;
  }

  public getTerm(index: number): number {
    if (index === 0) return 0;
    if (index === this.lastIncludedIndex) return this.lastIncludedTerm;
    const entry = this.getEntry(index);
    return entry ? entry.term : 0;
  }

  public getEntry(index: number): RaftLogEntry | undefined {
    if (index <= this.lastIncludedIndex) {
      return undefined;
    }
    const offset = index - this.lastIncludedIndex - 1;
    return this.entries[offset];
  }

  public getEntriesFrom(index: number): RaftLogEntry[] {
    if (index <= this.lastIncludedIndex) {
      return [...this.entries];
    }
    const offset = index - this.lastIncludedIndex - 1;
    return this.entries.slice(offset);
  }

  public append(term: number, data: Uint8Array): RaftLogEntry {
    const nextIndex = this.lastIndex() + 1;
    const entry: RaftLogEntry = {
      term,
      index: nextIndex,
      data
    };
    this.entries.push(entry);
    return entry;
  }

  public appendRaw(newEntries: readonly RaftLogEntry[]): void {
    for (const e of newEntries) {
      const existing = this.getEntry(e.index);
      if (existing) {
        if (existing.term !== e.term) {
          this.truncateFrom(e.index);
          this.entries.push({ ...e });
        }
      } else {
        this.entries.push({ ...e });
      }
    }
  }

  public truncateFrom(index: number): void {
    if (index <= this.lastIncludedIndex) {
      this.entries = [];
      return;
    }
    const offset = index - this.lastIncludedIndex - 1;
    if (offset >= 0 && offset < this.entries.length) {
      this.entries = this.entries.slice(0, offset);
    }
  }

  public compact(lastIncludedIndex: number, lastIncludedTerm: number): void {
    if (lastIncludedIndex <= this.lastIncludedIndex) {
      return;
    }
    const discardCount = lastIncludedIndex - this.lastIncludedIndex;
    this.entries = this.entries.slice(discardCount);
    this.lastIncludedIndex = lastIncludedIndex;
    this.lastIncludedTerm = lastIncludedTerm;
  }

  public getSnapshotMetadata(): { lastIncludedIndex: number; lastIncludedTerm: number } {
    return {
      lastIncludedIndex: this.lastIncludedIndex,
      lastIncludedTerm: this.lastIncludedTerm
    };
  }

  public length(): number {
    return this.entries.length;
  }
}
