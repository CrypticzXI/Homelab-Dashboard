import http from 'node:http';

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

function dockerRequest(path, method = 'GET', { raw = false, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET, path, method, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          let msg = buf.toString('utf8').slice(0, 200);
          try { msg = JSON.parse(msg).message || msg; } catch { /* plain */ }
          return reject(new Error(`Docker API ${res.statusCode}: ${msg}`));
        }
        if (raw) return resolve(buf);
        if (res.statusCode === 204 || !buf.length) return resolve(null);
        try {
          resolve(JSON.parse(buf.toString('utf8')));
        } catch {
          reject(new Error('Bad JSON from Docker'));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Docker socket timeout')));
    req.on('error', (e) => {
      if (e.code === 'ENOENT') reject(new Error('Docker socket not found — is /var/run/docker.sock mounted?'));
      else if (e.code === 'EACCES') reject(new Error('Permission denied on docker.sock — check group_add in docker-compose.yml'));
      else reject(e);
    });
    req.end();
  });
}

function cpuPercent(stats) {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage || 0);
  const sysDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage || 0);
  const cores = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
  if (sysDelta <= 0 || cpuDelta < 0) return 0;
  return (cpuDelta / sysDelta) * cores * 100;
}

function memUsage(stats) {
  const m = stats.memory_stats || {};
  // Docker's own CLI subtracts cache/inactive_file to match `docker stats`
  const cacheBytes = m.stats?.inactive_file ?? m.stats?.cache ?? 0;
  const used = Math.max(0, (m.usage || 0) - cacheBytes);
  return { used, limit: m.limit || 0 };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

const ACTIONS = new Set(['start', 'stop', 'restart', 'pause', 'unpause']);

/** start / stop / restart / pause / unpause a container by (short) id. */
export async function dockerAction(id, action) {
  if (!ACTIONS.has(action)) throw new Error(`Unsupported action "${action}"`);
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Bad container id');
  await dockerRequest(`/containers/${id}/${action}${action === 'stop' || action === 'restart' ? '?t=10' : ''}`, 'POST', { timeout: 30000 });
  return { ok: true };
}

/**
 * Tail container logs. Docker multiplexes stdout/stderr with 8-byte frame
 * headers when the container has no TTY; strip them so the text is clean.
 */
export async function dockerLogs(id, tail = 200) {
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Bad container id');
  const buf = await dockerRequest(`/containers/${id}/logs?stdout=1&stderr=1&tail=${Math.min(2000, Math.max(1, tail | 0))}&timestamps=1`, 'GET', { raw: true });
  const lines = [];
  let i = 0;
  const framed = buf.length >= 8 && (buf[0] === 1 || buf[0] === 2 || buf[0] === 0) && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (framed) {
    while (i + 8 <= buf.length) {
      const stream = buf[i];
      const len = buf.readUInt32BE(i + 4);
      const text = buf.subarray(i + 8, i + 8 + len).toString('utf8');
      for (const l of text.split('\n')) if (l) lines.push({ s: stream === 2 ? 'err' : 'out', l });
      i += 8 + len;
    }
  } else {
    for (const l of buf.toString('utf8').split('\n')) if (l) lines.push({ s: 'out', l });
  }
  return { lines: lines.slice(-tail) };
}

export async function getDocker(config = {}) {
  const containers = await dockerRequest('/containers/json?all=1');
  const running = containers.filter((c) => c.State === 'running');
  const withStats = config.stats !== false;

  const statsById = new Map();
  if (withStats) {
    await mapLimit(running, 6, async (c) => {
      try {
        const s = await dockerRequest(`/containers/${c.Id}/stats?stream=false&one-shot=false`);
        statsById.set(c.Id, s);
      } catch {
        /* container may have exited mid-request */
      }
    });
  }

  const list = containers
    .map((c) => {
      const s = statsById.get(c.Id);
      const mem = s ? memUsage(s) : null;
      return {
        id: c.Id.slice(0, 12),
        name: (c.Names?.[0] || '').replace(/^\//, ''),
        image: c.Image,
        state: c.State,
        status: c.Status,
        cpu: s ? +cpuPercent(s).toFixed(1) : null,
        memUsed: mem?.used ?? null,
        memLimit: mem?.limit ?? null,
      };
    })
    .sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === 'running' ? -1 : 1));

  return {
    total: containers.length,
    running: running.length,
    stopped: containers.length - running.length,
    controls: config.controls === true,
    containers: list,
  };
}
