import { readFile } from 'node:fs/promises';
import { processImage } from './processor.mjs';
if (process.argv[2] === '--hang') { setInterval(() => {}, 1000); }
else {
  const started = performance.now();
  const baseline = { rssBytes: process.memoryUsage().rss, maxRSSKiB: process.resourceUsage().maxRSS };
  let sampledPeakRSSBytes = baseline.rssBytes;
  const sample = setInterval(() => { sampledPeakRSSBytes = Math.max(sampledPeakRSSBytes,process.memoryUsage().rss); },10);
  try {
    const result = await processImage(await readFile(new URL('./runs/current/benchmark.jpeg', import.meta.url)), 'image/jpeg', {archive:process.argv.includes('--jpeg-archive')?'jpeg-png':'lossless-webp'});
    const variants = Object.fromEntries(Object.entries(result.variants).map(([k,{ data, ...metadata }]) => { void data; return [k, metadata]; }));
    clearInterval(sample);
    console.log(JSON.stringify({ ok: true, baseline, sampledPeakRSSBytes, finalRSSBytes: process.memoryUsage().rss, elapsedMs: performance.now()-started, maxRSSKiB: process.resourceUsage().maxRSS, cpuMicroseconds: process.resourceUsage().userCPUTime + process.resourceUsage().systemCPUTime, variants }));
  } catch (error) { clearInterval(sample); console.log(JSON.stringify({ ok: false, error: error.message.split('\n').at(-1), maxRSSKiB: process.resourceUsage().maxRSS })); process.exitCode=1; }
}
