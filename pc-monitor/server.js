#!/usr/bin/env node
// SystemScope — system monitor engine.
// Polls real system stats via `systeminformation`, broadcasts over WebSocket,
// serves the dashboard + REST API, and binds 0.0.0.0 so phones on the LAN can
// connect. `--no-open` skips auto-opening the browser (used for tests).

const http = require("http");
const os = require("os");
const { execFile } = require("child_process");
const { WebSocketServer } = require("ws");
const si = require("systeminformation");
const QRCode = require("qrcode");
const assets = require("./assets");
const { getInstalledApps } = require("./installedApps");

const APP_NAME = "SystemScope";
const DEFAULT_PORT = 8356;
const STATS_MS = 1500; // fast poll: cpu/mem/fs/net/battery/uptime
const PROC_MS = 3000; // heavier poll: process list
const APPS_TTL_MS = 5 * 60 * 1000;

const noOpen = process.argv.includes("--no-open");

// ---------------------------------------------------------------- app state
const state = {
  stats: null, // latest combined snapshot
  processes: null, // latest process list
  apps: null, // cached installed-apps list
  appsAt: 0,
};

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === "IPv4" && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

// ---------------------------------------------------------------- pollers
async function pollStats(port) {
  const [load, mem, fsSizes, nets, batt, osInfo, temp, cpuInfo] = await Promise.all([
    si.currentLoad().catch(() => null),
    si.mem().catch(() => null),
    si.fsSize().catch(() => null),
    si.networkStats().catch(() => null),
    si.battery().catch(() => null),
    si.osInfo().catch(() => null),
    si.cpuTemperature().catch(() => null),
    si.cpu().catch(() => null),
  ]);

  const stats = {
    t: Date.now(),
    cpu: load
      ? {
          total: round(load.currentLoad),
          cores: (load.cpus || []).map((c) => round(c.load)),
          model: cpuInfo ? shortModel(cpuInfo.brand) : "",
          speed: cpuInfo ? cpuInfo.speed : null,
        }
      : null,
    mem: mem
      ? {
          total: mem.total,
          used: mem.total - mem.available,
          available: mem.available,
          swapTotal: mem.swapTotal,
          swapUsed: mem.swapUsed,
          pct: round(((mem.total - mem.available) / mem.total) * 100),
        }
      : null,
    disks: (fsSizes || []).map((d) => ({
      name: d.mount,
      fs: d.fs,
      size: d.size,
      used: d.used,
      available: d.available || 0,
      pct: d.use || round((d.used / d.size) * 100),
    })),
    net: (nets || []).map((n) => ({
      iface: n.iface,
      rx: n.rx_sec,
      tx: n.tx_sec,
      operstate: n.operstate,
      type: n.type,
    })),
    battery: batt && batt.hasBattery ? { pct: batt.percent, charging: batt.isCharging, mins: batt.timeRemaining } : null,
    temp: temp && temp.main ? round(temp.main) : null,
    sys: osInfo
      ? {
          hostname: osInfo.hostname,
          platform: osInfo.platform,
          distro: osInfo.distro,
          release: osInfo.release,
          arch: osInfo.arch,
          uptime: osInfo.uptime,
        }
      : null,
    cpuInfo: cpuInfo
      ? { cores: cpuInfo.cores, physicalCores: cpuInfo.physicalCores, brand: shortModel(cpuInfo.brand), speed: cpuInfo.speed }
      : null,
  };
  state.stats = stats;
  return stats;
}

async function pollProcesses() {
  const procs = await si.processes().catch(() => null);
  if (!procs) return null;
  const list = (procs.list || [])
    .filter((p) => p.pid >= 0)
    .map((p) => ({ pid: p.pid, name: p.name, cpu: round(p.cpu), mem: round(p.mem), state: p.state, user: p.user }))
    .sort((a, b) => b.cpu - a.cpu);
  state.processes = list;
  return list;
}

async function fetchApps(force) {
  if (force || Date.now() - state.appsAt > APPS_TTL_MS) {
    const raw = await getInstalledApps();
    state.apps = raw;
    state.appsAt = Date.now();
    state.appError = null;
  }
  return state.apps;
}

// ---------------------------------------------------------------- helpers
const round = (n) => (typeof n === "number" && isFinite(n) ? Math.round(n * 10) / 10 : 0);
const shortModel = (b) => (b || "").replace(/\s+with Radeon.*$/i, "").trim();

function fmtBytes(b) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b >= 100 ? Math.round(b) : Math.round(b * 10) / 10} ${u[i]}`;
}

function json(res, obj, status = 200) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// ---------------------------------------------------------------- server
function createServer(port, hostname) {
  const lanUrl = `http://${lanIps()[0] || "127.0.0.1"}:${port}`;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const p = url.pathname;

    // REST API
    if (p === "/api/info") return json(res, { app: APP_NAME, version: "1.0.0", hostname, lanUrl, port, lanIps: lanIps() });
    if (p === "/api/stats") return json(res, state.stats || { error: "not ready" });
    if (p === "/api/processes") return json(res, { list: state.processes || [], at: Date.now() });
    if (p === "/api/apps") {
      try {
        const apps = await fetchApps(url.searchParams.get("refresh") === "1");
        return json(res, { list: apps, at: state.appsAt, error: state.appError });
      } catch (e) {
        return json(res, { list: [], error: String(e && e.message || e) }, 500);
      }
    }
    if (p === "/qr.svg") {
      const svg = await QRCode.toString(lanUrl, { type: "svg", margin: 1, width: 220, color: { dark: "#e8f0ff", light: "#0b0e14" } });
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*" });
      return res.end(svg);
    }

    // Static dashboard
    const staticMap = {
      "/": ["index.html", "text/html"],
      "/style.css": ["style.css", "text/css"],
      "/app.js": ["app.js", "text/javascript"],
      "/vendor/chart.umd.js": ["vendor/chart.umd.js", "text/javascript"],
    };
    const hit = staticMap[p];
    if (hit) {
      try {
        const buf = assets.read(hit[0]);
        res.writeHead(200, { "Content-Type": hit[1], "Content-Length": buf.length });
        return res.end(buf);
      } catch (e) {
        return json(res, { error: "not found" }, 404);
      }
    }
    return json(res, { error: "not found" }, 404);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    if (state.stats) ws.send(JSON.stringify({ type: "stats", data: state.stats }));
    if (state.processes) ws.send(JSON.stringify({ type: "processes", data: state.processes }));
  });

  return { server, wss, lanUrl };
}

function broadcast(wss, type, data) {
  const msg = JSON.stringify({ type, data });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function start() {
  const hostname = os.hostname();
  let attempt = 0;

  const tryNext = () => {
    if (attempt >= 12) { console.error("No free port found in range 8356–8367."); process.exit(1); }
    const port = DEFAULT_PORT + attempt++;
    const { server, wss, lanUrl } = createServer(port, hostname);
    wss.on("error", () => {}); // keep a stuck bind from crashing the process
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`Port ${port} busy → trying ${port + 1}`);
        try { server.close(); } catch {}
        try { wss.close(); } catch {}
        return tryNext();
      }
      console.error("Server failed:", err.message);
      process.exit(1);
    });
    server.listen(port, "0.0.0.0", () => {
      console.log("");
      console.log(`  ╔══════════ SystemScope ══════════╗`);
      console.log(`  ║  Local     http://localhost:${port}   ║`);
      console.log(`  ║  Phone/LAN ${lanUrl}  ║`);
      console.log(`  ╚═══════════════════════════════════════╝`);
      console.log("");

      // Start pollers
      const tickStats = async () => {
        const s = await pollStats(port);
        if (s) broadcast(wss, "stats", s);
      };
      const tickProc = async () => {
        const p = await pollProcesses();
        if (p) broadcast(wss, "processes", p);
      };
      tickStats();
      setInterval(tickStats, STATS_MS);
      setInterval(tickProc, PROC_MS);

      if (!noOpen) {
        const cmd = process.platform === "win32" ? "start" : "xdg-open";
        execFile("cmd", ["/c", "start", "", `http://localhost:${port}`], { windowsVerbatimArguments: true, cwd: process.cwd() }, () => {});
      }

      process.on("SIGINT", () => {
        console.log("\nShutting down…");
        wss.close();
        server.close();
        process.exit(0);
      });
    });
  };
  tryNext();
}

start();