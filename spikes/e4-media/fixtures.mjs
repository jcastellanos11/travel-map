import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createDeflate } from 'node:zlib';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { sharp } from './deps.mjs';
import { exif, jpegMetadata, pngMetadata, webpMetadata, pngChunk, apng } from './containers.mjs';
export const runRoot = new URL('./runs/current/', import.meta.url);
export async function fixtures() {
  await mkdir(runRoot, { recursive: true, mode: 0o700 });
  const width = 128, height = 80, colors = [[240,20,20],[20,220,20],[20,20,240],[230,220,20]];
  const raw = Buffer.alloc(width * height * 3), rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = colors[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)], at = y * width + x;
    color.forEach((v, c) => { raw[at * 3 + c] = v; rgba[at * 4 + c] = v; }); rgba[at * 4 + 3] = x < 8 ? 0 : 255;
  }
  const rgb = { width, height, channels: 3 }, alpha = { width, height, channels: 4 };
  const jpeg = await sharp(raw, { raw: rgb }).jpeg({ quality: 98 }).toBuffer();
  const png = await sharp(rgba, { raw: alpha }).png().toBuffer(), webp = await sharp(rgba, { raw: alpha }).webp({ lossless: true }).toBuffer();
  const samples = { jpeg: jpegMetadata(jpeg), png: pngMetadata(png), webp: webpMetadata(webp, width, height) };
  for (const [name, bytes] of Object.entries(samples)) await writeFile(new URL(`synthetic.${name}`, runRoot), bytes, { mode: 0o600 });
  const results = { width, height, colors, raw, samples, jpeg, png, webp, exif: exif() };
  results.icc = await sharp(raw, { raw: rgb }).withIccProfile('p3').png().toBuffer();
  const second = Buffer.from(rgba); for(let i=0;i<second.length;i+=4) second[i] = 255-second[i];
  results.animation = await sharp(Buffer.concat([rgba, second]), { raw: { ...alpha, height: height * 2, pageHeight: height } }).webp({ loop: 0, delay: [100,100] }).toBuffer();
  results.apng = apng();
  const ihdr16 = Buffer.alloc(13); ihdr16.writeUInt32BE(2); ihdr16.writeUInt32BE(2, 4); ihdr16[8] = 16; ihdr16[9] = 2;
  const { deflateSync } = await import('node:zlib');
  results.png16 = Buffer.concat([png.subarray(0,8), pngChunk('IHDR', ihdr16), pngChunk('IDAT', deflateSync(Buffer.alloc(26))), pngChunk('IEND', Buffer.alloc(0))]);
  const encoded = []; const zip = createDeflate(); zip.on('data', b => encoded.push(b));
  const row = Buffer.alloc(5000 * 3 + 1);
  for (let i = 0; i < 10000; i++) if (!zip.write(row)) await once(zip, 'drain');
  zip.end(); await once(zip, 'end');
  const header = Buffer.alloc(13); header.writeUInt32BE(5000); header.writeUInt32BE(10000,4); header[8]=8; header[9]=2;
  results.bomb = Buffer.concat([png.subarray(0,8), pngChunk('IHDR', header), pngChunk('IDAT', Buffer.concat(encoded)), pngChunk('IEND',Buffer.alloc(0))]);
  results.bombDecodedBytes = row.length * 10000;
  // OS codec probes only; no personal photos, external fixture downloads or fallback in production.
  const input = new URL('synthetic.jpeg', runRoot), heic = new URL('synthetic.heic', runRoot);
  const encodedHeic = spawnSync('/usr/bin/sips', ['-s', 'format', 'heic', input.pathname, '--out', heic.pathname], { timeout: 30000, encoding: 'utf8' });
  results.sipsEncode = { status: encodedHeic.status, error: encodedHeic.error?.code };
  if (encodedHeic.status === 0) {
    results.samples.heic = await readFile(heic);
    const heif = Buffer.from(results.samples.heic); heif.write('mif1', 8);
    results.samples.heif = heif; await writeFile(new URL('synthetic.heif', runRoot), heif, { mode: 0o600 });
  }
  return results;
}
