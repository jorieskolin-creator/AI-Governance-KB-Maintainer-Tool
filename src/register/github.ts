import type { GitHubClient } from './ports.js';

const GITHUB_API = 'https://api.github.com';

function requiredGitHubEnv(): { token: string; owner: string; repo: string; branch: string } {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repoEnv = process.env.GITHUB_REPO?.trim();
  if (!token) throw new Error('Missing required environment variable: GITHUB_TOKEN');
  if (!repoEnv || !repoEnv.includes('/')) {
    throw new Error('Missing or invalid environment variable: GITHUB_REPO (expected owner/repo)');
  }
  const [owner, repo] = repoEnv.split('/');
  if (!owner || !repo) {
    throw new Error('Missing or invalid environment variable: GITHUB_REPO (expected owner/repo)');
  }
  return {
    token,
    owner,
    repo,
    branch: process.env.GITHUB_BRANCH?.trim() || 'main'
  };
}

async function githubRequest(
  env: { token: string; owner: string; repo: string },
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  const response = await fetch(`${GITHUB_API}/repos/${env.owner}/${env.repo}/contents/${path}${qs}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env.token}`,
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { message: text };
    }
  }
  return { status: response.status, json };
}

export function createGitHubClient(): GitHubClient {
  return {
    async getFileSha(path: string): Promise<string | null> {
      const env = requiredGitHubEnv();
      const encodedPath = path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const { status, json } = await githubRequest(env, 'GET', encodedPath);
      if (status === 404) return null;
      if (status >= 400) {
        const message = typeof json?.message === 'string' ? json.message : `GitHub GET failed (${status})`;
        throw new Error(message);
      }
      const sha = json && typeof json.sha === 'string' ? json.sha : null;
      return sha;
    },

    async readFileContent(path: string): Promise<string> {
      const env = requiredGitHubEnv();
      const encodedPath = path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const { status, json } = await githubRequest(env, 'GET', encodedPath, undefined, { ref: env.branch });
      if (status >= 400) {
        const message = typeof json?.message === 'string' ? json.message : `GitHub GET failed (${status})`;
        throw new Error(message);
      }
      const content = json && typeof json.content === 'string' ? json.content : null;
      const encoding = json && typeof json.encoding === 'string' ? json.encoding : null;
      if (!content || encoding !== 'base64') {
        throw new Error('GitHub GET did not return base64 file content.');
      }
      return Buffer.from(content.replaceAll('\n', ''), 'base64').toString('utf8');
    },

    async commitFile(
      path: string,
      content: string,
      message: string,
      sha: string | null
    ): Promise<{ commitSha: string }> {
      const env = requiredGitHubEnv();
      const encodedPath = path
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      const { status, json } = await githubRequest(env, 'PUT', encodedPath, {
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch: env.branch,
        ...(sha ? { sha } : {})
      });
      if (status >= 400) {
        const detail = typeof json?.message === 'string' ? json.message : `GitHub PUT failed (${status})`;
        throw new Error(detail);
      }
      const commit =
        json && typeof json.commit === 'object' && json.commit !== null
          ? (json.commit as { sha?: unknown })
          : null;
      const commitSha = typeof commit?.sha === 'string' ? commit.sha : null;
      if (!commitSha) throw new Error('GitHub PUT did not return a commit sha.');
      return { commitSha };
    }
  };
}
