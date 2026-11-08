import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
const root=new URL('./',import.meta.url),files={};
for(const name of (await readdir(root)).sort())if(/\.(mjs|json|txt)$/.test(name)&&name!=='evidence-manifest.json'){
  const b=await readFile(new URL(name,root));files[name]={bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};
}
const fixtures={};
for(const name of (await readdir(new URL('runs/current/',root))).sort())if(/^synthetic\.(jpeg|png|webp|heic|heif)$/.test(name)){
  const b=await readFile(new URL(`runs/current/${name}`,root));fixtures[name]={bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};
}
const dependencies={};
for(const name of ['sharp','exifr','wrangler','workerd','miniflare','@img/sharp-libvips-darwin-arm64']){
  const p=JSON.parse(await readFile(new URL(`../tools/node_modules/${name}/package.json`,root)));
  dependencies[name]={version:p.version,license:p.license};
}
await writeFile(new URL('evidence-manifest.json',root),JSON.stringify({generatedAt:new Date().toISOString(),baseline:'0f399bd',scope:'Only E4.0 source, reports and our own synthetic fixtures; no user data',runtime:{node:process.version,platform:process.platform,arch:process.arch},dependencies,files,fixtures},null,2)+'\n');
