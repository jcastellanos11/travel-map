import sharp from 'sharp';
import {readFileSync,writeFileSync} from 'node:fs';
import {crc32} from 'node:zlib';
import {performance} from 'node:perf_hooks';
const candidate=process.argv[2]??'d1';
const base=candidate==='d1'?'http://127.0.0.1:8787':'http://127.0.0.1:8788';
const source=readFileSync(new URL('../fixtures/synthetic-gps.tiff',import.meta.url));
const inputs=[{name:'synthetic-heic',bytes:readFileSync(new URL('../fixtures/synthetic-gps.heic',import.meta.url))}, {name:'synthetic-tiff-gps',bytes:source}];
for(const f of ['jpeg','png','webp'])inputs.push({name:f,bytes:await sharp(source).toFormat(f).toBuffer()});
inputs.push({name:'disguised-png',bytes:Buffer.from('not an image')});
const png=inputs.find((i)=>i.name==='png').bytes;
function paddedPNG(target){
 const padding=Buffer.alloc(target-png.length-12);
 const type=Buffer.from('npAD');const size=Buffer.alloc(4);size.writeUInt32BE(padding.length);
 const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([type,padding])));
 return Buffer.concat([png.subarray(0,-12),size,type,padding,crc,png.subarray(-12)]);
}
for(const size of [19_900_000,20_000_000,20_000_001])inputs.push({name:`png-${size}`,bytes:paddedPNG(size)});
const tests=[];
for(const input of inputs){
 const start=performance.now();
 try{
 const response=await fetch(base+'/harness/transform-stream',{method:'POST',body:input.bytes,signal:AbortSignal.timeout(45000)});
 const output=Buffer.from(await response.arrayBuffer());
 const entry={name:input.name,inputBytes:input.bytes.length,status:response.status,elapsedMs:performance.now()-start};
 if(response.ok){
  const metadata=await sharp(output).metadata();const chunks=[];
  for(let at=12;at+8<=output.length;){const length=output.readUInt32LE(at+4);chunks.push(output.toString('ascii',at,at+4));at+=8+length+(length%2);}
  entry.output={bytes:output.length,format:metadata.format,chunks,sensitiveMetadataChunks:chunks.filter((c)=>['EXIF','XMP '].includes(c))};
 }else entry.error=output.toString('utf8').slice(0,1600);
 tests.push(entry);
 }catch(error){tests.push({name:input.name,error:error.message,elapsedMs:performance.now()-start});}
}
const small=inputs.find((i)=>i.name==='png').bytes;
await fetch(base+'/harness/object',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'processing/synthetic.png',base64:small.toString('base64')})});
const fromR2=await fetch(base+'/harness/transform',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64:'',fromR2:'processing/synthetic.png'})});
tests.push({name:'private-local-R2-to-Images',status:fromR2.status,outputBytes:(await fromR2.arrayBuffer()).byteLength});
const start=performance.now();
const batch=await Promise.all(Array.from({length:10},()=>fetch(base+'/harness/transform-stream',{method:'POST',body:small}).then(async(r)=>({status:r.status,bytes:(await r.arrayBuffer()).byteLength}))));
const report={candidate,scope:'LOCAL Images simulator only; NOT cloud processing, billing or 20MB guarantees',tests,batch10:{elapsedMs:performance.now()-start,results:batch}};
writeFileSync(new URL(`../evidence/native/${candidate}-images.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
