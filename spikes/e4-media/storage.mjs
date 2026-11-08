// Isolated Node filesystem experiment. Never imported by the application Worker.
import { open, mkdir, realpath, link, unlink, lstat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { Readable } from 'node:stream';
export const objectKey = () => randomBytes(32).toString('hex');
export class LocalStore {
  static async create(root) {
    const allowed=resolve(new URL('./runs/',import.meta.url).pathname);
    if(dirname(resolve(root))!==allowed)throw Error('ISOLATION');
    await mkdir(allowed,{recursive:true,mode:0o700});
    try{await mkdir(root,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
    const node=await lstat(root);if(!node.isDirectory()||node.isSymbolicLink())throw Error('ISOLATION');
    const actual=await realpath(root);if(dirname(actual)!==await realpath(allowed))throw Error('ISOLATION');
    return new LocalStore(actual);
  }
  constructor(root){this.root=root;}
  path(key){if(!/^[a-f0-9]{64}$/.test(key))throw Error('OPAQUE_KEY_REQUIRED');return join(this.root,key);}
  async head(key){
    let file;try{file=await open(this.path(key),constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await file.stat();if(!stat.isFile())throw Error('NOT_REGULAR');return{bytes:stat.size};}
    catch(e){if(e.code==='ENOENT')return null;throw e;}finally{await file?.close();}
  }
  async exists(key){return (await this.head(key))!==null;}
  async get(key){const file=await open(this.path(key),constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await file.stat();if(!stat.isFile()){await file.close();throw Error('NOT_REGULAR');}return Readable.toWeb(file.createReadStream({autoClose:true,highWaterMark:65536}));}
  async digest(key){const hash=createHash('sha256');let bytes=0;for await(const part of await this.get(key)){hash.update(part);bytes+=part.length;}return{sha256:hash.digest('hex'),bytes};}
  async put(key,source,{maxBytes,expectedSha256,failAfterSync=false}={}){
    if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw Error('OBJECT_SIZE');
    const dest=this.path(key),temp=join(this.root,`.tmp-${objectKey()}`),hash=createHash('sha256');let bytes=0,crashed=false;
    const file=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{
      for await(const part of source){bytes+=part.length;if(!Number.isSafeInteger(maxBytes)||bytes>maxBytes)throw Error('OBJECT_SIZE');hash.update(part);
        let at=0;while(at<part.length){const write=await file.write(part,at,part.length-at);if(!write.bytesWritten)throw Error('SHORT_WRITE');at+=write.bytesWritten;}}
      const sha256=hash.digest('hex');if(expectedSha256&&expectedSha256!==sha256)throw Error('CHECKSUM');
      await file.sync();await file.close();if(failAfterSync){crashed=true;throw Error('INJECTED_CRASH');}
      try{await link(temp,dest);}catch(e){if(e.code!=='EEXIST')throw e;const old=await this.digest(key);if(old.sha256!==sha256||old.bytes!==bytes)throw Error('IMMUTABLE_CONFLICT');}
      const directory=await open(this.root,constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
      return{bytes,sha256};
    }finally{await file.close().catch(()=>{});if(!crashed)await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  async delete(key){const path=this.path(key);try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('NOT_REGULAR');await unlink(path);const dir=await open(this.root,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}}catch(e){if(e.code!=='ENOENT')throw e;}}
  async sweepTemps(cutoff){let removed=0;for(const name of await readdir(this.root)){if(!/^\.tmp-[a-f0-9]{64}$/.test(name))continue;const path=join(this.root,name),stat=await lstat(path);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.mtimeMs<=cutoff){await unlink(path);removed++;}}return removed;}
}
