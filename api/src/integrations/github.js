import { cached } from './http.js';

/**
 * Repo stats for GitHub bookmarks. Unauthenticated GitHub allows 60 core
 * requests/hour and 10 searches/minute, so results are cached for 15 minutes
 * and a token (per bookmark or GITHUB_TOKEN env) is optional but recommended.
 */
const TTL = 15 * 60_000;

export function parseGithubUrl(url) {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_.-]+))?(?:[/?#].*)?$/.exec(String(url || '').trim());
  if (!m) return null;
  const owner = m[1];
  if (['orgs', 'users', 'settings', 'marketplace', 'explore', 'topics', 'features', 'sponsors', 'login', 'about', 'pricing'].includes(owner.toLowerCase())) return null;
  return { owner, repo: m[2] ? m[2].replace(/\.git$/, '') : null };
}

async function gh(path, token) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'homelab-dashboard', 'x-github-api-version': '2022-11-28' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const mins = reset ? Math.max(1, Math.round((Number(reset) * 1000 - Date.now()) / 60_000)) : null;
    throw new Error(`GitHub rate limit hit${mins ? ` — resets in ${mins} min` : ''}${token ? '' : ' (add a token)'}`);
  }
  if (res.status === 404) throw new Error('Not found on GitHub (private repo? add a token)');
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  return { body: await res.json(), link: res.headers.get('link') || '' };
}

/** Total commits on the default branch: ask for 1 per page and read the last page number. */
async function commitCount(owner, repo, token) {
  const { link } = await gh(`/repos/${owner}/${repo}/commits?per_page=1`, token);
  const m = /[?&]page=(\d+)>;\s*rel="last"/.exec(link);
  return m ? Number(m[1]) : 1;
}

export function getGithub(url, token) {
  const parsed = parseGithubUrl(url);
  if (!parsed) return null;
  const tok = token || process.env.GITHUB_TOKEN || '';
  return cached(`github:${parsed.owner}/${parsed.repo || ''}:${tok ? 'auth' : 'anon'}`, TTL, async () => {
    try {
      if (parsed.repo) {
        const { owner, repo } = parsed;
        const [{ body: r }, commits, issues] = await Promise.all([
          gh(`/repos/${owner}/${repo}`, tok),
          commitCount(owner, repo, tok).catch(() => null),
          gh(`/search/issues?q=repo:${owner}/${repo}+is:issue+is:open&per_page=1`, tok)
            .then(({ body }) => body.total_count)
            .catch(() => null),
        ]);
        return {
          kind: 'repo',
          name: r.full_name,
          stars: r.stargazers_count,
          forks: r.forks_count,
          issues: issues ?? r.open_issues_count, // falls back to issues+PRs if search is rate-limited
          commits,
          language: r.language,
          pushed: r.pushed_at,
          archived: r.archived,
        };
      }
      const { body: u } = await gh(`/users/${parsed.owner}`, tok);
      return { kind: 'user', name: u.login, repos: u.public_repos, followers: u.followers, type: u.type };
    } catch (e) {
      return { error: e.message };
    }
  });
}
