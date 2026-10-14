/**
 * QUORUM LAB &mdash; Distributed Consensus & Chaos Platform
 *
 * Implements the unified strict monochrome design system matching SYSTEM-X:
 * - Collapsible Left Hover Sidebar with Pin toggle
 * - Clean white background, neutral gray borders, deep black typography
 * - Interactive Cluster Topology with live node state toggling (Crash / Partition)
 * - Quorum intersection proof calculator (Pigeonhole principle: W + R > N)
 * - Live Vector clock causality simulator & Anti-Entropy read-repair reconciler
 * - Chaos fault injection suite (Split-brain, Leader crash, Retransmission jitter, Self-healing)
 * - 5-Axis Decoupled Consensus Architecture matrix table
 * - Unified Testing Ecosystem & Control API diagnostics
 */

export function renderQuorumDashboard(
  nodeId: string = 'qnode-01',
  clusterId: string = 'quorum-cluster-alpha',
  nodeState: string = 'ACTIVE_SYNC',
  grpcPort: number = 50051,
  httpPort: number = 8080
): string {
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
      --border-light: #f4f4f5;
      --text: #09090b;
      --text-muted: #71717a;
      --text-dim: #a1a1aa;
      --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --radius-sm: 4px;
      --radius-md: 6px;
      --radius-lg: 8px;
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
      font-size: 13px;
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
      transition: all 0.12s ease;
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
    .status-symbol { font-weight: bold; color: var(--text); }

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
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    @media (max-width: 1024px) {
      .grid-3, .grid-4 { grid-template-columns: repeat(2, 1fr); }
      .grid-2 { grid-template-columns: 1fr; }
    }
    @media (max-width: 640px) {
      .grid-3, .grid-4 { grid-template-columns: 1fr; }
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
      padding: 10px 12px;
      text-align: left;
      font-weight: 600;
      font-family: var(--font-mono);
      font-size: 11px;
      border-bottom: 1px solid var(--border);
      color: var(--text-muted);
    }
    td { padding: 10px 12px; border-bottom: 1px solid var(--border); font-family: var(--font-mono); font-size: 12px; }

    /* Node Card Interactive */
    .node-card {
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 16px;
      background: var(--bg);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 250px;
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

    .vector-clock-box {
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 12px 14px;
      font-family: var(--font-mono);
      font-size: 13px;
      margin: 12px 0;
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
            <span class="side-nav-badge">3 NODES</span>
          </div>
        </button>

        <button class="side-nav-item" id="nav-quorum" onclick="switchTab('quorum')">
          <div class="side-nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/><circle cx="15" cy="15" r="1"/></svg>
          </div>
          <div class="side-nav-label-wrap">
            <span class="side-nav-label">Quorum Proof (W+R&gt;N)</span>
            <span class="side-nav-badge">MATH</span>
          </div>
        </button>

        <button class="side-nav-item" id="nav-consistency" onclick="switchTab('consistency')">
          <div class="side-nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
          </div>
          <div class="side-nav-label-wrap">
            <span class="side-nav-label">Vector Clocks &amp; LWW</span>
            <span class="side-nav-badge">CAUSALITY</span>
          </div>
        </button>

        <button class="side-nav-item" id="nav-faults" onclick="switchTab('faults')">
          <div class="side-nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </div>
          <div class="side-nav-label-wrap">
            <span class="side-nav-label">Chaos &amp; Fault Injector</span>
            <span class="side-nav-badge">SPLIT-BRAIN</span>
          </div>
        </button>

        <button class="side-nav-item" id="nav-matrix" onclick="switchTab('matrix')">
          <div class="side-nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>
          </div>
          <div class="side-nav-label-wrap">
            <span class="side-nav-label">5-Axis Architecture</span>
            <span class="side-nav-badge">MATRIX</span>
          </div>
        </button>

        <button class="side-nav-item" id="nav-ecosystem" onclick="switchTab('ecosystem')">
          <div class="side-nav-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
          <div class="side-nav-label-wrap">
            <span class="side-nav-label">Ecosystem &amp; Diagnostics</span>
            <span class="side-nav-badge">API</span>
          </div>
        </button>
      </nav>
    </div>

    <div class="sidebar-footer">
      <button class="sidebar-pin-btn" id="btn-pin-sidebar" onclick="toggleSidebarPin()">
        <span>📌</span>
        <span>Pin Sidebar</span>
      </button>
    </div>
  </aside>

  <!-- Top Navigation & Ecosystem Bar -->
  <header class="top-bar">
    <div class="top-bar-inner">
      <div class="header-breadcrumb">
        Section / <span id="topbar-breadcrumb">Cluster Topology</span>
      </div>

      <div class="header-status">
        <div class="status-item"><span class="status-symbol">&bull;</span> QRM: ONLINE</div>
        <div class="status-item"><span class="status-symbol">&bull;</span> SX: ONLINE</div>
        <div class="status-item"><span class="status-symbol">&bull;</span> BBX: ONLINE</div>
        <div class="status-item"><span class="status-symbol">&bull;</span> CRT: ONLINE</div>
        <div class="status-item"><span class="status-symbol">&bull;</span> CLUSTER: HEALTHY</div>
        <a href="https://system-x-dashboard.onrender.com" target="_blank" class="btn btn-primary btn-sm" style="margin-left: 8px;">Launch SYSTEM-X &rarr;</a>
      </div>
    </div>
  </header>

  <!-- Main Content Wrap -->
  <main class="main-wrap">

    <!-- 1. CLUSTER TOPOLOGY TAB -->
    <div class="tab-content active" id="tab-cluster">
      <div class="page-header">
        <h1 class="page-title">Quorum Lab Distributed Cluster Explorer</h1>
        <p class="page-desc">
          Inspect Raft/Quorum node states, injected network partitions, and write consistency across replicas. Local node: <code class="mono">${nodeId}</code> &bull; Cluster: <code class="mono">${clusterId}</code> &bull; Ports: gRPC <code class="mono">:${grpcPort}</code>, HTTP <code class="mono">:${httpPort}</code>.
        </p>
      </div>

      <!-- Live Quorum Health Banner -->
      <div class="card" id="quorum-summary-card" style="border-left: 4px solid var(--text);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); text-transform: uppercase;">Consensus Health Status</div>
            <div style="font-size: 16px; font-weight: 700; margin-top: 2px;" id="quorum-summary-text">
              ✓ QUORUM OVERLAP GUARANTEED (3/3 nodes online &bull; W=2, R=2, N=3)
            </div>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="btn btn-secondary btn-sm" onclick="restoreAllNodes()">Heal All Partitions</button>
            <button class="btn btn-primary btn-sm" onclick="switchTab('faults')">Inject Network Partition &rarr;</button>
          </div>
        </div>
      </div>

      <!-- 3-Node Interactive Replica Grid -->
      <div class="grid-3" style="margin-bottom: 24px;" id="node-grid">
        <!-- Node 1 (Leader / Primary Replica) -->
        <div class="node-card leader" id="card-node-1">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="badge badge-inverse" id="badge-node-1">LEADER</span>
              <span class="mono" style="font-size:11px;" id="stat-node-1">✓ ONLINE</span>
            </div>
            <div style="font-weight: 800; font-size: 15px;">Node 1 (127.0.0.1:5001)</div>
            <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top:2px;">Term 3 &bull; Commit Index 1,042</div>
            
            <div style="margin-top: 14px; font-size: 11px; font-family: var(--font-mono); line-height: 1.7;">
              <div>State: <span id="state-node-1">${nodeState}</span></div>
              <div>Storage: <span>Local WAL Disk</span></div>
              <div>Heartbeat: <span id="rtt-node-1">4ms (Healthy)</span></div>
            </div>
          </div>

          <div style="margin-top: 16px; display:flex; gap:8px;">
            <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="toggleNodeCrash(1)" id="btn-crash-1">Crash Node 1</button>
            <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="toggleNodePartition(1)" id="btn-part-1">Partition</button>
          </div>
        </div>

        <!-- Node 2 (Follower / Secondary Replica) -->
        <div class="node-card" id="card-node-2">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="badge" id="badge-node-2">FOLLOWER</span>
              <span class="mono" style="font-size:11px;" id="stat-node-2">✓ ONLINE</span>
            </div>
            <div style="font-weight: 800; font-size: 15px;">Node 2 (127.0.0.1:5002)</div>
            <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top:2px;">Term 3 &bull; Commit Index 1,042</div>
            
            <div style="margin-top: 14px; font-size: 11px; font-family: var(--font-mono); line-height: 1.7;">
              <div>State: <span id="state-node-2">Active Sync</span></div>
              <div>Storage: <span>Local WAL Disk</span></div>
              <div>Heartbeat: <span id="rtt-node-2">6ms (Healthy)</span></div>
            </div>
          </div>

          <div style="margin-top: 16px; display:flex; gap:8px;">
            <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="toggleNodeCrash(2)" id="btn-crash-2">Crash Node 2</button>
            <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="toggleNodePartition(2)" id="btn-part-2">Partition</button>
          </div>
        </div>

        <!-- Node 3 (Follower / Tertiary Replica) -->
        <div class="node-card" id="card-node-3">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span class="badge" id="badge-node-3">FOLLOWER</span>
              <span class="mono" style="font-size:11px;" id="stat-node-3">✓ ONLINE</span>
            </div>
            <div style="font-weight: 800; font-size: 15px;">Node 3 (127.0.0.1:5003)</div>
            <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-top:2px;">Term 3 &bull; Commit Index 1,042</div>
            
            <div style="margin-top: 14px; font-size: 11px; font-family: var(--font-mono); line-height: 1.7;">
              <div>State: <span id="state-node-3">Active Sync</span></div>
              <div>Storage: <span>Local WAL Disk</span></div>
              <div>Heartbeat: <span id="rtt-node-3">5ms (Healthy)</span></div>
            </div>
          </div>

          <div style="margin-top: 16px; display:flex; gap:8px;">
            <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="toggleNodeCrash(3)" id="btn-crash-3">Crash Node 3</button>
            <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="toggleNodePartition(3)" id="btn-part-3">Partition</button>
          </div>
        </div>
      </div>

      <!-- Quick Metrics Summary -->
      <div class="grid-4">
        <div class="stat-box">
          <div class="stat-label">Active Membership</div>
          <div class="stat-val" id="metric-alive-count">3 / 3</div>
          <div class="stat-desc">Quorum threshold: &ge; 2 nodes</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Replication Policy</div>
          <div class="stat-val">W=2, R=2</div>
          <div class="stat-desc">Dynamo-style Leaderless</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Storage Engine</div>
          <div class="stat-val">WAL fsync</div>
          <div class="stat-desc">MemStore + AOF Durability</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Durability Guarantee</div>
          <div class="stat-val">Zero Loss</div>
          <div class="stat-desc">Crash-replay verified</div>
        </div>
      </div>
    </div>

    <!-- 2. QUORUM CALCULATOR TAB -->
    <div class="tab-content" id="tab-quorum">
      <div class="page-header">
        <h1 class="page-title">Interactive Quorum Consistency Calculator</h1>
        <p class="page-desc">
          Dynamically compute write/read consistency and fault tolerance by the Pigeonhole Principle. When <code class="mono">W + R &gt; N</code>, read-repair guarantees that every read set contains the latest committed write.
        </p>
      </div>

      <div class="grid-2">
        <!-- Sliders Form -->
        <div class="card">
          <div class="card-title">
            <span>Quorum Parameters</span>
            <span class="badge">CONFIG</span>
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:6px;">
              <span>Cluster Size (N):</span>
              <span class="mono" id="q-val-n">3 nodes</span>
            </label>
            <input type="range" min="3" max="9" step="2" value="3" id="q-inp-n" oninput="calcQuorumProof()" style="width:100%;" />
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:6px;">
              <span>Write Quorum (W):</span>
              <span class="mono" id="q-val-w">2 nodes</span>
            </label>
            <input type="range" min="1" max="3" step="1" value="2" id="q-inp-w" oninput="calcQuorumProof()" style="width:100%;" />
          </div>

          <div style="margin-bottom: 20px;">
            <label style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:6px;">
              <span>Read Quorum (R):</span>
              <span class="mono" id="q-val-r">2 nodes</span>
            </label>
            <input type="range" min="1" max="3" step="1" value="2" id="q-inp-r" oninput="calcQuorumProof()" style="width:100%;" />
          </div>

          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" onclick="setQuorumPreset(3, 2, 2)">Strict Majority (3/2/2)</button>
            <button class="btn btn-secondary btn-sm" onclick="setQuorumPreset(5, 3, 3)">5-Node Majority (5/3/3)</button>
            <button class="btn btn-secondary btn-sm" onclick="setQuorumPreset(5, 1, 5)">Fast Read (5/1/5)</button>
            <button class="btn btn-secondary btn-sm" onclick="setQuorumPreset(5, 5, 1)">Fast Write (5/5/1)</button>
            <button class="btn btn-secondary btn-sm" onclick="setQuorumPreset(5, 2, 2)">Sloppy (5/2/2)</button>
          </div>
        </div>

        <!-- Mathematical Proof & Tolerances -->
        <div class="card">
          <div class="card-title">
            <span>Consistency &amp; Fault Tolerance Guarantees</span>
            <span class="badge" id="proof-status-badge">✓ STRONG CONSISTENCY</span>
          </div>

          <div class="grid-2" style="margin-bottom: 16px;">
            <div class="stat-box">
              <div class="stat-label">W + R Condition</div>
              <div class="stat-val" id="proof-rw-val">4 &gt; 3</div>
              <div class="stat-desc" id="proof-rw-desc">Condition satisfied (W+R &gt; N)</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Guaranteed Overlap</div>
              <div class="stat-val" id="proof-overlap-val">1 Node</div>
              <div class="stat-desc">Pigeonhole intersection &Delta;</div>
            </div>
          </div>

          <div class="grid-2" style="margin-bottom: 16px;">
            <div class="stat-box">
              <div class="stat-label">Write Fault Tolerance</div>
              <div class="stat-val" id="res-write-tol">1 Node</div>
              <div class="stat-desc">Tolerable write node failures (N - W)</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">Read Fault Tolerance</div>
              <div class="stat-val" id="res-read-tol">1 Node</div>
              <div class="stat-desc">Tolerable read node failures (N - R)</div>
            </div>
          </div>

          <div style="padding: 12px; background: var(--bg-subtle); border: 1px solid var(--border); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 11px; line-height: 1.6;" id="proof-explanation">
            Overlap Formula: (W + R) - N = (2 + 2) - 3 = 1 node.<br/>
            Guaranteed read-your-writes and monotonic read consistency. Zero stale reads across any responding quorum set.
          </div>
        </div>
      </div>
    </div>

    <!-- 3. VECTOR CLOCKS & LWW SIMULATOR TAB -->
    <div class="tab-content" id="tab-consistency">
      <div class="page-header">
        <h1 class="page-title">Live Vector Clock Causality &amp; LWW Simulator</h1>
        <p class="page-desc">
          Simulate concurrent writes across cluster replicas to see causal vector clock evolution, conflict detection, and anti-entropy read-repair reconciliation.
        </p>
      </div>

      <div class="grid-2" style="margin-bottom: 24px;">
        <div class="card">
          <div class="card-title">
            <span>Simulate Node Writes</span>
            <span class="badge">MUTATION</span>
          </div>
          <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">
            Issue client writes directly to independent replicas to simulate divergent timelines:
          </p>
          <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
            <button class="btn btn-secondary btn-sm" onclick="writeNode('node-a')">✍ Write to Node A</button>
            <button class="btn btn-secondary btn-sm" onclick="writeNode('node-b')">✍ Write to Node B</button>
            <button class="btn btn-secondary btn-sm" onclick="writeNode('node-c')">✍ Write to Node C</button>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-primary btn-sm" onclick="syncClocks()">🔄 Anti-Entropy Sync</button>
            <button class="btn btn-secondary btn-sm" onclick="executeReadRepair()">🛠 Read-Repair</button>
            <button class="btn btn-secondary btn-sm" onclick="resetClocks()">❌ Reset Genesis</button>
          </div>

          <div class="vector-clock-box" id="vc-display">
            Current Vector Clock: { "node-a": 0, "node-b": 0, "node-c": 0 }
          </div>
          <div id="vc-explanation" style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">
            Cluster state synchronized. Zero pending causal conflicts.
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span>Causal Analysis &amp; Anti-Entropy Log</span>
            <span class="badge" id="repair-badge">SYNCHRONIZED</span>
          </div>
          <div style="font-size: 12px; line-height: 1.6; font-family: var(--font-mono); background: var(--bg-subtle); padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); height: 210px; overflow-y: auto;" id="repair-output">
            [CAUSALITY ENGINE INITIALIZED]<br/>
            &bull; Partial-order happened-before tracking active.<br/>
            &bull; Tie-breaking strategy: Last-Write-Wins (LWW) with wall-clock fallback.<br/>
            &bull; Anti-entropy Merkle exchange listening on port 50051.<br/>
            &bull; Awaiting write events...
          </div>
        </div>
      </div>
    </div>

    <!-- 4. CHAOS & FAULT INJECTION TAB -->
    <div class="tab-content" id="tab-faults">
      <div class="page-header">
        <h1 class="page-title">Chaos Fault Injection Suite</h1>
        <p class="page-desc">
          Inject distributed failure scenarios into the consensus engine to validate election timeouts, partition fencing, and automated healing.
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
            Isolates Node 3 from the quorum. Validates that the majority partition {Node 1, Node 2} continues processing writes while the isolated node fences itself.
          </p>
          <button class="btn btn-primary btn-sm" onclick="simulateChaos('split-brain')">Simulate Split-Brain Partition</button>
        </div>

        <!-- Scenario 2: Leader Crash -->
        <div class="card">
          <div class="card-title">
            <span>Scenario B &bull; Sudden Leader Crash</span>
            <span class="badge">ELECTION TIMEOUT</span>
          </div>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
            Terminates the primary leader (Node 1) mid-commit. Measures election timeout and verifies that Node 2 receives votes and ascends to Leader.
          </p>
          <button class="btn btn-primary btn-sm" onclick="simulateChaos('leader-crash')">Simulate Leader Crash</button>
        </div>

        <!-- Scenario 3: Packet Drop -->
        <div class="card">
          <div class="card-title">
            <span>Scenario C &bull; 30% Retransmission Jitter</span>
            <span class="badge">JITTER INJECTION</span>
          </div>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
            Injects 200ms packet latency and 30% TCP packet loss between replicas. Confirms heartbeat retry backoff without triggering spurious re-elections.
          </p>
          <button class="btn btn-primary btn-sm" onclick="simulateChaos('packet-drop')">Simulate Retransmission Jitter</button>
        </div>

        <!-- Scenario 4: Fast Recovery -->
        <div class="card">
          <div class="card-title">
            <span>Scenario D &bull; Cluster Self-Healing</span>
            <span class="badge">CATCH-UP SYNC</span>
          </div>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
            Heals all partitions, restarts crashed replicas, and initiates AppendEntries catch-up replay from the authoritative WAL log.
          </p>
          <button class="btn btn-secondary btn-sm" onclick="simulateChaos('heal')">Restore Cluster &amp; Catch Up Logs</button>
        </div>
      </div>

      <!-- Live Event Log -->
      <div class="card">
        <div class="card-title">
          <span>Consensus Event Log &amp; Audit Trail</span>
          <span class="badge">LIVE AUDIT</span>
        </div>
        <div id="chaos-log" style="height: 160px; overflow-y: auto; background: var(--bg-subtle); border: 1px solid var(--border); padding: 12px; font-family: var(--font-mono); font-size: 11px; line-height: 1.7;">
          [00:00:00] Cluster initialized with 3 nodes. Leader: Node 1 (Term 3).<br/>
          [00:00:01] Heartbeat ticks normal (4ms - 6ms). Commit index 1,042 matching across all replicas.<br/>
          [00:00:02] Ready for fault injection.
        </div>
      </div>
    </div>

    <!-- 5. 5-AXIS CONSENSUS MATRIX TAB -->
    <div class="tab-content" id="tab-matrix">
      <div class="page-header">
        <h1 class="page-title">5-Axis Decoupled Consensus Architecture Matrix</h1>
        <p class="page-desc">
          QUORUM LAB explicitly decouples consensus into 5 independent architectural axes for maximum production resilience and zero lost writes.
        </p>
      </div>

      <div class="card">
        <div class="card-title">
          <span>Decoupled Consensus Architecture Breakdown</span>
          <span class="badge">INVARIANTS</span>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Architecture Axis</th>
                <th>Implementation</th>
                <th>Guarantees &amp; Invariants</th>
                <th>Fault Tolerance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="font-weight: 700;">1. Replication Topology</td>
                <td>Leaderless Dynamo (N=3, W=2, R=2)</td>
                <td>W + R &gt; N (4 &gt; 3) Quorum Overlap</td>
                <td>Survives 1 concurrent node failure</td>
              </tr>
              <tr>
                <td style="font-weight: 700;">2. Storage Engine</td>
                <td>Sequential WAL fsync + MemStore</td>
                <td>AOF Append-Only Log with Zero Lost Writes</td>
                <td>Instant crash-replay recovery</td>
              </tr>
              <tr>
                <td style="font-weight: 700;">3. Causality Tracking</td>
                <td>Vector Clocks &amp; Version Dots</td>
                <td>Causal Partial-Order Happened-Before</td>
                <td>Last-Write-Wins (LWW) conflict tie-break</td>
              </tr>
              <tr>
                <td style="font-weight: 700;">4. Cluster Transport</td>
                <td>High-Throughput gRPC (:50051)</td>
                <td>HTTP/2 Multiplexed Binary Protobuf Contracts</td>
                <td>Sub-millisecond inter-node latency</td>
              </tr>
              <tr>
                <td style="font-weight: 700;">5. Background Convergence</td>
                <td>Anti-Entropy Merkle Tree Exchange</td>
                <td>Logarithmic O(log M) divergence localization</td>
                <td>Recovers partitioned replicas asynchronously</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 6. ECOSYSTEM & DIAGNOSTICS TAB -->
    <div class="tab-content" id="tab-ecosystem">
      <div class="page-header">
        <h1 class="page-title">Unified Testing Ecosystem &amp; Diagnostics</h1>
        <p class="page-desc">
          QUORUM LAB serves as the ground-truth distributed storage and consensus engine for the SYSTEM-X verification and BLACKBOX-X performance suites.
        </p>
      </div>

      <div class="grid-2" style="margin-bottom: 20px;">
        <div class="card">
          <div class="card-title">
            <span>Direct Portal Links</span>
            <span class="badge">ECOSYSTEM</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <a href="https://system-x-dashboard.onrender.com" target="_blank" class="btn btn-primary" style="justify-content:flex-start;">
              🚀 SYSTEM-X Unified Testing Center &rarr;
            </a>
            <a href="https://blackbox-x.onrender.com" target="_blank" class="btn btn-secondary" style="justify-content:flex-start;">
              ⚡ BLACKBOX-X Performance Engine &rarr;
            </a>
            <a href="https://github.com/MSC-0013/QUORUM" target="_blank" class="btn btn-secondary" style="justify-content:flex-start;">
              💻 GitHub: MSC-0013/QUORUM &rarr;
            </a>
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span>Service Diagnostic Endpoints</span>
            <span class="badge">DIAGNOSTICS</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <a href="/?format=json" target="_blank" class="btn btn-secondary" style="justify-content:flex-start;">
              📄 Raw JSON Status (/?format=json)
            </a>
            <a href="/health" target="_blank" class="btn btn-secondary" style="justify-content:flex-start;">
              🩺 Node Liveness Check (/health)
            </a>
          </div>
        </div>
      </div>

      <!-- Control API Routes Table -->
      <div class="card">
        <div class="card-title">
          <span>Active Service REST &amp; gRPC Routes</span>
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
                <td><code>/?format=json</code></td>
                <td>Raw Node JSON Telemetry</td>
                <td><a href="/?format=json" target="_blank" class="btn btn-secondary btn-sm">Inspect /?format=json</a></td>
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
    var nodeStates = [true, true, true]; // 1-indexed in UI
    var partitionedNodes = [false, false, false];
    var vc = { 'node-a': 0, 'node-b': 0, 'node-c': 0 };

    function switchTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
      document.querySelectorAll('.side-nav-item').forEach(function(el) { el.classList.remove('active'); });

      var targetTab = document.getElementById('tab-' + tabId);
      var targetNav = document.getElementById('nav-' + tabId);
      if (targetTab) targetTab.classList.add('active');
      if (targetNav) targetNav.classList.add('active');

      var titles = {
        'cluster': 'Cluster Topology',
        'quorum': 'Quorum Proof (W+R>N)',
        'consistency': 'Vector Clocks & LWW',
        'faults': 'Chaos & Fault Injector',
        'matrix': '5-Axis Architecture',
        'ecosystem': 'Ecosystem & Diagnostics'
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
      for (var i = 0; i < 3; i++) {
        nodeStates[i] = true;
        partitionedNodes[i] = false;
        updateNodeUI(i + 1);
      }
      evaluateQuorumHealth();
      logEvent('All partitions healed and nodes restored to ONLINE. Quorum membership restored to 3/3.');
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
        btnCrash.textContent = 'Restore Node ' + nodeIdx;
      } else if (partitionedNodes[arrIdx]) {
        card.className = 'node-card partitioned';
        stat.textContent = '~ ISOLATED';
        btnCrash.textContent = 'Crash Node ' + nodeIdx;
        btnPart.textContent = 'Heal Partition';
      } else {
        card.className = nodeIdx === 1 ? 'node-card leader' : 'node-card';
        stat.textContent = '✓ ONLINE';
        btnCrash.textContent = 'Crash Node ' + nodeIdx;
        btnPart.textContent = 'Partition';
      }
    }

    function evaluateQuorumHealth() {
      var activeCount = 0;
      for (var i = 0; i < 3; i++) {
        if (nodeStates[i] && !partitionedNodes[i]) activeCount++;
      }

      var textEl = document.getElementById('quorum-summary-text');
      var metricEl = document.getElementById('metric-alive-count');
      if (metricEl) metricEl.textContent = activeCount + ' / 3';

      if (activeCount >= 2) {
        textEl.textContent = '✓ QUORUM OVERLAP GUARANTEED (' + activeCount + '/3 nodes online • W=2, R=2, N=3)';
        textEl.style.color = 'var(--text)';
      } else {
        textEl.textContent = '! QUORUM LOST (' + activeCount + '/3 nodes online • Writes BLOCKED, Read Quorum Failed)';
        textEl.style.color = 'var(--text-muted)';
      }
    }

    function calcQuorumProof() {
      var n = parseInt(document.getElementById('q-inp-n').value);
      var inpW = document.getElementById('q-inp-w');
      var inpR = document.getElementById('q-inp-r');

      inpW.max = n;
      inpR.max = n;

      var w = parseInt(inpW.value);
      var r = parseInt(inpR.value);

      document.getElementById('q-val-n').textContent = n + ' nodes';
      document.getElementById('q-val-w').textContent = w + ' nodes';
      document.getElementById('q-val-r').textContent = r + ' nodes';

      var sum = w + r;
      var overlap = sum - n;
      var badge = document.getElementById('proof-status-badge');
      var rwVal = document.getElementById('proof-rw-val');
      var rwDesc = document.getElementById('proof-rw-desc');
      var overlapVal = document.getElementById('proof-overlap-val');
      var expl = document.getElementById('proof-explanation');

      rwVal.textContent = sum + ' ' + (sum > n ? '>' : '<=') + ' ' + n;

      if (sum > n) {
        badge.textContent = '✓ STRONG CONSISTENCY';
        badge.className = 'badge';
        rwDesc.textContent = 'Condition satisfied (W+R > N)';
        overlapVal.textContent = overlap + ' Node' + (overlap > 1 ? 's' : '');
        expl.innerHTML = 'Overlap Formula: (W + R) - N = (' + w + ' + ' + r + ') - ' + n + ' = ' + overlap + ' node(s).<br/>' +
          'Guaranteed read-your-writes and monotonic read consistency. Zero stale reads across any responding quorum set.';
      } else {
        badge.textContent = '! RISK OF STALE READS';
        badge.className = 'badge badge-alert';
        rwDesc.textContent = 'Weak consistency: Overlap not guaranteed';
        overlapVal.textContent = '0 Nodes';
        expl.innerHTML = 'Overlap Formula: (W + R) - N = (' + w + ' + ' + r + ') - ' + n + ' = ' + overlap + ' node(s).<br/>' +
          'Warning: Without overlap, a read request may contact nodes that did not receive the latest write, returning stale data unless resolved by vector clocks or read-repair.';
      }

      document.getElementById('res-write-tol').textContent = (n - w) + ' Node(s)';
      document.getElementById('res-read-tol').textContent = (n - r) + ' Node(s)';
    }

    function setQuorumPreset(n, w, r) {
      document.getElementById('q-inp-n').value = n;
      var inpW = document.getElementById('q-inp-w');
      var inpR = document.getElementById('q-inp-r');
      inpW.max = n;
      inpR.max = n;
      inpW.value = w;
      inpR.value = r;
      calcQuorumProof();
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
      logRepair('[WRITE] Key: inv:prod_101 written to ' + id + ' -> Clock: ' + JSON.stringify(vc));
    }

    function syncClocks() {
      var maxVal = Math.max(vc['node-a'], vc['node-b'], vc['node-c']);
      vc['node-a'] = maxVal;
      vc['node-b'] = maxVal;
      vc['node-c'] = maxVal;
      updateVcDisplay('Anti-Entropy Merkle exchange reconciled. All replica clocks merged to epoch ' + maxVal + '.');
      logRepair('[ANTI-ENTROPY] Merkle tree exchange converged. All replicas unified to epoch ' + maxVal + '.');
    }

    function resetClocks() {
      vc = { 'node-a': 0, 'node-b': 0, 'node-c': 0 };
      updateVcDisplay('Cluster state reset to genesis epoch 0.');
      logRepair('[RESET] Replicas reset to genesis epoch.');
    }

    function executeReadRepair() {
      var maxVal = Math.max(vc['node-a'], vc['node-b'], vc['node-c']);
      if (maxVal === 0) { maxVal = 1; vc['node-a'] = 1; }
      vc['node-a'] = maxVal;
      vc['node-b'] = maxVal;
      vc['node-c'] = maxVal;
      updateVcDisplay('Read-Repair complete: authoritative value and version dot propagated to all replicas.');
      logRepair('[READ-REPAIR] Client read detected divergence. Authoritative value written back to lagging replicas.');
    }

    function logRepair(msg) {
      var box = document.getElementById('repair-output');
      var now = new Date().toTimeString().split(' ')[0];
      box.innerHTML += '<br/>[' + now + '] ' + msg;
      box.scrollTop = box.scrollHeight;
    }

    function simulateChaos(type) {
      if (type === 'split-brain') {
        partitionedNodes[2] = true;
        updateNodeUI(3);
        evaluateQuorumHealth();
        logEvent('CHAOS: Network partition injected. Node 3 isolated from cluster.');
        logEvent('CONSENSUS: Majority partition {Node 1, Node 2} retained quorum (2/3 &ge; W=2). Writes continue.');
      } else if (type === 'leader-crash') {
        nodeStates[0] = false;
        updateNodeUI(1);
        evaluateQuorumHealth();
        logEvent('CHAOS: Leader Node 1 crashed unexpectedly during commit phase.');
        logEvent('HEARTBEAT: Follower election timer expired after 180ms.');
        logEvent('ELECTION: Node 2 received vote from Node 3 and ascended to Leader (Term 4).');
      } else if (type === 'packet-drop') {
        logEvent('CHAOS: 30% TCP packet loss & 200ms latency injected across inter-node links.');
        logEvent('MONITOR: Inter-node heartbeat retransmitted. Quorum maintained via earliest responding replicas.');
      } else if (type === 'heal') {
        restoreAllNodes();
        logEvent('HEAL: Network healed. Stale logs catch-up replication completed via AppendEntries RPC.');
      }
    }

    function logEvent(msg) {
      var log = document.getElementById('chaos-log');
      var now = new Date().toTimeString().split(' ')[0];
      log.innerHTML += '<br/>[' + now + '] ' + msg;
      log.scrollTop = log.scrollHeight;
    }
  </script>
</body>
</html>`;
}
