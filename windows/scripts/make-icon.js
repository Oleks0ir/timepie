// Packs the Mac iconset's PNGs into a Windows .ico (PNG-compressed entries).
const fs = require('fs');
const path = require('path');

const iconset = path.join(__dirname, '..', '..', 'AppIcon.iconset');
const out = path.join(__dirname, '..', 'build');
fs.mkdirSync(out, { recursive: true });

const sources = { 16: 'icon_16x16.png', 32: 'icon_32x32.png', 64: 'icon_32x32@2x.png', 128: 'icon_128x128.png', 256: 'icon_256x256.png' };
const images = Object.entries(sources).map(([size, file]) => ({ size: +size, data: fs.readFileSync(path.join(iconset, file)) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

let offset = 6 + 16 * images.length;
const dir = images.map(({ size, data }) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
  e.writeUInt8(size >= 256 ? 0 : size, 1);
  e.writeUInt16LE(1, 4);  // colour planes
  e.writeUInt16LE(32, 6); // bits per pixel
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  return e;
});

fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, ...dir, ...images.map((i) => i.data)]));
fs.copyFileSync(path.join(iconset, 'icon_256x256.png'), path.join(out, 'icon.png'));
console.log('  icon.ico + icon.png written');
