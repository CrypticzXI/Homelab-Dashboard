import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

const HOST_ROOT = process.env.HOST_ROOT || '';

/** /proc/stat based CPU sample so we get host-wide usage rather than the container's cgroup. */
let lastCpu = null;
async function readCpuTimes() {
  try {
    const stat = await fs.readFile('/proc/stat', 'utf8');
    const parts = stat.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

async function cpuPercent() {
  const now = await readCpuTimes();
  if (!now) {
    // Non-Linux fallback (dev on Windows/mac): load average approximation
    const load = os.loadavg()[0];
    return Math.min(100, (load / os.cpus().length) * 100);
  }
  if (!lastCpu) {
    lastCpu = now;
    await new Promise((r) => setTimeout(r, 400));
    return cpuPercent();
  }
  const dIdle = now.idle - lastCpu.idle;
  const dTotal = now.total - lastCpu.total;
  lastCpu = now;
  if (dTotal <= 0) return 0;
  return ((dTotal - dIdle) / dTotal) * 100;
}

async function memInfo() {
  try {
    const txt = await fs.readFile('/proc/meminfo', 'utf8');
    const get = (k) => Number((txt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1] || 0) * 1024;
    const total = get('MemTotal');
    const available = get('MemAvailable');
    return { total, used: total - available };
  } catch {
    return { total: os.totalmem(), used: os.totalmem() - os.freemem() };
  }
}

async function diskInfo(paths) {
  const out = [];
  for (const p of paths) {
    const target = HOST_ROOT ? path.posix.join(HOST_ROOT, p) : p;
    try {
      const s = await fs.statfs(target);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      out.push({ path: p, total, used: total - free, free });
    } catch (e) {
      out.push({ path: p, error: e.code || e.message });
    }
  }
  return out;
}

async function hostUptime() {
  try {
    const t = await fs.readFile('/proc/uptime', 'utf8');
    return Math.floor(Number(t.split(' ')[0]));
  } catch {
    return Math.floor(os.uptime());
  }
}

/** Real hostname of the host when / is mounted at HOST_ROOT; falls back to the container's. */
async function hostName() {
  if (HOST_ROOT) {
    try {
      return (await fs.readFile(path.posix.join(HOST_ROOT, 'etc/hostname'), 'utf8')).trim() || os.hostname();
    } catch {
      /* fall through */
    }
  }
  return os.hostname();
}

export async function getSystem(config = {}) {
  const disks = Array.isArray(config.disks) && config.disks.length ? config.disks : ['/'];
  const [cpu, mem, disk, uptime, hostname] = await Promise.all([cpuPercent(), memInfo(), diskInfo(disks), hostUptime(), hostName()]);
  return {
    hostname: config.hostname || hostname,
    cpu: +cpu.toFixed(1),
    cores: os.cpus().length,
    load: os.loadavg().map((n) => +n.toFixed(2)),
    mem,
    disks: disk,
    uptime,
  };
}
