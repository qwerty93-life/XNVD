// ── State ──────────────────────────────────────────────────────────────────────
const S = {
  account: null,
  versions: [],
  settings: { ram: 2048, gameDir: '', javaPath: '' },
  installing: false,
  running: false,
  currentTab: 'browse',
  // cosmetics
  capes: [],
  selectedCape: 'none',
  equippedCape: 'none'
};

const $ = id => document.getElementById(id);

// ── Boot ───────────────────────────────────────────────────────────────────────
async function boot() {
  wireWindow();
  wireNav();
  await loadSettings();
  await loadAccount();
  await loadVersions();
  wireVersionUI();
  wireSettings();
  wireProgress();
  wireConsole();
  wireMods();
  await wireCosmetics();
  wireServers();
  wireUpdater();
}

// ── Window controls ────────────────────────────────────────────────────────────
function wireWindow() {
  $('btn-min').onclick = () => window.api.send('win:min');
  $('btn-max').onclick = () => window.api.send('win:max');
  $('btn-close').onclick = () => window.api.send('win:close');
}

// ── Navigation ─────────────────────────────────────────────────────────────────
function wireNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`page-${btn.dataset.page}`).classList.add('active');
      if (btn.dataset.page === 'mods') refreshInstalledList();
    };
  });
}

// ── Servers quick-join ─────────────────────────────────────────────────────────
function wireServers() {
  document.querySelectorAll('.server-chip').forEach(chip => {
    chip.title = 'Click to copy server IP';
    chip.onclick = async () => {
      const ip = chip.dataset.ip;
      try {
        await navigator.clipboard.writeText(ip);
        const orig = chip.innerHTML;
        chip.innerHTML = `<div class="srv-dot" style="background:#22c55e"></div><span>Copied!</span>`;
        setTimeout(() => { chip.innerHTML = orig; }, 1400);
      } catch { /* clipboard blocked */ }
    };
  });
}

// ── Account ────────────────────────────────────────────────────────────────────
async function loadAccount() {
  const stored = await window.api.invoke('store:get', 'account');
  if (stored?.msRefreshToken) {
    setAccountUI({ username: stored.username, uuid: stored.uuid });
    const res = await window.api.invoke('auth:refresh');
    if (res.success) setAccount(res.account);
    else setAccount(null);
  } else {
    setAccount(null);
  }
}

function setAccount(acct) {
  S.account = acct;
  if (acct) {
    $('acct-avatar').textContent = acct.username.charAt(0).toUpperCase();
    $('acct-name').textContent = acct.username;
    $('acct-btn').textContent = 'Sign out';
    $('acct-btn').onclick = doLogout;
  } else {
    setAccountUI(null);
  }
  updatePlayBtn();
}

function setAccountUI(acct) {
  if (acct) {
    $('acct-avatar').textContent = acct.username.charAt(0).toUpperCase();
    $('acct-name').textContent = acct.username;
  } else {
    $('acct-avatar').textContent = '?';
    $('acct-name').textContent = 'Not signed in';
    $('acct-btn').textContent = 'Sign in with Microsoft';
    $('acct-btn').onclick = doLogin;
  }
}

async function doLogin() {
  $('acct-btn').textContent = 'Opening...';
  $('acct-btn').onclick = null;
  const res = await window.api.invoke('auth:login');
  if (res.success) setAccount(res.account);
  else {
    setAccount(null);
    alert(`Login failed:\n${res.error}`);
  }
}

async function doLogout() {
  await window.api.invoke('auth:logout');
  setAccount(null);
}

// ── Versions ───────────────────────────────────────────────────────────────────
async function loadVersions() {
  const list = await window.api.invoke('versions:list');
  S.versions = list;
  renderVersionList();
}

function renderVersionList() {
  const showSnap = $('show-snapshots').checked;
  const filtered = S.versions.filter(v => v.type === 'release' || (showSnap && v.type === 'snapshot'));
  const cur = $('version-select').value;
  $('version-select').innerHTML = filtered
    .map(v => `<option value="${v.id}">${v.id}${v.type === 'snapshot' ? ' ✦' : ''}</option>`)
    .join('');
  if (cur && filtered.find(v => v.id === cur)) $('version-select').value = cur;
  checkInstalled();
}

function wireVersionUI() {
  $('show-snapshots').onchange = renderVersionList;
  $('version-select').onchange = async () => {
    checkInstalled();
    if ($('use-fabric').checked) loadFabricVersions();
  };
  $('use-fabric').onchange = async () => {
    const on = $('use-fabric').checked;
    $('fabric-select').disabled = !on;
    if (on) await loadFabricVersions();
    checkInstalled();
  };
  $('fabric-select').onchange = checkInstalled;
  $('btn-install').onclick = doInstall;
  $('btn-get-mods').onclick = doGetMods;
  $('btn-play').onclick = doPlay;
}

async function loadFabricVersions() {
  const v = $('version-select').value;
  if (!v) return;
  $('fabric-select').disabled = true;
  $('fabric-select').innerHTML = '<option>Loading...</option>';
  const list = await window.api.invoke('fabric:versions', v);
  $('fabric-select').innerHTML = list.length
    ? list.map((fv, i) => `<option value="${fv}">${fv}${i === 0 ? ' (latest)' : ''}</option>`).join('')
    : '<option value="">Not available for this version</option>';
  $('fabric-select').disabled = false;
  checkInstalled();
}

async function checkInstalled() {
  const version = $('version-select').value;
  if (!version) return;
  const useFabric = $('use-fabric').checked;
  const gameDir = S.settings.gameDir || undefined;
  const installed = await window.api.invoke('game:isInstalled', { version, useFabric, gameDir });
  updatePlayBtn(installed);
}

function updatePlayBtn(installed) {
  const loggedIn = !!S.account;
  const btn = $('btn-play');
  const lbl = $('play-label');

  if (!loggedIn) {
    lbl.textContent = 'SIGN IN';
    btn.disabled = true;
  } else if (installed === false) {
    lbl.textContent = 'INSTALL';
    btn.disabled = false;
    btn.onclick = doInstallAndPlay;
  } else {
    lbl.textContent = 'PLAY';
    btn.disabled = false;
    btn.onclick = doPlay;
  }

  $('btn-install').disabled = S.installing;
  $('btn-get-mods').disabled = S.installing;
}

// ── Install ────────────────────────────────────────────────────────────────────
async function doInstall() {
  if (S.installing) return;
  const version = $('version-select').value;
  const useFabric = $('use-fabric').checked;
  const fabricVersion = useFabric ? $('fabric-select').value : null;
  const gameDir = S.settings.gameDir || undefined;
  await runInstall(version, useFabric, fabricVersion, gameDir);
  checkInstalled();
}

async function doInstallAndPlay() {
  if (S.installing) return;
  const version = $('version-select').value;
  const useFabric = $('use-fabric').checked;
  const fabricVersion = useFabric ? $('fabric-select').value : null;
  const gameDir = S.settings.gameDir || undefined;
  const ok = await runInstall(version, useFabric, fabricVersion, gameDir);
  if (ok) doPlay();
}

async function runInstall(version, useFabric, fabricVersion, gameDir) {
  setInstalling(true);
  showProgress();
  const res = await window.api.invoke('game:install', { version, useFabric, fabricVersion, gameDir });
  setInstalling(false);
  if (!res.success) {
    hideProgress();
    alert(`Installation failed:\n${res.error}`);
    return false;
  }
  setTimeout(hideProgress, 2000);
  return true;
}

async function doGetMods() {
  if (S.installing) return;
  const version = $('version-select').value;
  if (!version) return alert('Please select a Minecraft version first.');
  const gameDir = S.settings.gameDir || await window.api.invoke('game:getDir');
  setInstalling(true);
  showProgress();
  setProgressText('Fetching mods from Modrinth...');

  // Navigate user to mods page with the search pre-populated with top mods
  document.querySelector('[data-page="mods"]').click();

  setInstalling(false);
  hideProgress();
}

async function doPlay() {
  if (S.installing || S.running) return;
  const version = $('version-select').value;
  const useFabric = $('use-fabric').checked;
  const gameDir = S.settings.gameDir || undefined;
  const ram = S.settings.ram;
  const javaPath = S.settings.javaPath || undefined;

  setRunning(true);
  openConsole();
  logLine('[XNVD] Starting Minecraft...', 'xnvd');

  const res = await window.api.invoke('game:launch', { version, useFabric, gameDir, ram, javaPath });
  if (!res.success) {
    logLine(`[ERROR] ${res.error}`, 'err');
    setRunning(false);
  }
}

// ── Progress ──────────────────────────────────────────────────────────────────
function wireProgress() {
  window.api.on('progress', ({ step, percent }) => {
    $('prog-fill').style.width = `${Math.min(100, percent || 0)}%`;
    setProgressText(step || '');
  });
}

function showProgress() {
  $('prog-wrap').classList.remove('hidden');
  $('prog-fill').style.width = '0%';
  setProgressText('Preparing...');
}

function hideProgress() { $('prog-wrap').classList.add('hidden'); }
function setProgressText(t) { $('prog-text').textContent = t; }

// ── Console ───────────────────────────────────────────────────────────────────
function wireConsole() {
  window.api.on('game:log', (line) => {
    const l = line.toLowerCase();
    const cls = l.includes('error') ? 'err'
      : l.includes('warn') ? 'warn'
      : line.startsWith('[XNVD]') ? 'xnvd'
      : '';
    logLine(line, cls);
    if (l.includes('game exited')) setRunning(false);
  });
  $('btn-console-hide').onclick = () => $('console-dock').classList.add('hidden');
}

function openConsole() {
  const dock = $('console-dock');
  dock.classList.remove('hidden');
  $('console-out').innerHTML = '';
}

function logLine(text, cls = '') {
  const out = $('console-out');
  const p = document.createElement('p');
  if (cls) p.className = `log-${cls}`;
  p.textContent = text;
  out.appendChild(p);
  out.scrollTop = out.scrollHeight;
  while (out.children.length > 600) out.removeChild(out.firstChild);
}

// ── State helpers ─────────────────────────────────────────────────────────────
function setInstalling(v) {
  S.installing = v;
  $('btn-install').disabled = v;
  $('btn-get-mods').disabled = v;
  if (!v) updatePlayBtn();
}

function setRunning(v) {
  S.running = v;
  if (!v) updatePlayBtn();
}

// ── Mods Page ──────────────────────────────────────────────────────────────────
let searchDebounce = null;

function wireMods() {
  // Tab switching
  document.querySelectorAll('.mtab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.mtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.currentTab = btn.dataset.tab;
      $('tab-browse').classList.toggle('hidden', S.currentTab !== 'browse');
      $('tab-installed').classList.toggle('hidden', S.currentTab !== 'installed');
      if (S.currentTab === 'installed') refreshInstalledList();
    };
  });

  // Search
  $('mod-search').oninput = () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runSearch, 450);
  };

  $('mod-search').onkeydown = (e) => {
    if (e.key === 'Enter') { clearTimeout(searchDebounce); runSearch(); }
  };

  // Open folder
  $('btn-open-folder').onclick = async () => {
    const gameDir = S.settings.gameDir || await window.api.invoke('game:getDir');
    window.api.invoke('mods:openFolder', gameDir);
  };

  // Load popular mods on open
  runSearch('');
}

async function runSearch(overrideQuery) {
  const query = overrideQuery !== undefined ? overrideQuery : $('mod-search').value;
  const version = $('version-select').value;
  const spin = $('search-spin');
  spin.classList.remove('hidden');

  const results = await window.api.invoke('mods:search', { query, gameVersion: version });
  spin.classList.add('hidden');

  renderBrowseGrid(results);
}

function renderBrowseGrid(results) {
  const grid = $('browse-grid');
  if (!results || results.length === 0) {
    grid.innerHTML = `
      <div class="mods-empty">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <p>No mods found. Try a different search term.</p>
      </div>`;
    return;
  }

  grid.innerHTML = results.map(mod => `
    <div class="mod-card" data-slug="${mod.slug}">
      <div class="mod-card-head">
        ${mod.iconUrl
          ? `<img class="mod-icon" src="${mod.iconUrl}" alt="" onerror="this.replaceWith(makeFallbackIcon('${mod.title}'))">`
          : `<div class="mod-icon-fallback">${mod.title.charAt(0)}</div>`
        }
        <div class="mod-card-meta">
          <div class="mod-title">${esc(mod.title)}</div>
          <div class="mod-author">by ${esc(mod.author)}</div>
        </div>
      </div>
      <div class="mod-desc">${esc(mod.description)}</div>
      <div class="mod-footer">
        <span class="mod-downloads">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
          ${fmtNum(mod.downloads)}
        </span>
        <button class="mod-install-btn ${mod.installed ? 'installed' : ''}"
          data-slug="${mod.slug}"
          onclick="installMod('${mod.slug}', this)"
          ${mod.installed ? 'disabled' : ''}>
          ${mod.installed ? '✓ Installed' : 'Install'}
        </button>
      </div>
    </div>
  `).join('');
}

async function installMod(slug, btn) {
  if (!$('version-select').value) return alert('Select a Minecraft version first.');
  btn.textContent = 'Installing...';
  btn.className = 'mod-install-btn installing';
  btn.disabled = true;

  const gameDir = S.settings.gameDir || await window.api.invoke('game:getDir');
  const version = $('version-select').value;
  const res = await window.api.invoke('mods:install', { slug, gameVersion: version, gameDir });

  if (res.success) {
    btn.textContent = '✓ Installed';
    btn.className = 'mod-install-btn installed';
    refreshInstalledBadge();
  } else {
    btn.textContent = 'Failed';
    btn.className = 'mod-install-btn';
    btn.disabled = false;
    alert(`Install failed:\n${res.error}`);
  }
}

async function refreshInstalledList() {
  const gameDir = S.settings.gameDir || await window.api.invoke('game:getDir');
  const list = await window.api.invoke('mods:installed', gameDir);
  const el = $('installed-list');
  refreshInstalledBadge(list.length);

  if (list.length === 0) {
    el.innerHTML = `
      <div class="installed-empty">
        <p>No mods installed yet.<br>Use the Browse tab to find and install mods.</p>
      </div>`;
    return;
  }

  el.innerHTML = list.map(m => `
    <div class="installed-item">
      <div class="installed-icon">📦</div>
      <div class="installed-name" title="${esc(m.filename)}">${esc(m.filename.replace(/\.jar$/, ''))}</div>
      <span class="installed-size">${m.sizeStr}</span>
      <button class="remove-btn" onclick="removeMod('${esc(m.filename)}', this)">Remove</button>
    </div>
  `).join('');
}

async function removeMod(filename, btn) {
  btn.textContent = 'Removing...';
  btn.disabled = true;
  const gameDir = S.settings.gameDir || await window.api.invoke('game:getDir');
  await window.api.invoke('mods:remove', { filename, gameDir });
  refreshInstalledList();
  runSearch($('mod-search').value); // refresh install states in browse
}

async function refreshInstalledBadge(count) {
  if (count === undefined) {
    const gameDir = S.settings.gameDir || await window.api.invoke('game:getDir');
    const list = await window.api.invoke('mods:installed', gameDir);
    count = list.length;
  }
  $('installed-badge').textContent = count;
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const stored = await window.api.invoke('store:get', 'settings');
  if (stored) S.settings = { ...S.settings, ...stored };
}

function wireSettings() {
  $('ram-slider').value = S.settings.ram;
  $('ram-bubble').textContent = `${S.settings.ram} MB`;
  $('gamedir-input').value = S.settings.gameDir || '';
  $('java-input').value = S.settings.javaPath || '';

  $('ram-slider').oninput = () => {
    const v = $('ram-slider').value;
    $('ram-bubble').textContent = `${v} MB`;
  };

  $('btn-browse-dir').onclick = async () => {
    const d = await window.api.invoke('dialog:dir');
    if (d) $('gamedir-input').value = d;
  };

  $('btn-browse-java').onclick = async () => {
    const f = await window.api.invoke('dialog:file');
    if (f) $('java-input').value = f;
  };

  $('btn-save').onclick = async () => {
    S.settings = {
      ram: parseInt($('ram-slider').value),
      gameDir: $('gamedir-input').value.trim(),
      javaPath: $('java-input').value.trim()
    };
    await window.api.invoke('store:set', 'settings', S.settings);
    const ok = $('save-ok');
    ok.classList.remove('hidden');
    setTimeout(() => ok.classList.add('hidden'), 2500);
    checkInstalled();
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// ── Updater ────────────────────────────────────────────────────────────────────

let _updateInfo = null;

function wireUpdater() {
  // Listen for update notification pushed from main process
  window.api.on('update:available', info => showUpdateBanner(info));

  // Buttons in the banner
  $('btn-update-download').onclick = () => {
    if (_updateInfo?.url) window.api.send('updater:openRelease', _updateInfo.url);
  };
  $('btn-update-notes').onclick = () => {
    if (!_updateInfo) return;
    $('modal-version-label').textContent = `What's New in v${_updateInfo.version}`;
    $('modal-notes').textContent = _updateInfo.notes || '';
    $('update-modal').classList.remove('hidden');
  };
  $('btn-update-dismiss').onclick = () => {
    $('update-bar').classList.add('hidden');
  };

  // Modal close
  $('btn-modal-close').onclick = () => $('update-modal').classList.add('hidden');
  $('btn-modal-download').onclick = () => {
    if (_updateInfo?.url) window.api.send('updater:openRelease', _updateInfo.url);
  };
  $('update-modal').onclick = e => {
    if (e.target === $('update-modal')) $('update-modal').classList.add('hidden');
  };

  // Manual check: expose for settings page later
  window._checkForUpdates = async () => {
    const info = await window.api.invoke('updater:check');
    if (info.available) showUpdateBanner(info);
    return info;
  };
}

function showUpdateBanner(info) {
  _updateInfo = info;
  const bar = $('update-bar');
  $('update-version-label').textContent = `v${info.version}`;
  const cur = $('update-current-label');
  window.api.invoke('updater:info').then(i => { cur.textContent = `v${i.current}`; });
  bar.classList.remove('hidden');
}

// ── Cosmetics ──────────────────────────────────────────────────────────────────

// Build a CSS gradient string from the cape definition colors array
function capeGradientCss(colors) {
  if (!colors) return 'rgba(255,255,255,0.06)';
  const stops = colors.map((c, i) => `${c} ${Math.round(i / (colors.length - 1) * 100)}%`).join(', ');
  return `linear-gradient(135deg, ${stops})`;
}

async function wireCosmetics() {
  S.capes = await window.api.invoke('cosmetics:list');
  const gameDir = S.settings.gameDir || await window.api.invoke('game:getDir');
  const cfg = await window.api.invoke('cosmetics:get', gameDir);
  S.equippedCape = cfg.capeId || 'none';
  S.selectedCape = S.equippedCape;

  renderCapeGrid();
  updateCapePreview(S.selectedCape);
  updateEquippedBadge();

  $('btn-equip-cape').onclick = async () => {
    const btn = $('btn-equip-cape');
    const dir = S.settings.gameDir || await window.api.invoke('game:getDir');
    btn.disabled = true;
    btn.textContent = 'Equipping…';

    const res = await window.api.invoke('cosmetics:equip', { capeId: S.selectedCape, gameDir: dir });
    if (res.success) {
      S.equippedCape = S.selectedCape;
      updateEquippedBadge();
      renderCapeGrid();
      showEquipStatus('✓ Equipped! Re-launch Minecraft to see your cape.', true);
    } else {
      showEquipStatus('✗ ' + (res.error || 'Failed'), false);
    }
    btn.textContent = 'Equip Cape';
    btn.disabled = false;
  };
}

function renderCapeGrid() {
  const grid = $('cape-grid');
  grid.innerHTML = '';
  S.capes.forEach(cape => {
    const card = document.createElement('div');
    card.className = 'cape-card' +
      (cape.id === S.selectedCape ? ' selected' : '');
    card.innerHTML = `
      <div class="cape-swatch" style="background:${capeGradientCss(cape.colors)}"></div>
      <div class="cape-label">
        <div class="cape-label-name">${esc(cape.name)}</div>
        ${cape.tag ? `<div class="cape-label-tag">${esc(cape.tag)}</div>` : ''}
        ${cape.id === S.equippedCape && cape.id !== 'none'
          ? '<div class="cape-label-tag" style="background:linear-gradient(90deg,#22c55e,#16a34a)">ON</div>'
          : ''}
      </div>`;
    card.onclick = () => {
      S.selectedCape = cape.id;
      renderCapeGrid();
      updateCapePreview(cape.id);
      const btn = $('btn-equip-cape');
      btn.disabled = false;
      btn.textContent = cape.id === 'none' ? 'Remove Cape' : 'Equip Cape';
      $('equip-status').classList.add('hidden');
    };
    grid.appendChild(card);
  });
}

function updateCapePreview(capeId) {
  const cape = S.capes.find(c => c.id === capeId) || S.capes[0];
  $('preview-name').textContent = cape.name;
  $('preview-desc').textContent = cape.desc || '—';
  const swatch = $('cape-preview-swatch');
  swatch.style.background = capeGradientCss(cape.colors);
  swatch.style.opacity = capeId === 'none' ? '0' : '1';
}

function updateEquippedBadge() {
  const badge = $('cos-equipped-badge');
  const cape = S.capes.find(c => c.id === S.equippedCape);
  if (S.equippedCape !== 'none' && cape) {
    $('cos-equipped-name').textContent = cape.name;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function showEquipStatus(msg, ok) {
  const el = $('equip-status');
  el.textContent = msg;
  el.style.color = ok ? 'var(--success)' : 'var(--error)';
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

// ── Start ──────────────────────────────────────────────────────────────────────
boot();
