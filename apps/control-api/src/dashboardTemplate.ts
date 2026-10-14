/**
 * QUORUM LAB &mdash; Distributed Consensus & Fault Injection Control Plane
 *
 * Implements the unified monochrome design system matching SYSTEM-X:
 * - Collapsible Left Hover Sidebar with Pin toggle
 * - Clean white background, neutral gray borders, deep black typography
 * - Interactive Cluster Topology with live node state toggling
 * - Quorum intersection proof calculator (Pigeonhole principle)
 * - Chaos fault injection simulator (Split-brain, Leader crash, Packet loss)
 * - Vector clock read-repair conflict resolver
 */

export function renderQuorumDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QUORUM LAB &mdash; Distributed Consensus &amp; Chaos Platform</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #ffffff;
      --bg-subtle: #fafafa;
      --bg-card: #ffffff;
      --bg-hover: #f4f4f5;
      --border: #e4e4e7;
      --border-dark: #18181b;
      --text: #09090b;
      --text-muted: #71717a;
      --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --radius-sm: 4px;
      --radius-md: 6px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    a { color: var(--text); text-decoration: underline; text-underline-offset: 3px; }
    a:hover { color: var(--text-muted); }
    code, pre, .mono { font-family: var(--font-mono); font-feature-settings: "tnum"; }

    /* Left Collapsible Hover Sidebar */
    .sidebar {
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      width: 64px;
      background: var(--bg);
      border-right: 1px solid var(--border);
      z-index: 200;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: width 0.22s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.22s ease;
      overflow-x: hidden;
      overflow-y: auto;
      white-space: nowrap;
    }
    .sidebar:hover, body.sidebar-pinned .sidebar {
      width: 250px;
      box-shadow: 4px 0 24px rgba(0, 0, 0, 0.08);
    }

    .sidebar-header {
      height: 60px;
      padding: 0 16px;
      display: flex;
      align-items: center;
      gap: 14px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      flex-shrink: 0;
    }
    .sidebar-logo {
      width: 32px;
      height: 32px;
      background: var(--text);
      color: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 14px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      flex-shrink: 0;
    }
    .sidebar-brand-text {
      opacity: 0;
      transform: translateX(-8px);
      transition: opacity 0.18s ease, transform 0.18s ease;
      pointer-events: none;
    }
    .sidebar:hover .sidebar-brand-text, body.sidebar-pinned .sidebar .sidebar-brand-text {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
    }
    .sidebar-brand-title {
      font-size: 14px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.2;
    }
    .sidebar-brand-sub {
      font-size: 10px;
      color: var(--text-muted);
      font-family: var(--font-mono);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .sidebar-nav {
      padding: 12px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex-grow: 1;
    }

    .side-nav-item {
      width: 100%;
      height: 44px;
      border-radius: var(--radius-sm);
      background: none;
      border: 1px solid transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 0 12px;
      gap: 14px;
      font-family: var(--font-sans);
      font-size: 13px;
      font-weight: 500;
      text-align: left;
      transition: all 0.12s ease;
      position: relative;
    }
    .side-nav-item:hover {
      background: var(--bg-hover);
      color: var(--text);
    }
    .side-nav-item.active {
      background: var(--bg-subtle);
      border-color: var(--border);
      color: var(--text);
      font-weight: 700;
    }
    .side-nav-item.active::before {
      content: '';
      position: absolute;
      left: 0;
      top: 8px;
      bottom: 8px;
      width: 3px;
      background: var(--text);
      border-radius: 0 2px 2px 0;
    }

    .side-nav-icon {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text);
    }

    .side-nav-label-wrap {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: calc(100% - 36px);
      opacity: 0;
      transform: translateX(-8px);
      transition: opacity 0.18s ease, transform 0.18s ease;
      pointer-events: none;
    }
    .sidebar:hover .side-nav-label-wrap, body.sidebar-pinned .sidebar .side-nav-label-wrap {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
    }
    .side-nav-label {
      font-size: 13px;
      white-space: nowrap;
    }
    .side-nav-badge {
      font-size: 10px;
      font-family: var(--font-mono);
      padding: 1px 6px;
      border: 1px solid var(--border);
      border-radius: 10px;
    }

    .sidebar-footer {
      padding: 12px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .sidebar-pin-btn {
      background: none;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      justify-content: center;
    }
    .sidebar-pin-btn:hover {
      background: var(--bg-hover);
      color: var(--text);
    }

    /* Top Sticky Status Bar */
    .top-bar {
      margin-left: 64px;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
      position: sticky;
      top: 0;
      z-index: 100;
      transition: margin-left 0.22s ease;
    }
    .top-bar-inner {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 24px;
      height: 60px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .header-breadcrumb {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .header-breadcrumb span { color: var(--text); font-weight: 600; }

    .header-status {
      display: flex;
      align-items: center;
      gap: 14px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
    }
    .status-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .status-symbol { font-weight: bold; }

    /* Main Container */
    .main-wrap {
      margin-left: 64px;
      max-width: 1400px;
      padding: 24px 32px;
      min-height: calc(100vh - 120px);
      transition: margin-left 0.22s ease;
    }
    .footer {
      margin-left: 64px;
      border-top: 1px solid var(--border);
      padding: 24px 32px;
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: margin-left 0.22s ease;
    }

    body.sidebar-pinned .top-bar,
    body.sidebar-pinned .main-wrap,
    body.sidebar-pinned .footer {
      margin-left: 250px;
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; animation: fadeIn 0.15s ease-out; }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(3px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .page-header {
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    .page-title {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 4px;
    }
    .page-desc {
      color: var(--text-muted);
      font-size: 13px;
      max-width: 850px;
    }

    /* Cards & Grids */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 20px;
      margin-bottom: 20px;
    }
    .card-title {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }
    .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .grid-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; }
    @media (max-width: 1024px) {
      .grid-5 { grid-template-columns: repeat(2, 1fr); }
      .grid-3, .grid-2 { grid-template-columns: 1fr; }
    }

    .stat-box {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 14px 16px;
      background: var(--bg);
    }
    .stat-label {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .stat-val {
      font-size: 20px;
      font-weight: 700;
      font-family: var(--font-mono);
    }
    .stat-desc {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
      font-family: var(--font-mono);
    }

    /* Badges & Buttons */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: 600;
      font-family: var(--font-mono);
      border: 1px solid var(--border);
      background: var(--bg);
      text-transform: uppercase;
    }
    .badge-inverse { background: var(--text); color: var(--bg); border-color: var(--text); }
    .badge-alert { background: #000000; color: #ffffff; border: 1px solid #000000; }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 7px 14px;
      font-size: 13px;
      font-weight: 600;
      font-family: var(--font-sans);
      border-radius: var(--radius-sm);
      cursor: pointer;
      text-decoration: none;
      transition: all 0.12s ease;
    }
    .btn-primary { background: var(--text); color: var(--bg); border: 1px solid var(--text); }
    .btn-primary:hover { background: #27272a; }
    .btn-secondary { background: var(--bg); color: var(--text); border: 1px solid var(--border); }
    .btn-secondary:hover { background: #f4f4f5; }
    .btn-sm { padding: 4px 10px; font-size: 12px; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th {
      background: var(--bg-subtle);
      padding: 9px 12px;
      text-align: left;
      font-weight: 600;
      font-family: var(--font-mono);
      font-size: 11px;
      border-bottom: 1px solid var(--border);
      color: var(--text-muted);
    }
    td { padding: 9px 12px; border-bottom: 1px solid var(--border); font-family: var(--font-mono); }

    /* Node Card Interactive */
    .node-card {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 14px;
      background: var(--bg);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 220px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .node-card.crashed {
      background: #fafafa;
      border-style: dashed;
      opacity: 0.65;
    }
    .node-card.partitioned {
      background: #f4f4f5;
      border-color: #71717a;
    }
    .node-card.leader {
      border: 2px solid var(--text);
    }
  </style>
</head>
<body>

  <!-- Left Collapsible Hover Sidebar -->
  <aside class="sidebar" id="sidebar">
    <div>
      <div class="sidebar-header" onclick="switchTab('cluster')">
        <div class="sidebar-logo">QL</div>
        <div class="sidebar-brand-text">
          <div class="sidebar-brand-title">QUORUM LAB</div>
          <div class="sidebar-brand-sub">Consensus &amp; Chaos</div>
        </div>
      </div>

      <nav class="sidebar-nav">
        <button class="side-nav-item active" id="nav-cluster" onclick="switchTab('cluster')">
          <div class="side-nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><line x1="12" y1="9" x2="19" y2="7"/><line x1="12" y1="9" x2="5" y2="7"/><line x1="12" y1="15" x2="5" y2="17"/><line x1="12" y1="15" x2="19" y2="17"/></svg>
          </div>
          <div class="side-nav-label-wrap">
            <span class="side-nav-label">Cluster Topology</span>
            <span class="side-nav-badge">5 NODES</span>
          </div>
        </button>

        <button class="side-nav-item" id="nav-quorum" onclick="switchTab('quorum')">
          <div class="side-nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/><circle cx="15" cy="15" r="1"/></svg>
          </div>
          <div class="side-nav-label-wrap">
            <span class="side-nav-label">Quorum Proof (R+W&gt;N)</span>
            <span class="side-nav-badge">MATH</span>
          </div>
        </button>

        <button class="side-nav-item" id="nav-faults" onclick="switchTab('faults')">
          <div class="side-nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </div>
          <div class="side-nav-label-wrap">
            <span class="side-nav-label">Chaos &amp; Fault Injection</span>
            <span class="side-nav-badge">SPLIT-BRAIN</span>
          </div>
        </button>

        <button class="side-nav-item" id="nav-consistency" onclick="switchTab('consistency')">
          <div class="side-nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
          </div>
          <div class="side-nav-label-wrap">
            <span class="side-nav-label">Vector Clocks &amp; Repair</span>
            <span class="side-nav-badge">ANTI-ENTROPY</span>
          </div>
        </button>

        <button class="side-nav-item" id="nav-api" onclick="switchTab('api')">
          <div class="side-nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
          </div>
          <div class="side-nav-label-wrap">
            <span class="side-nav-label">Control API &amp; Health</span>
            <span class="side-nav-badge">FASTIFY</span>
          </div>
        </button>
      </nav>
    </div>

    <div class="sidebar-footer">
      <button class="sidebar-pin-btn" id="btn-pin-sidebar" onclick="toggleSidebarPin()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 2l-6 6H4l4 4-6 6 6-6 4 4v-6l6-6-8-2z"/></svg>
        <span>Pin Menu</span>
      </button>
    </div>
  </aside>

  <!-- Top Navigation & Ecosystem Bar -->
  <header class="top-bar">
    <div class="top-bar-inner">
      <div class="header-breadcrumb">
        QUORUM LAB / <span id="topbar-breadcrumb">Cluster Topology</span>
      </div>

      <div class="header-status">
        <div class="status-item"><span class="status-symbol">&bull;</span> QRM: ONLINE</div>
        <div class="status-item"><span class="status-symbol">&bull;</span> SX: ONLINE</div>
        <div class="status-item"><span class="status-symbol">&bull;</span> BBX: ONLINE</div>
        <div class="status-item"><span class="status-symbol">&bull;</span> CRT: ONLINE</div>
        <a href="https://system-x-dashboard.onrender.com" target="_blank" class="btn btn-primary btn-sm" style="margin-left: 8px;">Launch SYSTEM-X &rarr;</a>
      </div>
    </div>
  </header>

  <!-- Main Content Wrap -->
  <main class="main-wrap">

    <!-- 1. CLUSTER TOPOLOGY TAB -->
    <div class="tab-content active" id="tab-cluster">
      <div class="page-header">
        <h1 class="page-title">Distributed Cluster Topology &amp; Consensus Visualizer</h1>
        <p class="page-desc">
          Inspect live node states, Raft leader terms, and commit indexes. Click any node to crash it or inject network partition latency, and observe how quorum membership dynamically protects distributed consistency.
        </p>
      </div>

      <!-- Live Quorum Health Banner -->
      <div class="card" id="quorum-summary-card" style="border-left: 4px solid var(--text);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); text-transform: uppercase;">Consensus State</div>
            <div style="font-size: 16px; font-weight: 700; margin-top: 2px;" id="quorum-summary-text">
              ✓ QUORUM OVERLAP GUARANTEED (5/5 nodes online &bull; Raft Term: 42)
            </div>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="btn btn-secondary btn-sm" onclick="restoreAllNodes()">Restore All Nodes</button>
            <button class="btn btn-primary btn-sm" onclick="switchTab('faults')">Inject Chaos Fault &rarr;</button>
          </div>
        </div>
      </div>

      <!-- 5-Node Interactive Grid -->
      <div class="grid-5" style="margin-bottom: 24px;" id="node-grid">
        <!-- Node 1 (Leader) -->
        <div class="node-card leader" id="card-node-1">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="badge badge-inverse" id="badge-node-1">LEADER</span>
              <span class="mono" style="font-size:11px;" id="stat-node-1">✓ ONLINE</span>
            </div>
            <div style="font-weight: 800; font-size: 15px;">qnode-01</div>
            <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top:2px;">10.0.1.11:50051</div>
            
            <div style="margin-top: 14px; font-size: 11px; font-family: var(--font-mono); line-height: 1.6;">
              <div>Term: <span id="term-node-1">42</span></div>
              <div>Commit Index: <span id="commit-node-1">12,842</span></div>
              <div>Heartbeat: <span id="rtt-node-1">0.8 ms</span></div>
            </div>
          </div>

          <div style="margin-top: 16px; display:flex; flex-direction:column; gap:6px;">
            <button class="btn btn-secondary btn-sm" onclick="toggleNodeCrash(1)" id="btn-crash-1">Crash Node</button>
            <button class="btn btn-secondary btn-sm" onclick="toggleNodePartition(1)" id="btn-part-1">Partition</button>
          </div>
        </div>

        <!-- Node 2 (Follower) -->
        <div class="node-card" id="card-node-2">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="badge" id="badge-node-2">FOLLOWER</span>
              <span class="mono" style="font-size:11px;" id="stat-node-2">✓ ONLINE</span>
            </div>
            <div style="font-weight: 800; font-size: 15px;">qnode-02</div>
            <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top:2px;">10.0.1.12:50051</div>
            
            <div style="margin-top: 14px; font-size: 11px; font-family: var(--font-mono); line-height: 1.6;">
              <div>Term: 42</div>
              <div>Commit Index: 12,842</div>
              <div>Heartbeat: 1.1 ms</div>
            </div>
          </div>

          <div style="margin-top: 16px; display:flex; flex-direction:column; gap:6px;">
            <button class="btn btn-secondary btn-sm" onclick="toggleNodeCrash(2)" id="btn-crash-2">Crash Node</button>
            <button class="btn btn-secondary btn-sm" onclick="toggleNodePartition(2)" id="btn-part-2">Partition</button>
          </div>
        </div>

        <!-- Node 3 (Follower) -->
        <div class="node-card" id="card-node-3">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="badge" id="badge-node-3">FOLLOWER</span>
              <span class="mono" style="font-size:11px;" id="stat-node-3">✓ ONLINE</span>
            </div>
            <div style="font-weight: 800; font-size: 15px;">qnode-03</div>
            <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top:2px;">10.0.1.13:50051</div>
            
            <div style="margin-top: 14px; font-size: 11px; font-family: var(--font-mono); line-height: 1.6;">
              <div>Term: 42</div>
              <div>Commit Index: 12,842</div>
              <div>Heartbeat: 0.9 ms</div>
            </div>
          </div>

          <div style="margin-top: 16px; display:flex; flex-direction:column; gap:6px;">
            <button class="btn btn-secondary btn-sm" onclick="toggleNodeCrash(3)" id="btn-crash-3">Crash Node</button>
            <button class="btn btn-secondary btn-sm" onclick="toggleNodePartition(3)" id="btn-part-3">Partition</button>
          </div>
        </div>

        <!-- Node 4 (Follower) -->
        <div class="node-card" id="card-node-4">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="badge" id="badge-node-4">FOLLOWER</span>
              <span class="mono" style="font-size:11px;" id="stat-node-4">✓ ONLINE</span>
            </div>
            <div style="font-weight: 800; font-size: 15px;">qnode-04</div>
            <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top:2px;">10.0.1.14:50051</div>
            
            <div style="margin-top: 14px; font-size: 11px; font-family: var(--font-mono); line-height: 1.6;">
              <div>Term: 42</div>
              <div>Commit Index: 12,841</div>
              <div>Heartbeat: 1.4 ms</div>
            </div>
          </div>

          <div style="margin-top: 16px; display:flex; flex-direction:column; gap:6px;">
            <button class="btn btn-secondary btn-sm" onclick="toggleNodeCrash(4)" id="btn-crash-4">Crash Node</button>
            <button class="btn btn-secondary btn-sm" onclick="toggleNodePartition(4)" id="btn-part-4">Partition</button>
          </div>
        </div>

        <!-- Node 5 (Follower) -->
        <div class="node-card" id="card-node-5">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="badge" id="badge-node-5">FOLLOWER</span>
              <span class="mono" style="font-size:11px;" id="stat-node-5">✓ ONLINE</span>
            </div>
            <div style="font-weight: 800; font-size: 15px;">qnode-05</div>
            <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top:2px;">10.0.1.15:50051</div>
            
            <div style="margin-top: 14px; font-size: 11px; font-family: var(--font-mono); line-height: 1.6;">
              <div>Term: 42</div>
              <div>Commit Index: 12,842</div>
              <div>Heartbeat: 1.0 ms</div>
            </div>
          </div>

          <div style="margin-top: 16px; display:flex; flex-direction:column; gap:6px;">
            <button class="btn btn-secondary btn-sm" onclick="toggleNodeCrash(5)" id="btn-crash-5">Crash Node</button>
            <button class="btn btn-secondary btn-sm" onclick="toggleNodePartition(5)" id="btn-part-5">Partition</button>
          </div>
        </div>
      </div>

      <!-- Quick Metrics Summary -->
      <div class="grid-3">
        <div class="card">
          <div class="stat-label">Active Membership</div>
          <div class="stat-val" id="metric-alive-count">5 / 5</div>
          <div class="stat-desc">Quorum threshold: &ge; 3 nodes</div>
        </div>
        <div class="card">
          <div class="stat-label">Consensus Protocol</div>
          <div class="stat-val">Raft &bull; Strict</div>
          <div class="stat-desc">Zero stale reads on leader lease</div>
        </div>
        <div class="card">
          <div class="stat-label">Replica Log Lag</div>
          <div class="stat-val">0.2 ms</div>
          <div class="stat-desc">Within replication SLA (&lt; 5ms)</div>
        </div>
      </div>
    </div>

    <!-- 2. QUORUM CALCULATOR TAB -->
    <div class="tab-content" id="tab-quorum">
      <div class="page-header">
        <h1 class="page-title">Quorum Intersection Proof &amp; Policy Calculator</h1>
        <p class="page-desc">
          Verify distributed consistency guarantees mathematically. By the Pigeonhole Principle, if Read Quorum (R) + Write Quorum (W) &gt; Cluster Size (N), every read set intersects with at least one node containing the latest write.
        </p>
      </div>

      <div class="grid-2">
        <!-- Interactive Sliders -->
        <div class="card">
          <div class="card-title">
            <span>Cluster &amp; Quorum Parameters</span>
            <span class="badge">CONFIG</span>
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:6px;">
              <span>Cluster Size (N):</span>
              <span class="mono" id="q-val-n">5</span>
            </label>
            <input type="range" min="3" max="11" step="2" value="5" id="q-inp-n" oninput="calcQuorumProof()" style="width:100%;" />
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:6px;">
              <span>Read Quorum (R):</span>
              <span class="mono" id="q-val-r">3</span>
            </label>
            <input type="range" min="1" max="5" step="1" value="3" id="q-inp-r" oninput="calcQuorumProof()" style="width:100%;" />
          </div>

          <div style="margin-bottom: 20px;">
            <label style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:6px;">
              <span>Write Quorum (W):</span>
              <span class="mono" id="q-val-w">3</span>
            </label>
            <input type="range" min="1" max="5" step="1" value="3" id="q-inp-w" oninput="calcQuorumProof()" style="width:100%;" />
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" onclick="setQuorumPreset(5, 3, 3)">Strict Majority (3/3/5)</button>
            <button class="btn btn-secondary btn-sm" onclick="setQuorumPreset(5, 1, 5)">Fast Read (1/5/5)</button>
            <button class="btn btn-secondary btn-sm" onclick="setQuorumPreset(5, 5, 1)">Fast Write (5/1/5)</button>
            <button class="btn btn-secondary btn-sm" onclick="setQuorumPreset(5, 2, 2)">Sloppy (2/2/5)</button>
          </div>
        </div>

        <!-- Mathematical Proof Card -->
        <div class="card">
          <div class="card-title">
            <span>Mathematical Intersection Analysis</span>
            <span class="badge" id="proof-status-badge">✓ CONSISTENT</span>
          </div>

          <div class="grid-2" style="margin-bottom: 16px;">
            <div class="stat-box">
              <div class="stat-label">R + W Condition</div>
              <div class="stat-val" id="proof-rw-val">6 &gt; 5</div>
              <div class="stat-desc" id="proof-rw-desc">Condition satisfied (R+W &gt; N)</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Guaranteed Overlap</div>
              <div class="stat-val" id="proof-overlap-val">1 Node</div>
              <div class="stat-desc">Pigeonhole intersection &Delta;</div>
            </div>
          </div>

          <div style="padding: 12px; background: var(--bg-subtle); border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 11px; line-height: 1.6;" id="proof-explanation">
            Overlap Formula: (R + W) - N = (3 + 3) - 5 = 1 node.<br/>
            Guarantee: At least 1 node in any read set is guaranteed to possess the authoritative latest write. Linearizable consistency maintained.
          </div>
        </div>
      </div>
    </div>

    <!-- 3. CHAOS & FAULT INJECTION TAB -->
    <div class="tab-content" id="tab-faults">
      <div class="page-header">
        <h1 class="page-title">Chaos Fault Injection Suite</h1>
        <p class="page-desc">
          Test distributed consensus limits under network partitions, leader crashes, and packet drops. Validate epoch fencing and automatic failover.
        </p>
      </div>

      <div class="grid-2" style="margin-bottom: 24px;">
        <!-- Scenario 1: Split-Brain -->
        <div class="card">
          <div class="card-title">
            <span>Scenario A &bull; Network Partition (Split-Brain)</span>
            <span class="badge">MAJORITY GUARD</span>
          </div>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
            Splits the 5-node cluster into Partition A ({qnode-01, qnode-02}) and Partition B ({qnode-03, qnode-04, qnode-05}). Tests whether Partition A safely stops accepting writes while Partition B elects a new leader.
          </p>
          <button class="btn btn-primary" onclick="simulateChaos('split-brain')">Simulate Split-Brain Partition</button>
        </div>

        <!-- Scenario 2: Leader Crash -->
        <div class="card">
          <div class="card-title">
            <span>Scenario B &bull; Sudden Leader Crash</span>
            <span class="badge">RAFT TIMEOUT</span>
          </div>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
            Terminates the active leader (qnode-01) during a replication commit phase. Measures election timeout duration and confirms candidate term increment.
          </p>
          <button class="btn btn-primary" onclick="simulateChaos('leader-crash')">Simulate Leader Crash</button>
        </div>

        <!-- Scenario 3: Packet Drop -->
        <div class="card">
          <div class="card-title">
            <span>Scenario C &bull; 30% Retransmission Jitter</span>
            <span class="badge">HEARTBEAT JITTER</span>
          </div>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
            Injects 250ms packet latency and 30% TCP packet drops between followers. Validates heartbeat retry backoff without triggering spurious re-elections.
          </p>
          <button class="btn btn-primary" onclick="simulateChaos('packet-drop')">Simulate Retransmission Jitter</button>
        </div>

        <!-- Scenario 4: Fast Recovery -->
        <div class="card">
          <div class="card-title">
            <span>Scenario D &bull; Cluster Self-Healing</span>
            <span class="badge">RECONCILIATION</span>
          </div>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
            Heals all network partitions, restarts crashed nodes, and runs catch-up log replication to restore 100% synchronized state.
          </p>
          <button class="btn btn-secondary" onclick="simulateChaos('heal')">Restore Cluster &amp; Catch Up Logs</button>
        </div>
      </div>

      <!-- Chaos Event Log -->
      <div class="card">
        <div class="card-title">
          <span>Consensus Event Log &amp; State Transitions</span>
          <span class="badge">LIVE AUDIT</span>
        </div>
        <div id="chaos-log" style="height: 160px; overflow-y: auto; background: var(--bg-subtle); border: 1px solid var(--border); padding: 12px; font-family: var(--font-mono); font-size: 11px; line-height: 1.6;">
          [00:00:00] Cluster initialized with 5 nodes. Leader: qnode-01 (Term 42).<br/>
          [00:00:01] Heartbeat ticks normal (0.8ms - 1.4ms). Commit index matching across all replicas.<br/>
          [00:00:02] Ready for fault injection.
        </div>
      </div>
    </div>

    <!-- 4. VECTOR CLOCKS & READ-REPAIR TAB -->
    <div class="tab-content" id="tab-consistency">
      <div class="page-header">
        <h1 class="page-title">Vector Clocks &amp; Anti-Entropy Read-Repair</h1>
        <p class="page-desc">
          When concurrent writes occur during network hiccups, vector clocks preserve causal history. Read-repair identifies divergent replicas on client read operations and reconciles them automatically.
        </p>
      </div>

      <div class="grid-2" style="margin-bottom: 24px;">
        <div class="card">
          <div class="card-title">
            <span>Replica Node State &bull; Conflict Inspection</span>
            <span class="badge">DIVERGENCE</span>
          </div>
          <div style="font-family: var(--font-mono); font-size: 12px; margin-bottom: 14px;">
            <div style="padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: 8px;">
              <strong>Node 1 (Stale):</strong><br/>
              Key: <span class="mono">inv:prod_101</span> &bull; Stock: <span id="vclock-val-1">10</span><br/>
              Clock: <span id="vclock-clock-1">[q1: 4, q2: 1]</span>
            </div>
            <div style="padding: 8px; border: 1px solid var(--border); border-radius: var(--radius-sm);">
              <strong>Node 2 (Authoritative):</strong><br/>
              Key: <span class="mono">inv:prod_101</span> &bull; Stock: 9<br/>
              Clock: [q1: 4, q2: 2]
            </div>
          </div>
          <button class="btn btn-primary" onclick="executeReadRepair()" id="btn-read-repair">Execute Read-Repair Reconciliation &rarr;</button>
        </div>

        <div class="card">
          <div class="card-title">
            <span>Causal Analysis &amp; Reconciliation</span>
            <span class="badge" id="repair-badge">CONFLICT DETECTED</span>
          </div>
          <div style="font-size: 12px; line-height: 1.6; font-family: var(--font-mono); background: var(--bg-subtle); padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm);" id="repair-output">
            Causal check: Node 2 clock [q1: 4, q2: 2] dominates Node 1 [q1: 4, q2: 1].<br/>
            Node 1 is missing revision 2 from qnode-02.<br/>
            Read-repair will write back authoritative value 'stock: 9' to Node 1.
          </div>
        </div>
      </div>
    </div>

    <!-- 5. CONTROL API & HEALTH TAB -->
    <div class="tab-content" id="tab-api">
      <div class="page-header">
        <h1 class="page-title">Control API Diagnostics &amp; Routes</h1>
        <p class="page-desc">
          Standard REST &amp; gRPC endpoints provided by the QUORUM LAB control-api service.
        </p>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Active Service Endpoints</span>
          <span class="badge">FASTIFY 5.x</span>
        </div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Route</th>
                <th>Purpose</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>GET</strong></td>
                <td><code>/health</code></td>
                <td>Liveness check</td>
                <td><a href="/health" target="_blank" class="btn btn-secondary btn-sm">Inspect /health</a></td>
              </tr>
              <tr>
                <td><strong>GET</strong></td>
                <td><code>/v1/clusters</code></td>
                <td>List registered clusters</td>
                <td><a href="/v1/clusters" target="_blank" class="btn btn-secondary btn-sm">Inspect /v1/clusters</a></td>
              </tr>
              <tr>
                <td><strong>GET</strong></td>
                <td><code>/v1/projects</code></td>
                <td>List projects</td>
                <td><a href="/v1/projects" target="_blank" class="btn btn-secondary btn-sm">Inspect /v1/projects</a></td>
              </tr>
              <tr>
                <td><strong>GET</strong></td>
                <td><code>/v1/experiments</code></td>
                <td>List distributed experiments</td>
                <td><a href="/v1/experiments" target="_blank" class="btn btn-secondary btn-sm">Inspect /v1/experiments</a></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

  </main>

  <!-- Footer -->
  <footer class="footer">
    <div>QUORUM LAB &bull; Distributed Consensus &amp; Chaos Verification Platform</div>
    <div class="mono">Version 1.0.0 &bull; SYSTEM-X Unified Testing Ecosystem</div>
  </footer>

  <script>
    var nodeStates = [true, true, true, true, true]; // 1-indexed in UI
    var partitionedNodes = [false, false, false, false, false];

    function switchTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
      document.querySelectorAll('.side-nav-item').forEach(function(el) { el.classList.remove('active'); });

      var targetTab = document.getElementById('tab-' + tabId);
      var targetNav = document.getElementById('nav-' + tabId);
      if (targetTab) targetTab.classList.add('active');
      if (targetNav) targetNav.classList.add('active');

      var titles = {
        'cluster': 'Cluster Topology',
        'quorum': 'Quorum Proof (R+W>N)',
        'faults': 'Chaos & Fault Injection',
        'consistency': 'Vector Clocks & Read-Repair',
        'api': 'Control API & Health'
      };
      var bc = document.getElementById('topbar-breadcrumb');
      if (bc && titles[tabId]) bc.textContent = titles[tabId];
    }

    function toggleSidebarPin() {
      document.body.classList.toggle('sidebar-pinned');
      var isPinned = document.body.classList.contains('sidebar-pinned');
      localStorage.setItem('ql_sidebar_pinned', isPinned ? '1' : '0');
    }

    if (localStorage.getItem('ql_sidebar_pinned') === '1') {
      document.body.classList.add('sidebar-pinned');
    }

    function toggleNodeCrash(nodeIdx) {
      var arrIdx = nodeIdx - 1;
      nodeStates[arrIdx] = !nodeStates[arrIdx];
      updateNodeUI(nodeIdx);
      evaluateQuorumHealth();
    }

    function toggleNodePartition(nodeIdx) {
      var arrIdx = nodeIdx - 1;
      partitionedNodes[arrIdx] = !partitionedNodes[arrIdx];
      updateNodeUI(nodeIdx);
      evaluateQuorumHealth();
    }

    function restoreAllNodes() {
      for (var i = 0; i < 5; i++) {
        nodeStates[i] = true;
        partitionedNodes[i] = false;
        updateNodeUI(i + 1);
      }
      evaluateQuorumHealth();
      logEvent('All nodes restored to ONLINE. Quorum membership restored to 5/5.');
    }

    function updateNodeUI(nodeIdx) {
      var arrIdx = nodeIdx - 1;
      var card = document.getElementById('card-node-' + nodeIdx);
      var stat = document.getElementById('stat-node-' + nodeIdx);
      var btnCrash = document.getElementById('btn-crash-' + nodeIdx);
      var btnPart = document.getElementById('btn-part-' + nodeIdx);

      if (!card) return;

      if (!nodeStates[arrIdx]) {
        card.className = 'node-card crashed';
        stat.textContent = '! CRASHED';
        btnCrash.textContent = 'Restore Node';
      } else if (partitionedNodes[arrIdx]) {
        card.className = 'node-card partitioned';
        stat.textContent = '~ ISOLATED';
        btnCrash.textContent = 'Crash Node';
        btnPart.textContent = 'Rejoin';
      } else {
        card.className = nodeIdx === 1 ? 'node-card leader' : 'node-card';
        stat.textContent = '✓ ONLINE';
        btnCrash.textContent = 'Crash Node';
        btnPart.textContent = 'Partition';
      }
    }

    function evaluateQuorumHealth() {
      var activeCount = 0;
      for (var i = 0; i < 5; i++) {
        if (nodeStates[i] && !partitionedNodes[i]) activeCount++;
      }

      var textEl = document.getElementById('quorum-summary-text');
      var metricEl = document.getElementById('metric-alive-count');
      if (metricEl) metricEl.textContent = activeCount + ' / 5';

      if (activeCount >= 3) {
        textEl.textContent = '✓ QUORUM OVERLAP GUARANTEED (' + activeCount + '/5 nodes online • Term: 42)';
        textEl.style.color = 'var(--text)';
      } else {
        textEl.textContent = '! QUORUM LOST (' + activeCount + '/5 nodes online • Writes BLOCKED, Read Quorum Failed)';
        textEl.style.color = '#71717a';
      }
    }

    function calcQuorumProof() {
      var n = parseInt(document.getElementById('q-inp-n').value);
      var r = parseInt(document.getElementById('q-inp-r').value);
      var w = parseInt(document.getElementById('q-inp-w').value);

      document.getElementById('q-val-n').textContent = n;
      document.getElementById('q-val-r').textContent = r;
      document.getElementById('q-val-w').textContent = w;

      var sum = r + w;
      var overlap = sum - n;
      var badge = document.getElementById('proof-status-badge');
      var rwVal = document.getElementById('proof-rw-val');
      var rwDesc = document.getElementById('proof-rw-desc');
      var overlapVal = document.getElementById('proof-overlap-val');
      var expl = document.getElementById('proof-explanation');

      rwVal.textContent = sum + ' ' + (sum > n ? '>' : '<=') + ' ' + n;

      if (sum > n) {
        badge.textContent = '✓ CONSISTENT';
        badge.className = 'badge';
        rwDesc.textContent = 'Strict consistency guaranteed (R+W > N)';
        overlapVal.textContent = overlap + ' Node' + (overlap > 1 ? 's' : '');
        expl.innerHTML = 'Overlap Formula: (R + W) - N = (' + r + ' + ' + w + ') - ' + n + ' = ' + overlap + ' node(s).<br/>' +
          'Guarantee: At least ' + overlap + ' node(s) in any read set are guaranteed to possess the authoritative latest write. No stale reads.';
      } else {
        badge.textContent = '! RISK OF STALE READS';
        badge.className = 'badge badge-alert';
        rwDesc.textContent = 'Weak consistency: Read/Write sets may not overlap';
        overlapVal.textContent = '0 Nodes';
        expl.innerHTML = 'Overlap Formula: (R + W) - N = (' + r + ' + ' + w + ') - ' + n + ' = ' + overlap + ' node(s).<br/>' +
          'Warning: Without overlap, a read request may contact nodes that did not receive the latest write, returning stale data unless resolved by vector clocks or read-repair.';
      }
    }

    function setQuorumPreset(n, r, w) {
      document.getElementById('q-inp-n').value = n;
      document.getElementById('q-inp-r').max = n;
      document.getElementById('q-inp-w').max = n;
      document.getElementById('q-inp-r').value = r;
      document.getElementById('q-inp-w').value = w;
      calcQuorumProof();
    }

    function simulateChaos(type) {
      if (type === 'split-brain') {
        partitionedNodes[0] = true;
        partitionedNodes[1] = true;
        updateNodeUI(1);
        updateNodeUI(2);
        evaluateQuorumHealth();
        logEvent('CHAOS: Symmetric Network Partition injected. Minority {qnode-01, qnode-02} isolated.');
        logEvent('CONSENSUS: Minority partition rejected client writes (2/5 < Quorum threshold 3).');
        logEvent('LEADER: Majority partition {qnode-03, qnode-04, qnode-05} elected qnode-03 as new leader (Term 43).');
      } else if (type === 'leader-crash') {
        nodeStates[0] = false;
        updateNodeUI(1);
        evaluateQuorumHealth();
        logEvent('CHAOS: Leader qnode-01 crashed unexpectedly during commit phase.');
        logEvent('HEARTBEAT: Follower election timer expired after 180ms.');
        logEvent('ELECTION: qnode-02 stepped up as Candidate, received 3 votes, became new Leader for Term 43.');
      } else if (type === 'packet-drop') {
        logEvent('CHAOS: 30% TCP packet drop and 250ms synthetic latency injected across followers.');
        logEvent('MONITOR: Replication latency spiked to 258ms. Quorum writes succeeded via earliest responding majority.');
      } else if (type === 'heal') {
        restoreAllNodes();
        logEvent('HEAL: Network healed. Stale logs catch-up replication completed via Raft AppendEntries RPC.');
      }
    }

    function logEvent(msg) {
      var log = document.getElementById('chaos-log');
      var now = new Date().toTimeString().split(' ')[0];
      log.innerHTML += '<br/>[' + now + '] ' + msg;
      log.scrollTop = log.scrollHeight;
    }

    function executeReadRepair() {
      var valEl = document.getElementById('vclock-val-1');
      var clockEl = document.getElementById('vclock-clock-1');
      var badge = document.getElementById('repair-badge');
      var out = document.getElementById('repair-output');

      valEl.textContent = '9';
      clockEl.textContent = '[q1: 4, q2: 2]';
      badge.textContent = '✓ RECONCILED';
      badge.className = 'badge';

      out.innerHTML = 'Read-Repair Complete:<br/>' +
        '&bull; Stale replica Node 1 updated to latest value: 9<br/>' +
        '&bull; Vector clock updated to authoritative timestamp [q1: 4, q2: 2]<br/>' +
        '&bull; Anti-entropy verified across all cluster replicas with zero data loss.';
    }
  </script>
</body>
</html>`;
}
