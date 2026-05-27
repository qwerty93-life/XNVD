const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const { app } = require('electron');

const VERSION_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const RESOURCES_URL = 'https://resources.download.minecraft.net';

function getGameDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), '.minecraft');
  }
  return path.join(os.homedir(), '.minecraft');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'XNVD-Launcher/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error for ${url}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'XNVD-Launcher/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest, onProgress).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      }
      const total = parseInt(res.headers['content-length'] || '0');
      let received = 0;
      const tmp = dest + '.tmp';
      const file = fs.createWriteStream(tmp);
      res.on('data', chunk => {
        received += chunk.length;
        if (onProgress && total > 0) onProgress(received / total);
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try { fs.renameSync(tmp, dest); resolve(); }
          catch (e) { reject(e); }
        });
      });
      file.on('error', (e) => { fs.unlink(tmp, () => {}); reject(e); });
    }).on('error', reject);
  });
}

async function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function downloadIfNeeded(url, dest, expectedSha1) {
  if (fs.existsSync(dest)) {
    if (!expectedSha1) return;
    const actual = await sha1File(dest);
    if (actual === expectedSha1) return;
  }
  await downloadFile(url, dest);
}

function ruleAllowed(rules) {
  if (!rules || rules.length === 0) return true;
  // Feature rules (quickPlay, demo, etc.) require explicit launcher support — skip them all
  if (rules.some(r => r.features)) return false;
  let allowed = false;
  for (const rule of rules) {
    const osName = rule.os?.name;
    const currentOs = process.platform === 'win32' ? 'windows'
      : process.platform === 'darwin' ? 'osx' : 'linux';
    const matches = !osName || osName === currentOs;
    if (rule.action === 'allow' && matches) allowed = true;
    else if (rule.action === 'disallow' && matches) allowed = false;
  }
  return allowed;
}

async function getVersionList() {
  const manifest = await fetchJson(VERSION_MANIFEST);
  return manifest.versions
    .filter(v => v.type === 'release' || v.type === 'snapshot')
    .map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
}

async function getFabricVersions(gameVersion) {
  try {
    const loaders = await fetchJson(`${FABRIC_META}/versions/loader/${gameVersion}`);
    if (!Array.isArray(loaders)) return [];
    return loaders.slice(0, 10).map(l => l.loader.version);
  } catch {
    return [];
  }
}

function isInstalled(gameVersion, useFabric, gameDir) {
  const dir = gameDir || getGameDir();
  if (useFabric) {
    const versionsDir = path.join(dir, 'versions');
    if (!fs.existsSync(versionsDir)) return false;
    const dirs = fs.readdirSync(versionsDir);
    return dirs.some(d => d.includes(`fabric-loader`) && d.includes(gameVersion));
  }
  const clientJar = path.join(dir, 'versions', gameVersion, `${gameVersion}.jar`);
  const clientJson = path.join(dir, 'versions', gameVersion, `${gameVersion}.json`);
  return fs.existsSync(clientJar) && fs.existsSync(clientJson);
}

async function install(gameVersion, useFabric, fabricVersion, onProgress, customGameDir) {
  const gameDir = customGameDir || getGameDir();

  onProgress({ step: 'Fetching version manifest...', percent: 2 });
  const manifest = await fetchJson(VERSION_MANIFEST);
  const versionMeta = manifest.versions.find(v => v.id === gameVersion);
  if (!versionMeta) throw new Error(`Version ${gameVersion} not found`);

  const versionJson = await fetchJson(versionMeta.url);
  const versionDir = path.join(gameDir, 'versions', gameVersion);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, `${gameVersion}.json`), JSON.stringify(versionJson, null, 2));

  onProgress({ step: 'Downloading client jar...', percent: 5 });
  const clientJar = path.join(versionDir, `${gameVersion}.jar`);
  await downloadIfNeeded(versionJson.downloads.client.url, clientJar, versionJson.downloads.client.sha1);

  const libs = (versionJson.libraries || []).filter(lib => ruleAllowed(lib.rules));
  for (let i = 0; i < libs.length; i++) {
    const lib = libs[i];
    const artifact = lib.downloads?.artifact;
    onProgress({ step: `Libraries (${i + 1}/${libs.length})`, percent: 5 + ((i + 1) / libs.length) * 40 });
    if (!artifact) continue;
    await downloadIfNeeded(artifact.url, path.join(gameDir, 'libraries', artifact.path), artifact.sha1);
  }

  onProgress({ step: 'Downloading asset index...', percent: 46 });
  const assetIndex = versionJson.assetIndex;
  const assetIndexPath = path.join(gameDir, 'assets', 'indexes', `${assetIndex.id}.json`);
  await downloadIfNeeded(assetIndex.url, assetIndexPath, assetIndex.sha1);

  const assetData = JSON.parse(fs.readFileSync(assetIndexPath, 'utf8'));
  const assetObjects = Object.values(assetData.objects);
  const BATCH = 20;
  let assetsDone = 0;

  for (let i = 0; i < assetObjects.length; i += BATCH) {
    const batch = assetObjects.slice(i, i + BATCH);
    await Promise.all(batch.map(async (obj) => {
      const prefix = obj.hash.substring(0, 2);
      const dest = path.join(gameDir, 'assets', 'objects', prefix, obj.hash);
      if (!fs.existsSync(dest)) {
        await downloadFile(`${RESOURCES_URL}/${prefix}/${obj.hash}`, dest).catch(() => {});
      }
    }));
    assetsDone += batch.length;
    onProgress({
      step: `Assets (${assetsDone}/${assetObjects.length})`,
      percent: 46 + (assetsDone / assetObjects.length) * 44
    });
  }

  if (useFabric && fabricVersion) {
    onProgress({ step: 'Installing Fabric...', percent: 91 });
    await installFabric(gameVersion, fabricVersion, gameDir, onProgress);
  }

  onProgress({ step: 'Complete!', percent: 100 });
}

async function installFabric(gameVersion, loaderVersion, gameDir, onProgress) {
  const profileUrl = `${FABRIC_META}/versions/loader/${gameVersion}/${loaderVersion}/profile/json`;
  const fabricProfile = await fetchJson(profileUrl);
  const fabricId = fabricProfile.id;

  const fabricDir = path.join(gameDir, 'versions', fabricId);
  fs.mkdirSync(fabricDir, { recursive: true });
  fs.writeFileSync(path.join(fabricDir, `${fabricId}.json`), JSON.stringify(fabricProfile, null, 2));

  const libs = fabricProfile.libraries || [];
  for (let i = 0; i < libs.length; i++) {
    const lib = libs[i];
    onProgress({ step: `Fabric libraries (${i + 1}/${libs.length})`, percent: 91 + ((i + 1) / libs.length) * 8 });
    const artifact = lib.downloads?.artifact;
    if (artifact) {
      await downloadIfNeeded(artifact.url, path.join(gameDir, 'libraries', artifact.path), artifact.sha1);
      continue;
    }
    if (lib.name) {
      const parts = lib.name.split(':');
      const group = parts[0].replace(/\./g, '/');
      const name = parts[1];
      const ver = parts[2];
      const jarName = `${name}-${ver}.jar`;
      const mavenPath = `${group}/${name}/${ver}/${jarName}`;
      const dest = path.join(gameDir, 'libraries', mavenPath);
      if (!fs.existsSync(dest)) {
        const baseUrl = lib.url || 'https://maven.fabricmc.net/';
        await downloadFile(baseUrl + mavenPath, dest).catch(() => {});
      }
    }
  }

  return fabricId;
}

function getFabricVersionId(gameVersion, gameDir) {
  const versionsDir = path.join(gameDir, 'versions');
  if (!fs.existsSync(versionsDir)) return null;
  const dirs = fs.readdirSync(versionsDir);
  return dirs.find(d => d.includes('fabric-loader') && d.includes(gameVersion)) || null;
}

function mergeProfiles(parent, child) {
  const merged = { ...parent, ...child };
  merged.libraries = [...(child.libraries || []), ...(parent.libraries || [])];
  if (parent.arguments && child.arguments) {
    merged.arguments = {
      game: [...(parent.arguments.game || []), ...(child.arguments.game || [])],
      jvm: [...(parent.arguments.jvm || []), ...(child.arguments.jvm || [])]
    };
  }
  return merged;
}

async function extractNatives(jarPath, destDir) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(jarPath);
    for (const entry of zip.getEntries()) {
      const name = entry.entryName;
      if (!entry.isDirectory && (name.endsWith('.dll') || name.endsWith('.so') || name.endsWith('.dylib'))) {
        const dest = path.join(destDir, path.basename(name));
        if (!fs.existsSync(dest)) zip.extractEntryTo(entry, destDir, false, true);
      }
    }
  } catch {}
}

async function findJava() {
  const candidates = [
    process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', 'java.exe'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Eclipse Adoptium', 'bin', 'java.exe'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft', 'jdk-21.0.4.7-hotspot', 'bin', 'java.exe'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Java', 'jre-latest', 'bin', 'java.exe'),
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Scan Eclipse Adoptium folder for any JDK
  const adoptiumBase = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Eclipse Adoptium');
  if (fs.existsSync(adoptiumBase)) {
    const subdirs = fs.readdirSync(adoptiumBase);
    for (const sub of subdirs) {
      const javaExe = path.join(adoptiumBase, sub, 'bin', 'java.exe');
      if (fs.existsSync(javaExe)) return javaExe;
    }
  }

  return 'java';
}

function resolveArg(arg, vars) {
  if (typeof arg !== 'string') return null;
  return arg.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] !== undefined ? vars[key] : '');
}

// Return the newest crash report path, or null
function getLatestCrashReport(gameDir) {
  const crashDir = path.join(gameDir, 'crash-reports');
  if (!fs.existsSync(crashDir)) return null;
  const files = fs.readdirSync(crashDir)
    .filter(f => f.endsWith('.txt'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(crashDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length > 0 ? path.join(crashDir, files[0].name) : null;
}

async function launch({ version, useFabric, account, gameDir: customGameDir, ram, javaPath: customJava, customJvmArgs, width, height }, onLog) {
  const gameDir = customGameDir || getGameDir();

  let launchId = version;
  if (useFabric) {
    const fabricId = getFabricVersionId(version, gameDir);
    if (fabricId) launchId = fabricId;
    else onLog('[WARN] Fabric version not found, launching vanilla');
  }

  const versionJsonPath = path.join(gameDir, 'versions', launchId, `${launchId}.json`);
  if (!fs.existsSync(versionJsonPath)) throw new Error(`Version ${launchId} is not installed`);

  let profile = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));

  if (profile.inheritsFrom) {
    const parentPath = path.join(gameDir, 'versions', profile.inheritsFrom, `${profile.inheritsFrom}.json`);
    if (!fs.existsSync(parentPath)) throw new Error(`Parent version ${profile.inheritsFrom} is not installed`);
    const parent = JSON.parse(fs.readFileSync(parentPath, 'utf8'));
    profile = mergeProfiles(parent, profile);
  }

  // ── Build classpath (deduplicated) ───────────────────────────────────────────
  // Fabric + vanilla both include ASM but at different versions.
  // mergeProfiles() puts Fabric libs FIRST, so when we keep the first entry
  // per group/name key the newer Fabric ASM wins and the old vanilla one is
  // dropped — eliminating the "duplicate ASM classes" ExceptionInInitializerError.
  const sep = process.platform === 'win32' ? ';' : ':';
  const cpMap = new Map();      // key: "group/name"  → value: absolute jar path
  const librariesBase = path.join(gameDir, 'libraries');

  for (const lib of (profile.libraries || [])) {
    if (!ruleAllowed(lib.rules)) continue;

    let jarPath = null;
    let libKey  = null;

    const artifact = lib.downloads?.artifact;
    if (artifact) {
      jarPath = path.join(librariesBase, artifact.path);
      // artifact.path looks like "org/ow2/asm/asm/9.9/asm-9.9.jar"
      // key = everything except the last two segments (version dir + jar name)
      const segs = artifact.path.replace(/\\/g, '/').split('/');
      libKey = segs.slice(0, -2).join('/');
    } else if (lib.name) {
      const parts = lib.name.split(':');
      const group = parts[0].replace(/\./g, '/');
      const name  = parts[1];
      const ver   = parts[2];
      jarPath = path.join(librariesBase, group, name, ver, `${name}-${ver}.jar`);
      libKey  = `${group}/${name}`;
    }

    if (jarPath && libKey && fs.existsSync(jarPath) && !cpMap.has(libKey)) {
      cpMap.set(libKey, jarPath);
    }
  }

  const cpParts = [...cpMap.values()];
  const clientJar = path.join(gameDir, 'versions', version, `${version}.jar`);
  if (fs.existsSync(clientJar)) cpParts.push(clientJar);

  const classpath = cpParts.join(sep);
  const assetIndex = profile.assetIndex?.id || version;
  const nativesDir = path.join(gameDir, 'versions', version, 'natives');
  fs.mkdirSync(nativesDir, { recursive: true });

  // Extract natives for older versions
  for (const lib of (profile.libraries || [])) {
    if (!ruleAllowed(lib.rules)) continue;
    if (!lib.downloads?.classifiers) continue;
    const nativeKey = `natives-${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'}`;
    const native = lib.downloads.classifiers[nativeKey];
    if (!native) continue;
    const nativeJar = path.join(gameDir, 'libraries', native.path);
    if (fs.existsSync(nativeJar)) await extractNatives(nativeJar, nativesDir);
  }

  const javaExe = customJava || await findJava();
  const ramMb = Math.max(512, parseInt(ram) || 2048);

  const vars = {
    natives_directory: nativesDir,
    launcher_name: 'XNVD',
    launcher_version: '1.0',
    classpath,
    version_name: launchId,
    game_directory: gameDir,
    assets_root: path.join(gameDir, 'assets'),
    assets_index_name: assetIndex,
    auth_player_name: account.username,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    clientid: '',
    auth_xuid: '',
    user_type: 'msa',
    version_type: 'release'
  };

  const jvmArgs = [
    `-Xmx${ramMb}m`, `-Xms512m`,
    `-XX:+UseG1GC`, `-XX:+ParallelRefProcEnabled`,
    `-XX:MaxGCPauseMillis=200`, `-XX:+UnlockExperimentalVMOptions`,
    `-XX:+DisableExplicitGC`, `-XX:+AlwaysPreTouch`,
    `-XX:G1NewSizePercent=30`, `-XX:G1MaxNewSizePercent=40`,
    `-XX:G1HeapRegionSize=8M`, `-XX:G1ReservePercent=20`,
    `-XX:G1HeapWastePercent=5`, `-XX:G1MixedGCCountTarget=4`,
    `-XX:InitiatingHeapOccupancyPercent=15`, `-XX:G1MixedGCLiveThresholdPercent=90`,
    `-XX:G1RSetUpdatingPauseTimePercent=5`, `-XX:SurvivorRatio=32`,
    `-XX:+PerfDisableSharedMem`, `-XX:MaxTenuringThreshold=1`,
    `-Djava.library.path=${nativesDir}`,
    `-Dminecraft.launcher.brand=XNVD`,
    `-Dminecraft.launcher.version=1.0`
  ];

  if (Array.isArray(profile.arguments?.jvm)) {
    for (const arg of profile.arguments.jvm) {
      if (typeof arg === 'string') {
        const resolved = resolveArg(arg, vars);
        if (resolved && !resolved.includes('${')) jvmArgs.push(resolved);
      } else if (arg?.rules && ruleAllowed(arg.rules)) {
        const values = Array.isArray(arg.value) ? arg.value : [arg.value];
        for (const v of values) {
          const resolved = resolveArg(v, vars);
          if (resolved) jvmArgs.push(resolved);
        }
      }
    }
  }

  // User-defined extra JVM flags (from Settings → Custom JVM Args)
  if (customJvmArgs && customJvmArgs.trim()) {
    const extra = customJvmArgs.trim().split(/\s+/).filter(Boolean);
    jvmArgs.push(...extra);
  }

  jvmArgs.push('-cp', classpath);

  const mainClass = profile.mainClass;
  const gameArgs = [];

  if (Array.isArray(profile.arguments?.game)) {
    for (const arg of profile.arguments.game) {
      if (typeof arg === 'string') {
        const resolved = resolveArg(arg, vars);
        if (resolved !== null) gameArgs.push(resolved);
      } else if (arg?.rules && ruleAllowed(arg.rules)) {
        const values = Array.isArray(arg.value) ? arg.value : [arg.value];
        for (const v of values) gameArgs.push(resolveArg(v, vars) || v);
      }
    }
  } else if (profile.minecraftArguments) {
    const legacyArgs = profile.minecraftArguments.split(' ');
    const legacyVars = {
      auth_player_name: account.username,
      version_name: launchId,
      game_directory: gameDir,
      assets_root: path.join(gameDir, 'assets'),
      assets_index_name: assetIndex,
      auth_uuid: account.uuid,
      auth_access_token: account.accessToken,
      user_type: 'msa',
      version_type: 'release'
    };
    for (const arg of legacyArgs) {
      gameArgs.push(resolveArg(arg, legacyVars) || arg);
    }
  }

  // Window resolution (appended AFTER argument-list game args)
  if (width && height) {
    gameArgs.push('--width', String(width), '--height', String(height));
  }

  const fullArgs = [...jvmArgs, mainClass, ...gameArgs];

  onLog(`[XNVD] Java: ${javaExe}`);
  onLog(`[XNVD] Version: ${launchId}`);
  onLog(`[XNVD] RAM: ${ramMb} MB`);
  onLog(`[XNVD] Launching...`);

  const proc = spawn(javaExe, fullArgs, {
    cwd: gameDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  proc.stdout.on('data', d => onLog(d.toString().trimEnd()));
  proc.stderr.on('data', d => onLog(d.toString().trimEnd()));
  proc.on('error', e => onLog(`[ERROR] ${e.message}`));
  proc.on('exit', code => {
    onLog(`[XNVD] Game exited (code ${code})`);
    // Attempt to surface latest crash report on non-zero exit
    if (code !== 0 && code !== null) {
      const report = getLatestCrashReport(gameDir);
      if (report) {
        onLog(`[XNVD] Crash report: ${report}`);
        try {
          const lines = fs.readFileSync(report, 'utf8').split('\n').slice(0, 30).join('\n');
          onLog('[XNVD] --- Crash Report (first 30 lines) ---');
          onLog(lines);
        } catch {}
      }
    }
  });
  proc.unref();
}

module.exports = { getVersionList, getFabricVersions, install, launch, isInstalled, getGameDir, getLatestCrashReport };
