// generate-icon.js  — run once with: node generate-icon.js
// Creates assets/icon.ico using a hand-crafted BMP embedded in an ICO file structure
const fs = require('fs');
const path = require('path');

// We'll create a simple ICO with a 256x256 image using raw BMP data
// ICO format: File header + image directory + image data

function createIcon() {
  const sizes = [256, 64, 32, 16];
  const images = sizes.map(size => makeBmpImage(size));
  
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);    // reserved
  header.writeUInt16LE(1, 2);    // type = ICO
  header.writeUInt16LE(sizes.length, 4); // count
  
  // Directory entries: 16 bytes each
  const dirSize = 16 * sizes.length;
  let offset = 6 + dirSize;
  
  const dirs = images.map((img, i) => {
    const size = sizes[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);  // width (0=256)
    entry.writeUInt8(size === 256 ? 0 : size, 1);  // height
    entry.writeUInt8(0, 2);  // color count
    entry.writeUInt8(0, 3);  // reserved
    entry.writeUInt16LE(1, 4);  // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(img.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += img.length;
    return entry;
  });
  
  const out = Buffer.concat([header, ...dirs, ...images]);
  fs.writeFileSync(path.join(__dirname, 'assets', 'icon.ico'), out);
  console.log('Generated assets/icon.ico');
}

function makeBmpImage(size) {
  // BITMAPINFOHEADER (40 bytes) + pixel data (BGRA, bottom-up)
  const pixelCount = size * size;
  const pixelData = Buffer.alloc(pixelCount * 4);
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Background: dark #05050F
      let r = 5, g = 5, b = 15, a = 255;
      
      // Centered X shape in purple #A855F7
      const cx = size / 2, cy = size / 2;
      const nx = (x - cx) / (size * 0.35);
      const ny = (y - cy) / (size * 0.35);
      const thickness = 0.18;
      
      // Two diagonal strokes of X
      const d1 = Math.abs(nx - ny);   // top-left to bottom-right
      const d2 = Math.abs(nx + ny);   // top-right to bottom-left
      const inBounds = Math.abs(nx) < 0.95 && Math.abs(ny) < 0.95;
      
      if (inBounds && (d1 < thickness || d2 < thickness)) {
        // Purple X stroke
        const t = Math.min(1, (thickness - Math.min(d1, d2)) / thickness);
        r = Math.round(168 * t + 5 * (1-t));
        g = Math.round(85 * t + 5 * (1-t));
        b = Math.round(247 * t + 15 * (1-t));
        a = 255;
      }
      
      // BMP is BGRA
      pixelData[idx]     = b;
      pixelData[idx + 1] = g;
      pixelData[idx + 2] = r;
      pixelData[idx + 3] = a;
    }
  }
  
  // BMP info header for ICO (no file header, just BITMAPINFOHEADER)
  const infoHeader = Buffer.alloc(40);
  infoHeader.writeUInt32LE(40, 0);           // header size
  infoHeader.writeInt32LE(size, 4);          // width
  infoHeader.writeInt32LE(size * 2, 8);      // height * 2 (ICO quirk: includes mask)
  infoHeader.writeUInt16LE(1, 12);           // planes
  infoHeader.writeUInt16LE(32, 14);          // bit count
  infoHeader.writeUInt32LE(0, 16);           // compression (none)
  infoHeader.writeUInt32LE(pixelCount * 4, 20); // image size
  infoHeader.writeInt32LE(0, 24);            // x pixels per meter
  infoHeader.writeInt32LE(0, 28);            // y pixels per meter
  infoHeader.writeUInt32LE(0, 32);           // colors used
  infoHeader.writeUInt32LE(0, 36);           // colors important
  
  // AND mask (1 bit per pixel, rows padded to 4 bytes) — all transparent = 0
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRowBytes * size, 0);
  
  // Flip pixel data vertically (BMP is bottom-up)
  const flipped = Buffer.alloc(pixelData.length);
  for (let row = 0; row < size; row++) {
    pixelData.copy(flipped, row * size * 4, (size - 1 - row) * size * 4, (size - row) * size * 4);
  }
  
  return Buffer.concat([infoHeader, flipped, mask]);
}

createIcon();
