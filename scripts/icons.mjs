import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

// Renders the brand SVG into the fixed-size PNGs referenced by the web app
// manifest and the iOS apple-touch-icon. PNGs are committed, so this only runs
// when the logo changes: `npm run icons`.
const app = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(app, 'public/quranic-words-logo.svg');
const out = path.join(app, 'public/icons');
await mkdir(out, {recursive: true});

const maskable = size => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#2563eb"/></svg>`);

const jobs = [
  [path.join(out, 'icon-192.png'), sharp(source).resize(192, 192)],
  [path.join(out, 'icon-512.png'), sharp(source).resize(512, 512)],
  [path.join(out, 'apple-touch-icon.png'), sharp(source).resize(180, 180)],
];
for (const size of [192, 512]) {
  // Maskable icons need a full-bleed background with the logo in the 80% safe zone.
  const logoAt = await sharp(source).resize(Math.round(size * 0.8), Math.round(size * 0.8)).png().toBuffer();
  jobs.push([path.join(out, `icon-maskable-${size}.png`),
    sharp(maskable(size)).composite([{input: logoAt}]).png()]);
}
for (const [file, pipeline] of jobs) await pipeline.png().toFile(file);
console.log(`Generated ${jobs.length} PWA icons in public/icons.`);
