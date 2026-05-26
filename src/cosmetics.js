/**
 * XNVD Cosmetics — cape generation, equipping, and config persistence.
 * Generates 64×32 RGBA PNGs in-process (no canvas/sharp needed — pure zlib).
 */

'use strict';
const path = require('path');
const fs   = require('fs');
const zlib = require('zlib');

// ── Cape catalogue ────────────────────────────────────────────────────────────

const CAPES = [
  {
    id: 'none',    name: 'No Cape',  desc: 'Hide your cape',
    tag: null,     colors: null
  },
  {
    id: 'xnvd',   name: 'XNVD',     desc: 'Official XNVD signature cape',
    tag: 'XNVD',  colors: ['#7C3AED', '#A855F7', '#22D3EE'], premium: true
  },
  {
    id: 'nebula', name: 'Nebula',   desc: 'Purple → cyan cosmic gradient',
    tag: null,    colors: ['#4F1B8C', '#7C3AED', '#06B6D4']
  },
  {
    id: 'solar',  name: 'Solar',    desc: 'Blazing orange inferno',
    tag: null,    colors: ['#7F1D1D', '#EF4444', '#F97316']
  },
  {
    id: 'arctic', name: 'Arctic',   desc: 'Ice-cold glacial blue',
    tag: null,    colors: ['#0C4A6E', '#0EA5E9', '#BAE6FD']
  },
  {
    id: 'shadow', name: 'Shadow',   desc: 'Pure darkness',
    tag: null,    colors: ['#09090B', '#18181B', '#3F3F46']
  },
  {
    id: 'emerald',name: 'Emerald',  desc: 'Deep forest green shimmer',
    tag: null,    colors: ['#064E3B', '#10B981', '#6EE7B7']
  },
  {
    id: 'crimson',name: 'Crimson',  desc: 'Blood-red pulse',
    tag: null,    colors: ['#450A0A', '#DC2626', '#F87171']
  },
  {
    id: 'galaxy', name: 'Galaxy',   desc: 'Starfield with cosmic dust',
    tag: null,    colors: ['#0F0A1E', '#1E1B4B', '#60A5FA'], stars: true
  },
  {
    id: 'rose',   name: 'Rose',     desc: 'Warm pink blossom',
    tag: null,    colors: ['#4C0519', '#E11D48', '#FDA4AF']
  },
  {
    id: 'aurora', name: 'Aurora',   desc: 'Northern lights shimmer',
    tag: null,    colors: ['#064E3B', '#06B6D4', '#A855F7']
  },
  {
    id: 'void',   name: 'Void',     desc: 'Deep space abyss',
    tag: null,    colors: ['#020617', '#0F172A', '#1E293B']
  },
];

// ── PNG helpers ───────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len  = Buffer.alloc(4);  len.writeUInt32BE(data.length);
  const tb   = Buffer.from(type);
  const crcB = Buffer.alloc(4);  crcB.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([len, tb, data, crcB]);
}

// ── Pixel math ────────────────────────────────────────────────────────────────

function hex2rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

function lerp(a, b, t) { return a + (b - a) * t; }

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function multiStop(colors, t) {
  const segs = colors.length - 1;
  const s = Math.min(Math.floor(t * segs), segs - 1);
  const lt = t * segs - s;
  const c1 = hex2rgb(colors[s]);
  const c2 = hex2rgb(colors[s + 1]);
  return [lerp(c1[0], c2[0], lt), lerp(c1[1], c2[1], lt), lerp(c1[2], c2[2], lt)];
}

// ── Cape PNG generator ────────────────────────────────────────────────────────
//  Output: 64×32 RGBA PNG matching the Minecraft cape UV layout.

function generateCapePng(cape) {
  const W = 64, H = 32;
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 4);
    row[0] = 0; // filter = None
    for (let x = 0; x < W; x++) {
      let r, g, b, a = 255;

      if (!cape.colors) { r = g = b = a = 0; }
      else {
        // Diagonal gradient t ∈ [0,1]
        const t = (x / (W - 1) * 0.6 + y / (H - 1) * 0.4);
        let [rr, gg, bb] = multiStop(cape.colors, t);

        // XNVD: overlay bright X in the cape face region (pixels 0–9 wide, 0–15 tall)
        if (cape.id === 'xnvd' && x < 10 && y < 16) {
          const nx = (x - 4.5) / 4.5;
          const ny = (y - 7.5) / 7.5;
          const d = Math.min(Math.abs(nx - ny), Math.abs(nx + ny));
          if (Math.abs(nx) < 0.85 && Math.abs(ny) < 0.85 && d < 0.22) {
            rr = lerp(rr, 255, 0.55);
            gg = lerp(gg, 255, 0.55);
            bb = lerp(bb, 255, 0.55);
          }
        }

        // Galaxy: scatter bright star pixels
        if (cape.stars) {
          const h = ((x * 1299709 + y * 9999991) ^ (x * 7 + y * 13)) & 0xFFFF;
          if (h < 320) { rr = gg = bb = 240; }
        }

        // Subtle brightness noise (makes it look textured)
        const noise = ((x * 127 + y * 311) % 16) / 16 * 12 - 6;

        r = clamp(rr + noise);
        g = clamp(gg + noise);
        b = clamp(bb + noise);
      }

      const i = 1 + x * 4;
      row[i] = r; row[i + 1] = g; row[i + 2] = b; row[i + 3] = a;
    }
    rows.push(row);
  }

  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── Public API ────────────────────────────────────────────────────────────────

function cosmeticsPath(gameDir) { return path.join(gameDir, 'xnvd-cosmetics.json'); }
function capePngPath(gameDir)   { return path.join(gameDir, 'xnvd-cape.png'); }

function loadCosmetics(gameDir) {
  try { return JSON.parse(fs.readFileSync(cosmeticsPath(gameDir), 'utf8')); }
  catch { return { capeId: 'none', equipped: false }; }
}

function equipCape(capeId, gameDir) {
  const cape = CAPES.find(c => c.id === capeId);
  if (!cape) throw new Error('Unknown cape: ' + capeId);

  fs.mkdirSync(gameDir, { recursive: true });

  if (capeId !== 'none') {
    fs.writeFileSync(capePngPath(gameDir), generateCapePng(cape));
  } else {
    try { fs.unlinkSync(capePngPath(gameDir)); } catch { /* ok */ }
  }

  const cfg = { capeId, equipped: capeId !== 'none', updatedAt: Date.now() };
  fs.writeFileSync(cosmeticsPath(gameDir), JSON.stringify(cfg, null, 2));
  return cfg;
}

module.exports = { CAPES, loadCosmetics, equipCape };
