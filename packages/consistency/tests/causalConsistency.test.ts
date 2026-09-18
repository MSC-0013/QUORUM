import { describe, it, expect } from 'vitest';
import {
  VersionFrontier,
  createVersionStamp,
  satisfiesCausalDependency,
  CausalSessionTracker
} from '../src/index.js';

describe('Causal Consistency & Session Tracking (§Q5)', () => {
  it('satisfies causal dependency when frontier dominates client past', () => {
    const frontier: VersionFrontier = {
      key: 'user-profile',
      maximalVersions: [
        createVersionStamp({
          nodeId: 'node-1',
          counter: 5,
          vectorClock: { 'node-1': 5, 'node-2': 3 },
          lamport: 10,
          wallTimeMs: 1000
        })
      ]
    };

    // Client required node-1 >= 4, node-2 >= 2
    const clientDependency = { 'node-1': 4, 'node-2': 2 };
    expect(satisfiesCausalDependency(frontier, clientDependency)).toBe(true);
  });

  it('detects violation when frontier is missing causal dependencies', () => {
    const frontier: VersionFrontier = {
      key: 'user-profile',
      maximalVersions: [
        createVersionStamp({
          nodeId: 'node-1',
          counter: 2,
          vectorClock: { 'node-1': 2 },
          lamport: 4,
          wallTimeMs: 1000
        })
      ]
    };

    // Client required update from node-2 that has not yet replicated
    const clientDependency = { 'node-1': 2, 'node-2': 1 };
    expect(satisfiesCausalDependency(frontier, clientDependency)).toBe(false);
  });

  it('tracks and advances causal session monotonically across writes', () => {
    const session = new CausalSessionTracker();
    expect(session.getFrontier()).toEqual({});

    session.advance({ 'node-1': 1 });
    expect(session.getFrontier()).toEqual({ 'node-1': 1 });

    session.advance({ 'node-1': 3, 'node-2': 1 });
    expect(session.getFrontier()).toEqual({ 'node-1': 3, 'node-2': 1 });

    // Advancing with an older version does not regress the causal frontier
    session.advance({ 'node-1': 2 });
    expect(session.getFrontier()['node-1']).toBe(3);

    // Serialization to token and back
    const token = session.encodeToken();
    expect(typeof token).toBe('string');
    const decoded = CausalSessionTracker.decodeToken(token);
    expect(decoded).toEqual({ 'node-1': 3, 'node-2': 1 });
  });
});
