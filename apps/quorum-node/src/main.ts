import http from 'node:http';
import { loadConfigFromEnv } from './config.js';
import { QuorumNodeApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfigFromEnv();
  const app = new QuorumNodeApp(config);

  const httpPort = parseInt(process.env['PORT'] ?? process.env['HTTP_PORT'] ?? '8080', 10);
  const httpServer = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const accept = req.headers['accept'] ?? '';
    const wantsJson =
      (accept.includes('application/json') && !accept.includes('text/html')) ||
      parsedUrl.searchParams.get('format') === 'json';

    if (wantsJson) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          service: 'QUORUM LAB Distributed Consensus Cluster Node',
          status: 'ONLINE',
          nodeId: config.node.id,
          clusterId: config.node.clusterId,
          state: app.lifecycle.getState(),
          grpcPort: config.node.grpcPort,
          httpPort,
          replication: 'Leaderless Dynamo-style (W=2, R=2, N=3)',
          durability: 'WAL fsync + MemStore',
          conflictResolution: 'Last-Write-Wins (Vector Clocks + Dot)'
        })
      );
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderQuorumDashboard(config.node.id, config.node.clusterId, app.lifecycle.getState(), config.node.grpcPort, httpPort));
  });

  process.on('SIGINT', async () => {
    console.log(`\nReceived SIGINT. Shutting down ${config.node.id}...`);
    httpServer.close();
    await app.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log(`\nReceived SIGTERM. Shutting down ${config.node.id}...`);
    httpServer.close();
    await app.stop();
    process.exit(0);
  });

  try {
    const port = await app.start();
    console.log(
      `[QUORUM LAB] Node ${config.node.id} listening on 0.0.0.0:${port} (Cluster: ${config.node.clusterId}, State: ${app.lifecycle.getState()})`
    );

    httpServer.listen(httpPort, '0.0.0.0', () => {
      console.log(`[QUORUM LAB] Public HTTP health server listening on 0.0.0.0:${httpPort}`);
    });
  } catch (err) {
    console.error('Failed to start Quorum Node:', err);
    process.exit(1);
  }
}

function renderQuorumDashboard(nodeId: string, clusterId: string, nodeState: string, grpcPort: number, httpPort: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QUORUM LAB — Distributed Consensus Cluster Node</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --primary: #3b82f6;
      --success: #10b981;
      --warning: #f59e0b;
      --accent: #8b5cf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; line-height: 1.5; }
    .container { max-width: 1100px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 18px; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
    h1 { font-size: 24px; font-weight: 800; }
    .subtitle { color: var(--muted); font-size: 13px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
    .card h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 8px; }
    .stat-val { font-size: 24px; font-weight: 800; color: #fff; }
    .stat-desc { font-size: 12px; color: var(--muted); margin-top: 4px; }
    .control-row { margin-bottom: 16px; }
    .control-row label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    .control-row input[type="range"] { width: 100%; }
    .btn { background: #2563eb; color: #fff; border: none; padding: 8px 14px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; transition: background 0.15s; }
    .btn:hover { background: #1d4ed8; }
    .btn-secondary { background: #374151; color: #e5e7eb; }
    .btn-secondary:hover { background: #4b5563; }
    .links-grid { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
    .link-btn { display: inline-flex; align-items: center; gap: 6px; background: #1f2937; border: 1px solid #374151; color: #60a5fa; padding: 8px 14px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600; }
    .link-btn:hover { background: #374151; }
    .vector-clock-box { background: #0b0f19; border: 1px solid #374151; border-radius: 6px; padding: 12px; font-family: monospace; font-size: 14px; color: #34d399; margin: 12px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>QUORUM LAB Distributed Consensus Cluster</h1>
        <div class="subtitle">Leaderless Dynamo-Style Consensus &middot; Node: <strong>` + nodeId + `</strong> &middot; Cluster: <strong>` + clusterId + `</strong> &middot; HTTP: <strong>:` + httpPort + `</strong></div>
      </div>
      <div class="badge"><span class="badge-dot"></span> NODE ACTIVE (` + nodeState + `)</div>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Replication Topology</h3>
        <div class="stat-val" style="color: #60a5fa;">Dynamo (W=2, R=2)</div>
        <div class="stat-desc">Strict Quorum intersection: W + R > N (4 > 3)</div>
      </div>
      <div class="card">
        <h3>Durability Tier</h3>
        <div class="stat-val" style="color: #34d399;">WAL fsync + MemStore</div>
        <div class="stat-desc">Sequential append-only log with deterministic recovery</div>
      </div>
      <div class="card">
        <h3>Conflict Resolution</h3>
        <div class="stat-val" style="color: #fbbf24;">Vector Clocks + Dot</div>
        <div class="stat-desc">Causal partial order tracking with Last-Write-Wins fallback</div>
      </div>
      <div class="card">
        <h3>Cluster Transport</h3>
        <div class="stat-val" style="color: #a78bfa;">gRPC :` + grpcPort + `</div>
        <div class="stat-desc">HTTP/2 multiplexing with Protobuf contracts</div>
      </div>
    </div>

    <div class="grid" style="grid-template-columns: 1fr 1fr;">
      <div class="card">
        <h2 style="font-size: 16px; margin-bottom: 16px;">Interactive Quorum Consistency Calculator</h2>
        <div class="control-row">
          <label>Cluster Size (N): <span id="val-n">3</span> nodes</label>
          <input type="range" min="3" max="9" step="2" value="3" id="inp-n" oninput="calcQuorum()" />
        </div>
        <div class="control-row">
          <label>Write Quorum (W): <span id="val-w">2</span> nodes</label>
          <input type="range" min="1" max="3" step="1" value="2" id="inp-w" oninput="calcQuorum()" />
        </div>
        <div class="control-row">
          <label>Read Quorum (R): <span id="val-r">2</span> nodes</label>
          <input type="range" min="1" max="3" step="1" value="2" id="inp-r" oninput="calcQuorum()" />
        </div>
      </div>

      <div class="card">
        <h2 style="font-size: 16px; margin-bottom: 16px;">Consistency & Availability Guarantees</h2>
        <div style="margin-bottom: 14px;">
          <div class="stat-val" id="res-status" style="color: #34d399;">STRONG (W+R > N)</div>
          <div class="stat-desc" id="res-desc">Guaranteed read-your-writes and monotonic read consistency</div>
        </div>
        <div style="margin-bottom: 14px;">
          <div class="stat-val" id="res-write-tol" style="color: #60a5fa;">1 Node</div>
          <div class="stat-desc">Tolerable write node failures (N - W)</div>
        </div>
        <div>
          <div class="stat-val" id="res-read-tol" style="color: #fbbf24;">1 Node</div>
          <div class="stat-desc">Tolerable read node failures (N - R)</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <h2 style="font-size: 16px; margin-bottom: 12px;">Live Vector Clock Causality Simulator</h2>
      <p style="color: var(--muted); font-size: 13px; margin-bottom: 12px;">
        Simulate concurrent writes across cluster nodes to see causal vector clock evolution:
      </p>
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button class="btn" onclick="writeNode('node-a')">&#9997; Write to Node A</button>
        <button class="btn" onclick="writeNode('node-b')">&#9997; Write to Node B</button>
        <button class="btn" onclick="writeNode('node-c')">&#9997; Write to Node C</button>
        <button class="btn btn-secondary" onclick="syncClocks()">&#128260; Anti-Entropy Sync</button>
        <button class="btn btn-secondary" onclick="resetClocks()">&#10060; Reset</button>
      </div>
      <div class="vector-clock-box" id="vc-display">
        Current Vector Clock: { node-a: 0, node-b: 0, node-c: 0 }
      </div>
      <div id="vc-explanation" style="font-size: 13px; color: var(--muted);">
        Cluster state synchronized. Zero pending causal conflicts.
      </div>
    </div>

    <div class="card">
      <h2 style="font-size: 16px; margin-bottom: 8px;">Active Cluster Endpoints & Ecosystem Links</h2>
      <p style="color: var(--muted); font-size: 13px;">This cluster node serves both gRPC consensus traffic and public monitoring:</p>
      <div class="links-grid">
        <a class="link-btn" href="/?format=json" target="_blank">&#128203; Raw JSON Node Status (/?format=json)</a>
        <a class="link-btn" href="https://system-x-dashboard.onrender.com" target="_blank" style="color: #34d399; border-color: rgba(16,185,129,0.4);">&#128279; Open System-X Unified Portal</a>
        <a class="link-btn" href="https://blackbox-x.onrender.com" target="_blank" style="color: #60a5fa; border-color: rgba(96,165,250,0.4);">&#128279; Open BLACKBOX-X Simulation</a>
        <a class="link-btn" href="https://github.com/MSC-0013/QUORUM" target="_blank">&#128187; GitHub Repository</a>
      </div>
    </div>
  </div>

  <script>
    var vc = { 'node-a': 0, 'node-b': 0, 'node-c': 0 };

    function calcQuorum() {
      var n = parseInt(document.getElementById('inp-n').value, 10);
      var inpW = document.getElementById('inp-w');
      var inpR = document.getElementById('inp-r');

      inpW.max = n;
      inpR.max = n;

      var w = parseInt(inpW.value, 10);
      var r = parseInt(inpR.value, 10);

      document.getElementById('val-n').textContent = n;
      document.getElementById('val-w').textContent = w;
      document.getElementById('val-r').textContent = r;

      var sum = w + r;
      var statusEl = document.getElementById('res-status');
      var descEl = document.getElementById('res-desc');

      if (sum > n) {
        statusEl.textContent = 'STRONG (W+R > N : ' + sum + ' > ' + n + ')';
        statusEl.style.color = '#34d399';
        descEl.textContent = 'Guaranteed read-your-writes and monotonic read consistency.';
      } else {
        statusEl.textContent = 'EVENTUAL / WEAK (' + sum + ' <= ' + n + ')';
        statusEl.style.color = '#f59e0b';
        descEl.textContent = 'Warning: Overlap not guaranteed. Possible stale reads or split-brain drift.';
      }

      document.getElementById('res-write-tol').textContent = (n - w) + ' Node(s)';
      document.getElementById('res-read-tol').textContent = (n - r) + ' Node(s)';
    }

    function updateVcDisplay(text) {
      document.getElementById('vc-display').textContent = 'Current Vector Clock: ' + JSON.stringify(vc);
      if (text) {
        document.getElementById('vc-explanation').textContent = text;
      }
    }

    function writeNode(id) {
      vc[id] = (vc[id] || 0) + 1;
      updateVcDisplay('Local write acknowledged on ' + id + '. Version dot assigned: (' + id + ', ' + vc[id] + ').');
    }

    function syncClocks() {
      var maxVal = Math.max(vc['node-a'], vc['node-b'], vc['node-c']);
      vc['node-a'] = maxVal;
      vc['node-b'] = maxVal;
      vc['node-c'] = maxVal;
      updateVcDisplay('Anti-Entropy Merkle exchange reconciled. All replica clocks merged to epoch ' + maxVal + '.');
    }

    function resetClocks() {
      vc = { 'node-a': 0, 'node-b': 0, 'node-c': 0 };
      updateVcDisplay('Cluster state reset to genesis epoch 0.');
    }
  </script>
</body>
</html>`;
}

if (process.argv[1]?.endsWith('main.js') || process.argv[1]?.endsWith('main.ts')) {
  main().catch((err) => {
    console.error('Unhandled bootstrap rejection:', err);
    process.exit(1);
  });
}

export { main };
