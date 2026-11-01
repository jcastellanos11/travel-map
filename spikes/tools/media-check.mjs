import sharp from 'sharp';
import exifr from 'exifr';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const report={scope:'LOCAL MACOS CODECS ONLY; NOT CLOUDFLARE IMAGES',sharp:sharp.versions.sharp,vips:sharp.versions.vips,tests:[]};
const source=readFileSync(new URL('../fixtures/synthetic-gps.tiff',import.meta.url));
report.sourceGPS=await exifr.gps(source);
const start=performance.now();
const webp=await sharp(source).webp().toBuffer();
writeFileSync(new URL('../fixtures/synthetic-derived.webp',import.meta.url),webp);
// Independent RIFF chunk inspection: do not rely solely on the producing codec.
const chunks=[];
if(webp.toString('ascii',0,4)!=='RIFF'||webp.toString('ascii',8,12)!=='WEBP')throw new Error('invalid_webp');
for(let at=12;at+8<=webp.length;){const kind=webp.toString('ascii',at,at+4);const length=webp.readUInt32LE(at+4);if(at+8+length>webp.length)throw new Error('invalid_chunk');chunks.push(kind);at+=8+length+(length%2);}
report.tests.push({id:'TIFF_GPS_TO_WEBP',status:chunks.some((c)=>['EXIF','XMP '].includes(c))?'FAIL':'PASS',outputBytes:webp.length,chunks,elapsedMs:performance.now()-start,sha256:createHash('sha256').update(webp).digest('hex')});
try{const output=await sharp(new URL('../fixtures/synthetic-gps.heic',import.meta.url).pathname).webp().toBuffer();report.tests.push({id:'HEIC_TO_WEBP_SHARP',status:'PASS',outputBytes:output.length});}
catch(error){report.tests.push({id:'HEIC_TO_WEBP_SHARP',status:'FAIL',error:error.message});}
for(const format of ['jpeg','png','webp']){
 const bytes=await sharp(source).toFormat(format).toBuffer();
 const metadata=await sharp(bytes).metadata();
 report.tests.push({id:`LOCAL_${format.toUpperCase()}_DECODE`,status:metadata.width===8&&metadata.height===8?'PASS':'FAIL',bytes:bytes.length});
}
try{await sharp(Buffer.from('synthetic-not-an-image')).metadata();report.tests.push({id:'DISGUISED_IMAGE',status:'FAIL'});}
catch{report.tests.push({id:'DISGUISED_IMAGE',status:'PASS'});}
report.limitTests={scope:'declared byte policy only; cloud format/20MB boundary still requires native Images',maxBytes:20_000_000};
writeFileSync(new URL('../evidence/native/local-media.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
