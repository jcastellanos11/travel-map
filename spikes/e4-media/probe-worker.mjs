// Disposable workerd experiment only. No application imports, sessions or media API.
import fs from 'node:fs';
import process from 'node:process';
import vectors from './runs/current/probe-vectors.json';
export default { async fetch(request, env) {
  const path=new URL(request.url).pathname;
  if(path==='/capabilities') {
    let nativeAddon;try{process.dlopen({exports:{}},'/tmp/e40-nonexistent.node');nativeAddon='unexpected success';}catch(error){nativeAddon=error.message;}
    let hostVisible=false;try{hostVisible=fs.readFileSync(env.HOST_MARKER,'utf8')==='synthetic-host-marker';}catch{}
    return Response.json({imageDecoder:typeof ImageDecoder,createImageBitmap:typeof createImageBitmap,nativeAddon,hostVisible});
  }
  if(path==='/vfs') {const existed=fs.existsSync('/tmp/e40-transient');fs.writeFileSync('/tmp/e40-transient','synthetic');return Response.json({existed,writeRead:fs.readFileSync('/tmp/e40-transient','utf8')==='synthetic'});}
  if(path==='/objects') {
    const key='e40-'+crypto.randomUUID(),bytes=new Uint8Array([1,2,3,4]);
    const stream=new FixedLengthStream(bytes.length),writer=stream.writable.getWriter();
    const writing=(async()=>{await writer.write(bytes);await writer.close();})();
    await env.MEDIA.put(key,stream.readable);await writing;const head=await env.MEDIA.head(key),body=await env.MEDIA.get(key);
    const conditional=await env.MEDIA.put(key,new Uint8Array([9]),{onlyIf:{etagDoesNotMatch:'*'}});
    const after=await env.MEDIA.get(key);const same=new Uint8Array(await after.arrayBuffer());
    await env.MEDIA.delete(key);await env.MEDIA.delete(key);
    return Response.json({size:head.size,read:Array.from(new Uint8Array(await body.arrayBuffer())),conditionalRejected:conditional===null,unchanged:Array.from(same),deleted:(await env.MEDIA.head(key))===null});
  }
  if(path==='/images') {
    const results=[];
    for(const v of vectors){
      const input=Uint8Array.from(atob(v.base64),c=>c.charCodeAt(0));
      try{const output=await env.IMAGES.input(input).transform({width:64,height:64,fit:'scale-down'}).output({format:'image/webp'});
        const response=output.response();results.push({format:v.format,status:response.status,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))});}
      catch(error){results.push({format:v.format,status:'rejected',error:error.message.slice(0,900)});}
    }
    return Response.json(results);
  }
  return new Response(null,{status:404});
}};
