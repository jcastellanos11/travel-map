import { sharp } from './deps.mjs';
import { pngChunks, webpChunks, safeRaster } from './containers.mjs';
// Provisional security/output policies for experiments, NOT approved application limits.
export const POLICY = { maxInputBytes: 20_000_000, maxBatch: 10, userBytes: 500_000_000, maxPixels: 40_000_000, maxEdge: 12_000, outputCaps: { archival: 64_000_000, display: 4_000_000, thumbnail: 500_000 } };
sharp.cache(false); sharp.concurrency(1);
export function sniff(b) {
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('ascii', 4, 8) === 'ftyp') {
    const brands=b.toString('ascii',8,Math.min(b.length,b.readUInt32BE(0)));
    if(!/avif|avis/.test(brands) && /heic|heix|hevc|hevx|mif1|msf1/.test(brands)) return 'heif';
  }
  throw Error('FORMAT_NOT_ALLOWED');
}
export async function processImage(b, declaredMime, {archive='lossless-webp'}={}) {
  if (!b.length || b.length > POLICY.maxInputBytes) throw Error('INPUT_SIZE');
  const format = sniff(b), allowed = { jpeg: ['image/jpeg'], png: ['image/png'], webp: ['image/webp'], heif: ['image/heic', 'image/heif'] };
  if (declaredMime && declaredMime !== 'application/octet-stream' && !allowed[format].includes(declaredMime)) throw Error('MIME_MISMATCH');
  if (format === 'jpeg' && (b[b.length - 2] !== 255 || b[b.length - 1] !== 217)) throw Error('JPEG_END');
  if (format === 'png' && pngChunks(b).some(c => c.type === 'acTL' && c.data.readUInt32BE(0) > 1)) throw Error('ANIMATION_NOT_ALLOWED');
  if (format === 'webp' && webpChunks(b).some(c => ['ANIM', 'ANMF'].includes(c.type))) throw Error('ANIMATION_NOT_ALLOWED');
  const options = { failOn: 'warning', limitInputPixels: POLICY.maxPixels, sequentialRead: true, unlimited: false };
  const metadata = await sharp(b, options).metadata();
  if (!metadata.width || !metadata.height || metadata.width > POLICY.maxEdge || metadata.height > POLICY.maxEdge || metadata.width * metadata.height > POLICY.maxPixels) throw Error('DIMENSIONS');
  if ((metadata.pages ?? 1) > 1) throw Error('MULTIPAGE_NOT_ALLOWED');
  if (metadata.depth !== 'uchar') throw Error('BIT_DEPTH_NOT_ALLOWED');
  // Raw pixel barrier: no EXIF, XMP, IPTC, comments, ICC or upload bytes are copied.
  const decoded = await sharp(b, options).autoOrient().toColourspace('srgb').raw().timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
  const raw = { width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels };
  const results = {};
  for (const [name, edge, quality] of [['archival', null, null], ['display', 2560, 82], ['thumbnail', 480, 72]]) {
    let pipeline = sharp(decoded.data, { raw });
    if (edge) pipeline = pipeline.resize(edge, edge, { fit: 'inside', withoutEnlargement: true });
    const format=name==='archival'&&archive==='jpeg-png'?(decoded.info.channels===4?'png':'jpeg'):'webp';
    if(format==='jpeg')pipeline=pipeline.jpeg({quality:95,chromaSubsampling:'4:4:4',progressive:false});
    else if(format==='png')pipeline=pipeline.png({compressionLevel:6});
    else pipeline=pipeline.webp(quality ? { quality, alphaQuality: 100, effort: 4 } : { lossless: true, effort: 4 });
    const data = await pipeline.timeout({ seconds: 10 }).toBuffer();
    if (data.length > POLICY.outputCaps[name]) throw Error('OUTPUT_BUDGET');
    const chunks = safeRaster(data,format); const meta = await sharp(data).metadata();
    results[name] = { data, format, bytes: data.length, width: meta.width, height: meta.height, chunks, hasAlpha: meta.hasAlpha };
  }
  return { source: { format, width: metadata.width, height: metadata.height }, oriented: raw, variants: results };
}
