import { crc32, deflateSync } from 'node:zlib';
export const SENTINEL = 'E40_SYNTHETIC_PRIVATE_METADATA';
export function exif(orientation = 1) {
  const b = Buffer.alloc(512); b.write('II'); b.writeUInt16LE(42, 2); b.writeUInt32LE(8, 4); b.writeUInt16LE(5, 8);
  const entry = (at, tag, type, count, value) => { b.writeUInt16LE(tag, at); b.writeUInt16LE(type, at + 2); b.writeUInt32LE(count, at + 4); b.writeUInt32LE(value, at + 8); };
  entry(10, 271, 2, SENTINEL.length + 1, 320); entry(22, 274, 3, 1, orientation);
  entry(34, 306, 2, 20, 280); entry(46, 315, 2, SENTINEL.length + 1, 240); entry(58, 34853, 4, 1, 80);
  b.write(SENTINEL, 240); b.write('2000:01:01 00:00:00\0', 280); b.write(SENTINEL, 320);
  b.writeUInt16LE(5, 80); entry(82, 0, 1, 4, 0x00000302); entry(94, 1, 2, 2, 78);
  entry(106, 2, 5, 3, 160); entry(118, 3, 2, 2, 69); entry(130, 4, 5, 3, 184);
  for (const start of [160, 184]) for (let i = 0; i < 3; i++) b.writeUInt32LE(1, start + i * 8 + 4);
  return b;
}
export function pngChunk(type, data) {
  const head = Buffer.alloc(4), tag = Buffer.from(type), tail = Buffer.alloc(4); head.writeUInt32BE(data.length); tail.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([head, tag, data, tail]);
}
export function pngChunks(b) {
  if (!b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('BAD_PNG');
  const chunks = []; let at = 8;
  while (at + 12 <= b.length) {
    const n = b.readUInt32BE(at); if (at + n + 12 > b.length) throw Error('TRUNCATED_PNG');
    const type = b.toString('ascii', at + 4, at + 8), data = b.subarray(at + 8, at + 8 + n);
    if (crc32(b.subarray(at + 4, at + 8 + n)) !== b.readUInt32BE(at + 8 + n)) throw Error('PNG_CRC');
    chunks.push({ type, data }); at += n + 12;
    if (type === 'IEND') { if (at !== b.length) throw Error('PNG_TRAILING'); return chunks; }
  }
  throw Error('PNG_NO_END');
}
export function webpChunks(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP' || b.readUInt32LE(4) + 8 !== b.length) throw Error('BAD_RIFF');
  const chunks = []; let at = 12;
  while (at + 8 <= b.length) { const n = b.readUInt32LE(at + 4); if (at + n + 8 + (n % 2) > b.length) throw Error('TRUNCATED_RIFF'); chunks.push({ type: b.toString('ascii', at, at + 4), data: b.subarray(at + 8, at + 8 + n) }); at += n + 8 + (n % 2); }
  if (at !== b.length) throw Error('RIFF_TRAILING'); return chunks;
}
export function riff(chunks) {
  const body = Buffer.concat(chunks.map(({ type, data }) => { const h = Buffer.alloc(8); h.write(type); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, Buffer.alloc(data.length % 2)]); }));
  const h = Buffer.alloc(12); h.write('RIFF'); h.writeUInt32LE(body.length + 4, 4); h.write('WEBP', 8); return Buffer.concat([h, body]);
}
export function jpegMetadata(bytes, orientation = 1) {
  const app = (code, data) => { const h = Buffer.from([255, code, 0, 0]); h.writeUInt16BE(data.length + 2, 2); return Buffer.concat([h, data]); };
  return Buffer.concat([bytes.subarray(0, 2), app(225, Buffer.concat([Buffer.from('Exif\0\0'), exif(orientation)])), app(237, Buffer.from(SENTINEL)), app(254, Buffer.from(SENTINEL)), bytes.subarray(2)]);
}
export function pngMetadata(bytes, orientation = 1) {
  return Buffer.concat([bytes.subarray(0, 33), pngChunk('eXIf', exif(orientation)), pngChunk('tEXt', Buffer.from(`Comment\0${SENTINEL}`)), pngChunk('iTXt', Buffer.from(`XML:com.adobe.xmp\0\0\0\0\0<x>${SENTINEL} GPSLatitude=0</x>`)), bytes.subarray(33)]);
}
export function webpMetadata(bytes, width, height, orientation = 1) {
  const chunks = webpChunks(bytes), extended = Buffer.alloc(10); extended[0] = 0x1c; extended.writeUIntLE(width - 1, 4, 3); extended.writeUIntLE(height - 1, 7, 3);
  return riff([{ type: 'VP8X', data: extended }, ...chunks.filter(c => c.type !== 'VP8X'), { type: 'EXIF', data: Buffer.concat([Buffer.from('Exif\0\0'), exif(orientation)]) }, { type: 'XMP ', data: Buffer.from(SENTINEL) }]);
}
// Minimal true two-frame APNG, not a renamed static PNG.
export function apng() {
  const w = 8, h = 8, ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const control = seq => { const b = Buffer.alloc(26); b.writeUInt32BE(seq); b.writeUInt32BE(w, 4); b.writeUInt32BE(h, 8); b.writeUInt16BE(1, 20); b.writeUInt16BE(10, 22); return b; };
  const raw = value => deflateSync(Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.alloc(1), Buffer.alloc(w * 4, value)]))));
  const actl = Buffer.alloc(8); actl.writeUInt32BE(2); const seq = Buffer.alloc(4); seq.writeUInt32BE(2);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', ihdr), pngChunk('acTL', actl), pngChunk('fcTL', control(0)), pngChunk('IDAT', raw(40)), pngChunk('fcTL', control(1)), pngChunk('fdAT', Buffer.concat([seq, raw(180)])), pngChunk('IEND', Buffer.alloc(0))]);
}
export function safeWebp(bytes) {
  const chunks = webpChunks(bytes);
  if (!chunks.some(c => ['VP8 ', 'VP8L'].includes(c.type)) || chunks.some(c => !['VP8X', 'VP8 ', 'VP8L', 'ALPH'].includes(c.type))) throw Error('UNSAFE_OUTPUT_CHUNK');
  for (const c of chunks) if (c.type === 'VP8X' && c.data[0] & 0xef) throw Error('UNSAFE_OUTPUT_FLAGS'); // allow alpha only
  if (bytes.includes(Buffer.from(SENTINEL))) throw Error('METADATA_SENTINEL_LEAK');
  return chunks.map(c => c.type);
}
export function safeRaster(bytes,format) {
  if(format==='webp')return safeWebp(bytes);
  if(bytes.includes(Buffer.from(SENTINEL)))throw Error('METADATA_SENTINEL_LEAK');
  if(format==='png'){
    const chunks=pngChunks(bytes);if(chunks.some(c=>!['IHDR','PLTE','tRNS','IDAT','IEND','pHYs'].includes(c.type)))throw Error('UNSAFE_PNG_METADATA');return chunks.map(c=>c.type);
  }
  if(format!=='jpeg'||bytes[0]!==255||bytes[1]!==216)throw Error('BAD_JPEG');
  const markers=[];let at=2;
  while(at+4<=bytes.length){
    if(bytes[at]!==255)throw Error('BAD_JPEG_MARKER');const tag=bytes[at+1],n=bytes.readUInt16BE(at+2);if(n<2||at+n+2>bytes.length)throw Error('BAD_JPEG_SEGMENT');
    if(![0xe0,0xdb,0xc0,0xc4,0xdd,0xda].includes(tag))throw Error('UNSAFE_JPEG_METADATA');
    if(tag===0xe0&&bytes.toString('ascii',at+4,at+9)!=='JFIF\0')throw Error('UNSAFE_APP0');markers.push(tag);at+=n+2;
    if(tag===0xda){while(at<bytes.length-1){if(bytes[at++]!==255)continue;let value=bytes[at++];while(value===255)value=bytes[at++];if(value===0||value>=0xd0&&value<=0xd7)continue;if(value===0xd9&&at===bytes.length)return markers;throw Error('UNEXPECTED_JPEG_SCAN_MARKER');}throw Error('JPEG_END');}
  }throw Error('NO_JPEG_SCAN');
}
