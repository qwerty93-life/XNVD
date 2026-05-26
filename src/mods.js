const https = require('https');
const fs = require('fs');
const path = require('path');

const MODRINTH = 'https://api.modrinth.com/v2';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'XNVD-Launcher/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    https.get(url, { headers: { 'User-Agent': 'XNVD-Launcher/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const tmp = dest + '.tmp';
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        try { fs.renameSync(tmp, dest); resolve(); }
        catch (e) { reject(e); }
      }));
      file.on('error', e => { fs.unlink(tmp, () => {}); reject(e); });
    }).on('error', reject);
  });
}

async function searchMods(query, gameVersion) {
  const facets = [['project_type:mod'], ['categories:fabric']];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  const params = new URLSearchParams({
    facets: JSON.stringify(facets),
    limit: '20',
    index: query ? 'relevance' : 'downloads'
  });
  if (query && query.trim()) params.set('query', query.trim());
  const result = await fetchJson(`${MODRINTH}/search?${params}`);
  return (result?.hits || []).map(h => ({
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    downloads: h.downloads,
    iconUrl: h.icon_url || null,
    categories: h.display_categories || []
  }));
}

async function getModFile(slugOrId, gameVersion) {
  const params = new URLSearchParams({
    game_versions: JSON.stringify([gameVersion]),
    loaders: JSON.stringify(['fabric'])
  });
  const versions = await fetchJson(`${MODRINTH}/project/${slugOrId}/version?${params}`);
  if (!Array.isArray(versions) || versions.length === 0) return null;
  const latest = versions[0];
  const primary = latest.files.find(f => f.primary) || latest.files[0];
  if (!primary) return null;
  return { url: primary.url, filename: primary.filename };
}

async function installMod(slugOrId, gameVersion, gameDir) {
  const modsDir = path.join(gameDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const dl = await getModFile(slugOrId, gameVersion);
  if (!dl) throw new Error(`No Fabric build found for ${slugOrId} on ${gameVersion}`);
  const dest = path.join(modsDir, dl.filename);
  if (!fs.existsSync(dest)) await downloadFile(dl.url, dest);
  return dl.filename;
}

function isModInstalled(slugOrId, gameDir) {
  const modsDir = path.join(gameDir, 'mods');
  if (!fs.existsSync(modsDir)) return false;
  const lower = slugOrId.toLowerCase();
  return fs.readdirSync(modsDir).some(f => f.toLowerCase().includes(lower));
}

function getInstalledMods(gameDir) {
  const modsDir = path.join(gameDir, 'mods');
  if (!fs.existsSync(modsDir)) return [];
  return fs.readdirSync(modsDir)
    .filter(f => f.endsWith('.jar'))
    .map(f => {
      const full = path.join(modsDir, f);
      const stat = fs.statSync(full);
      return { filename: f, size: stat.size, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function removeMod(filename, gameDir) {
  const modPath = path.join(gameDir, 'mods', filename);
  if (fs.existsSync(modPath)) fs.unlinkSync(modPath);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

module.exports = { searchMods, installMod, isModInstalled, getInstalledMods, removeMod, formatBytes };
