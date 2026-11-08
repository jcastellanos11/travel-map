import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sharp, exifr } from './deps.mjs';
import { fixtures, runRoot } from './fixtures.mjs';
import { processImage, POLICY } from './processor.mjs';
import { jpegMetadata, pngChunk, pngChunks, webpChunks, safeRaster, SENTINEL } from './containers.mjs';
const report = { scope: 'Synthetic local Node/macOS only; no cloud/native-workerd inference', node: process.version, platform: process.platform, arch: process.arch, versions: sharp.versions, policy: POLICY, assertions: [], formats: [], benchmark: {}, limitations: ['Synthetic fixtures only, not iPhone/HDR/hostile corpus certification', 'V8 heap flag does not bound native memory', 'Sips probes write synthetic intermediate fixtures only, not an approved beta processing path'] };
async function check(id, task) {
  const started = performance.now();
  try { const detail = await task(); report.assertions.push({ id, status: 'PASS', elapsedMs: performance.now()-started, ...detail }); }
  catch (error) { report.assertions.push({ id, status: 'FAIL', error: error.message.slice(0,500) }); }
}
const f = await fixtures();
const summaries = result => Object.fromEntries(Object.entries(result.variants).map(([name,{ data, ...v }]) => [name, { ...v, sha256: createHash('sha256').update(data).digest('hex') }]));
async function gps(bytes) {
  if(bytes.toString('ascii',0,4)==='RIFF') {
    const chunk=webpChunks(bytes).find(c=>c.type==='EXIF');
    if(!chunk) return undefined;
    return exifr.gps(chunk.data.subarray(chunk.data.toString('ascii',0,6)==='Exif\0\0'?6:0));
  }
  return exifr.gps(bytes);
}
async function privacy(result) {
  for (const output of Object.values(result.variants)) {
    safeRaster(output.data,output.format);
    assert.equal(await gps(output.data), undefined);
    const metadata = await sharp(output.data).metadata();
    for (const key of ['exif','xmp','iptc','icc','orientation']) assert.equal(metadata[key], undefined);
    assert.ok(!output.data.includes(Buffer.from(SENTINEL)));
  }
}
for (const format of ['jpeg','png','webp']) await check(`${format}: decode, GPS proof and all-three-output sanitization`, async () => {
  const input = f.samples[format]; assert.ok(await gps(input));
  const result = await processImage(input, `image/${format}`); await privacy(result);
  assert.equal(result.variants.archival.width,128); assert.equal(result.variants.archival.height,80);
  for (const [name,v] of Object.entries(result.variants)) await writeFile(new URL(`${format}-${name}.webp`, runRoot), v.data, { mode: 0o600 });
  report.formats.push({ format, node: 'Verified', bytes: input.length, sourceGPSVerified: true, variants: summaries(result) });
});
for(const format of ['jpeg','png','webp']) await check(`${format}: lower-cost JPEG/PNG archival profile with full metadata stripping`,async()=>{
  const result=await processImage(f.samples[format],`image/${format}`,{archive:'jpeg-png'});await privacy(result);
  assert.equal(result.variants.archival.format,format==='jpeg'?'jpeg':'png');
  const source=await sharp(f.samples[format]).autoOrient().toColourspace('srgb').raw().toBuffer();
  const decoded=await sharp(result.variants.archival.data).raw().toBuffer();let mse=0;for(let i=0;i<source.length;i++)mse+=(source[i]-decoded[i])**2;mse/=source.length;
  return {variants:summaries(result),archivalPSNRdB:mse?10*Math.log10(255**2/mse):'lossless decoded pixels'};
});
for (const orientation of [1,2,3,4,5,6,7,8]) await check(`EXIF orientation ${orientation}: pixel corner verification`, async () => {
  const result = await processImage(jpegMetadata(f.jpeg, orientation), 'image/jpeg');
  const { data, info } = await sharp(result.variants.archival.data).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const expected = { 1:[0,1,2,3],2:[1,0,3,2],3:[3,2,1,0],4:[2,3,0,1],5:[0,2,1,3],6:[2,0,3,1],7:[3,1,2,0],8:[1,3,0,2] }[orientation];
  const points = [[10,10],[info.width-11,10],[10,info.height-11],[info.width-11,info.height-11]];
  points.forEach(([x,y],i) => f.colors[expected[i]].forEach((v,c) => assert.ok(Math.abs(data[(y*info.width+x)*3+c]-v)<20)));
  assert.equal(info.width, orientation>=5?80:128); await privacy(result);
});
await check('ICC Display-P3 conversion to untagged sRGB with pixel verification', async () => {
  assert.ok((await sharp(f.icc).metadata()).icc); const output = await processImage(f.icc,'image/png'); await privacy(output);
  const pixels = await sharp(output.variants.archival.data).raw().toBuffer(); let maxError=0;
  for(let i=0;i<pixels.length;i++) maxError=Math.max(maxError,Math.abs(pixels[i]-f.raw[i]));
  assert.ok(maxError<=6, `Color error ${maxError}`); return { maxChannelError: maxError };
});
await check('PNG/WebP transparency preserved', async () => {
  for(const fmt of ['png','webp']) { const r=await processImage(f.samples[fmt],`image/${fmt}`); for(const v of Object.values(r.variants)){assert.equal(v.hasAlpha,true); const raw=await sharp(v.data).ensureAlpha().raw().toBuffer(); assert.equal(raw[3],0);} }
});
await check('declared MIME mismatch and active/vector payloads rejected', async () => {
  await assert.rejects(processImage(f.samples.jpeg,'image/png'), /MIME_MISMATCH/);
  for(const b of [Buffer.from('<svg onload="x"/>'),Buffer.from('<html>image</html>'),Buffer.from('GIF89a')]) await assert.rejects(processImage(b,'image/png'),/FORMAT_NOT_ALLOWED/);
});
await check('missing/generic MIME still requires signature and full decoding; AVIF is not HEIC',async()=>{
  await privacy(await processImage(f.jpeg,'')); await privacy(await processImage(f.png,'application/octet-stream'));
  const avif=await sharp(f.raw,{raw:{width:f.width,height:f.height,channels:3}}).avif().toBuffer();
  await assert.rejects(processImage(avif,'image/heif'),/FORMAT_NOT_ALLOWED/);
});
await check('truncation and trailing encoded payloads rejected', async () => {
  for(const fmt of ['jpeg','png','webp']) await assert.rejects(processImage(f.samples[fmt].subarray(0, Math.floor(f.samples[fmt].length/2)),`image/${fmt}`));
  await assert.rejects(processImage(Buffer.concat([f.png,Buffer.from('extra')]),'image/png'));
});
await check('corrupt compressed PNG rejected despite valid signature/CRC', async () => {
  const chunks=pngChunks(f.png).map(c=>pngChunk(c.type,c.type==='IDAT'?Buffer.from('not-deflate'):c.data));
  await assert.rejects(processImage(Buffer.concat([f.png.subarray(0,8),...chunks]),'image/png'));
});
await check('malformed EXIF is rejected or fully sanitized, never copied', async () => {
  const bad=Buffer.from(f.samples.jpeg); const start=bad.indexOf(Buffer.from('Exif\0\0'))+6; bad.writeUInt32LE(0xfffffff0,start+4);
  let r; try { r=await processImage(bad,'image/jpeg'); } catch { return { outcome:'rejected' }; }
  await privacy(r); return { outcome:'decoded and sanitized' };
});
await check('animated WebP and APNG explicitly rejected', async () => {
  assert.ok((await sharp(f.animation,{animated:true}).metadata()).pages>1);
  await assert.rejects(processImage(f.animation,'image/webp'),/ANIMATION_NOT_ALLOWED/); await assert.rejects(processImage(f.apng,'image/png'),/ANIMATION_NOT_ALLOWED/);
});
await check('16-bit PNG fails closed instead of silently losing precision', async () => {
  assert.equal((await sharp(f.png16).metadata()).depth,'ushort'); await assert.rejects(processImage(f.png16,'image/png'),/BIT_DEPTH_NOT_ALLOWED/);
});
await check('valid 50MP compressible PNG bomb rejected before pixel processing', async () => {
  await assert.rejects(processImage(f.bomb,'image/png'));
  return { encodedBytes:f.bomb.length, generatedDecodedBytes:f.bombDecodedBytes, pixelCount:50_000_000 };
});
await check('panorama preserves aspect and derivative bounding boxes without enlargement', async () => {
  const input=await sharp({create:{width:9000,height:1000,channels:3,background:'#668844'}}).png().toBuffer(); const r=await processImage(input,'image/png');
  assert.equal(r.variants.archival.width,9000); assert.equal(r.variants.display.width,2560); assert.ok(Math.abs(r.variants.display.height-2560/9)<1); assert.equal(r.variants.thumbnail.width,480);
});
for(const n of [19_900_000,20_000_000,20_000_001]) await check(`actual encoded byte boundary ${n}`,async()=>{
  const chunk=pngChunk('npAD',Buffer.alloc(n-f.png.length-12)); const b=Buffer.concat([f.png.subarray(0,-12),chunk,f.png.subarray(-12)]); assert.equal(b.length,n);
  if(n>POLICY.maxInputBytes) await assert.rejects(processImage(b,'image/png'),/INPUT_SIZE/); else await privacy(await processImage(b,'image/png'));
  return { bytes:n, expected:n>POLICY.maxInputBytes?'rejected':'accepted' };
});
for(const fmt of ['heic','heif']) {
  if(!f.samples[fmt]) { report.formats.push({ format:fmt,node:'Blocked',reason:'sips fixture encoder unavailable' }); continue; }
  const bytes=f.samples[fmt], brands=bytes.toString('ascii',8,bytes.readUInt32BE(0));
  const record={format:fmt,bytes:bytes.length,brands,sourceGPSVerified:Boolean(await exifr.gps(bytes))};
  try { const r=await processImage(bytes,`image/${fmt}`); await privacy(r); record.node='Verified'; record.variants=summaries(r); }
  catch(error){record.node='Not supported';record.error=error.message.split('\n').at(-1).slice(0,400);}
  const output=new URL(`sips-decoded-${fmt}.png`,runRoot);
  const converted=spawnSync('/usr/bin/sips',['-s','format','png',new URL(`synthetic.${fmt}`,runRoot).pathname,'--out',output.pathname],{timeout:30000,encoding:'utf8'});
  record.macOS={exit:converted.status,error:converted.error?.code};
  if(converted.status===0) await check(`${fmt}: macOS decoder then explicit raw-barrier WebP sanitization (not portable)`,async()=>{
    const input=await readFile(output); const r=await processImage(input,'image/png'); await privacy(r); record.macOS.variants=summaries(r);record.macOS.status='Verified synthetic chain only';
  });
  report.formats.push(record);
}
await check('12MP isolated process resource/time observation',async()=>{
  const width=4000,height=3000, raw=Buffer.alloc(width*height*3); let state=1;
  for(let i=0;i<raw.length;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;raw[i]=state>>>24;}
  const input=await sharp(raw,{raw:{width,height,channels:3}}).jpeg({quality:70}).toBuffer(); await writeFile(new URL('benchmark.jpeg',runRoot),input,{mode:0o600});
  const run=spawnSync(process.execPath,['--max-old-space-size=128',new URL('./processor-child.mjs',import.meta.url).pathname],{timeout:30000,killSignal:'SIGKILL',encoding:'utf8'});
  report.benchmark={inputBytes:input.length,pixels:width*height,exit:run.status,signal:run.signal,error:run.error?.code,...(run.stdout.trim()?JSON.parse(run.stdout.trim()):{})};
  assert.equal(run.status,0); assert.equal(report.benchmark.ok,true);
  const alternate=spawnSync(process.execPath,['--max-old-space-size=128',new URL('./processor-child.mjs',import.meta.url).pathname,'--jpeg-archive'],{timeout:30000,killSignal:'SIGKILL',encoding:'utf8'});
  report.alternateBenchmark={profile:'archival JPEG95/4:4:4, PNG if alpha',exit:alternate.status,...(alternate.stdout.trim()?JSON.parse(alternate.stdout.trim()):{})};
  assert.equal(alternate.status,0);assert.equal(report.alternateBenchmark.ok,true);
});
await check('external process watchdog kills a stuck job',async()=>{
  const run=spawnSync(process.execPath,[new URL('./processor-child.mjs',import.meta.url).pathname,'--hang'],{timeout:300,killSignal:'SIGKILL',encoding:'utf8'});
  assert.equal(run.error?.code,'ETIMEDOUT'); assert.equal(run.signal,'SIGKILL'); return{timeoutMs:300,signal:run.signal};
});
report.summary={passed:report.assertions.filter(t=>t.status==='PASS').length,failed:report.assertions.filter(t=>t.status==='FAIL').length,skipped:0};
await writeFile(new URL('./codec-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({summary:report.summary,formats:report.formats.map(({format,node,macOS,error})=>({format,node,macOS:macOS?.status??macOS?.exit,error})),benchmark:report.benchmark,alternateBenchmark:report.alternateBenchmark},null,2));
if(report.summary.failed) process.exitCode=1;
