'use strict';

/**
 * XNVD Launcher — Update checker
 *
 * Checks GitHub Releases for a newer version on startup.
 * No download is forced — just shows a banner so the user can decide.
 *
 * SETUP (one-time):
 *   1. Create a GitHub repo (e.g. https://github.com/YourName/xnvd-launcher)
 *   2. Set GITHUB_OWNER + GITHUB_REPO below to match
 *   3. When you release a new version:
 *        a. Bump "version" in package.json  (e.g. "1.1.0")
 *        b. Run BUILD.bat — it produces the new installer EXE in dist\
 *        c. Go to GitHub → Releases → "Draft a new release"
 *        d. Tag it  v1.1.0  (must start with "v")
 *        e. Upload the installer EXE as a release asset
 *        f. Publish — everyone running the launcher will see the banner next boot
 */

const https = require('https');

// ── Config ────────────────────────────────────────────────────────────────────
const GITHUB_OWNER = 'YourGitHubUsername';   // ← change this
const GITHUB_REPO  = 'xnvd-launcher';        // ← change this if different

const CURRENT_VERSION  = require('../package.json').version;
const API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// ── Semver compare ────────────────────────────────────────────────────────────

function parseSemver(v) {
  const parts = String(v || '').replace(/^v/, '').split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function isNewer(remote, current) {
  const [rMaj, rMin, rPatch] = parseSemver(remote);
  const [cMaj, cMin, cPatch] = parseSemver(current);
  if (rMaj !== cMaj) return rMaj > cMaj;
  if (rMin !== cMin) return rMin > cMin;
  return rPatch > cPatch;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': `XNVD-Launcher/${CURRENT_VERSION}`, 'Accept': 'application/vnd.github.v3+json' } },
      res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error('Invalid JSON')); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @returns {{ available: boolean, version?: string, notes?: string, url?: string }}
 */
async function checkForUpdates() {
  // Skip check if owner is still placeholder
  if (GITHUB_OWNER === 'YourGitHubUsername') {
    return { available: false };
  }

  try {
    const release = await fetchJson(API_URL);
    const remoteVersion = String(release.tag_name || '').replace(/^v/, '');

    if (!remoteVersion) return { available: false };

    if (isNewer(remoteVersion, CURRENT_VERSION)) {
      return {
        available: true,
        version:   remoteVersion,
        notes:     release.body || '',
        url:       release.html_url || RELEASES_PAGE,
        assets:    (release.assets || []).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size }))
      };
    }
    return { available: false };
  } catch {
    return { available: false };   // silently ignore network errors
  }
}

module.exports = { checkForUpdates, CURRENT_VERSION, RELEASES_PAGE, GITHUB_OWNER, GITHUB_REPO };
