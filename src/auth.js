const { BrowserWindow, session } = require('electron');
const https = require('https');

const CLIENT_ID = '00000000402b5328';
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';

function httpPost(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isJson = typeof body !== 'string';
    const bodyStr = isJson ? JSON.stringify(body) : body;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Accept': 'application/json',
        ...extraHeaders
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      headers: { 'Accept': 'application/json', ...headers }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getAuthCode(parentWindow) {
  return new Promise((resolve, reject) => {
    const authUrl =
      `https://login.live.com/oauth20_authorize.srf` +
      `?client_id=${CLIENT_ID}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=XboxLive.signin%20offline_access` +
      `&prompt=select_account`;

    // Dedicated session so webRequest listeners don't leak into the main window
    const authSession = session.fromPartition('microsoft-auth');

    const win = new BrowserWindow({
      width: 500,
      height: 660,
      title: 'Sign in with Microsoft',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: authSession
      }
    });

    let settled = false;

    const ok = (code) => {
      if (settled) return;
      settled = true;
      try { authSession.webRequest.onBeforeRequest(null); } catch {}
      if (!win.isDestroyed()) win.destroy();
      resolve(code);
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { authSession.webRequest.onBeforeRequest(null); } catch {}
      if (!win.isDestroyed()) win.destroy();
      reject(err);
    };

    const handleUrl = (url) => {
      if (!url) return;
      if (!url.startsWith(REDIRECT_URI)) return;
      try {
        const u = new URL(url);
        const code = u.searchParams.get('code');
        const error = u.searchParams.get('error');
        if (error) fail(new Error(`Microsoft auth error: ${error}`));
        else if (code) ok(code);
        else fail(new Error('Redirect contained no auth code'));
      } catch (e) { fail(e); }
    };

    // onBeforeRequest fires before the browser navigates — most reliable method
    authSession.webRequest.onBeforeRequest(
      { urls: [`${REDIRECT_URI}*`] },
      (details, callback) => {
        handleUrl(details.url);
        callback({ cancel: true }); // don't actually load the blank desktop page
      }
    );

    // Fallback events in case redirect happens differently
    win.webContents.on('will-navigate', (_, url) => handleUrl(url));
    win.webContents.on('will-redirect', (_, url) => handleUrl(url));
    win.webContents.on('did-navigate', (_, url) => handleUrl(url));

    win.on('closed', () => fail(new Error('Login was cancelled')));
    win.loadURL(authUrl);
  });
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI
  }).toString();
  const res = await httpPost('https://login.live.com/oauth20_token.srf', body);
  if (res.status !== 200) throw new Error(`Microsoft token exchange failed (${res.status})`);
  return res.body;
}

async function refreshMs(refreshToken) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    redirect_uri: REDIRECT_URI
  }).toString();
  const res = await httpPost('https://login.live.com/oauth20_token.srf', body);
  if (res.status !== 200) throw new Error('Microsoft token refresh failed');
  return res.body;
}

async function xboxLive(msToken) {
  const res = await httpPost('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  });
  if (res.status !== 200) throw new Error('Xbox Live authentication failed');
  return { xblToken: res.body.Token, uhs: res.body.DisplayClaims.xui[0].uhs };
}

async function xsts(xblToken) {
  const res = await httpPost('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  });
  if (res.status !== 200) {
    const x = res.body?.XErr;
    if (x === 2148916233) throw new Error('This Microsoft account has no Xbox profile. Visit xbox.com to set one up.');
    if (x === 2148916238) throw new Error('Xbox Live is unavailable in your region.');
    throw new Error(`XSTS auth failed (XErr: ${x})`);
  }
  return res.body.Token;
}

async function mcAuth(uhs, xstsToken) {
  const res = await httpPost(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    { identityToken: `XBL3.0 x=${uhs};${xstsToken}` }
  );
  if (res.status !== 200) throw new Error('Minecraft authentication failed');
  return res.body.access_token;
}

async function mcProfile(mcToken) {
  const res = await httpGet(
    'https://api.minecraftservices.com/minecraft/profile',
    { Authorization: `Bearer ${mcToken}` }
  );
  if (res.status === 404) throw new Error('This account does not own Minecraft Java Edition.');
  if (res.status !== 200) throw new Error('Failed to fetch Minecraft profile');
  return res.body;
}

async function fullChain(msAccessToken, msRefreshToken) {
  const { xblToken, uhs } = await xboxLive(msAccessToken);
  const xstsToken = await xsts(xblToken);
  const mcToken = await mcAuth(uhs, xstsToken);
  const profile = await mcProfile(mcToken);
  return {
    username: profile.name,
    uuid: profile.id,
    accessToken: mcToken,
    msRefreshToken,
    expiresAt: Date.now() + 3600 * 1000
  };
}

async function loginWithMicrosoft(parentWindow) {
  const code = await getAuthCode(parentWindow);
  const msTokens = await exchangeCode(code);
  return fullChain(msTokens.access_token, msTokens.refresh_token);
}

async function refreshAccount(account) {
  const msTokens = await refreshMs(account.msRefreshToken);
  return fullChain(msTokens.access_token, msTokens.refresh_token || account.msRefreshToken);
}

module.exports = { loginWithMicrosoft, refreshAccount };
