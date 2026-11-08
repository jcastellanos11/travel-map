// Reference semantics only: in-memory serialized transactions, NOT PostgreSQL proof.
export class QuotaModel {
  constructor(limit=500_000_000){this.limit=limit;this.used=0;this.reserved=0;this.rows=new Map();this.tail=Promise.resolve();}
  atomic(fn){const value=this.tail.then(fn);this.tail=value.catch(()=>{});return value;}
  reserve(key,fingerprint,bytes){return this.atomic(()=>{if(this.rows.has(key)){const row=this.rows.get(key);if(row.fingerprint!==fingerprint)throw Error('IDEMPOTENCY_CONFLICT');return row;}
    if(!Number.isSafeInteger(bytes)||bytes<=0||this.used+this.reserved+bytes>this.limit)throw Error('QUOTA');
    const row={fingerprint,reservation:bytes,status:'reserved'};this.rows.set(key,row);this.reserved+=bytes;return row;});}
  finalize(key,actual){return this.atomic(()=>{const row=this.rows.get(key);if(row.status==='active'){if(row.actual!==actual)throw Error('IDEMPOTENCY_CONFLICT');return;}
    if(row.status!=='reserved'||!Number.isSafeInteger(actual)||actual<0||actual>row.reservation)throw Error('FINALIZATION');
    this.reserved-=row.reservation;this.used+=actual;row.actual=actual;row.status='active';});}
  releaseFailed(key,{writesSettled,objectsDeleted}){return this.atomic(()=>{const row=this.rows.get(key);if(row.status==='released')return;if(row.status!=='reserved'||!writesSettled||!objectsDeleted)throw Error('CLEANUP_UNCONFIRMED');this.reserved-=row.reservation;row.status='released';});}
  trash(key,now){return this.atomic(()=>{const row=this.rows.get(key);if(row.status!=='active')throw Error('STATE');row.status='trashed';row.until=now+30*86400000;});}
  restore(key,now){return this.atomic(()=>{const row=this.rows.get(key);if(row.status!=='trashed'||now>=row.until)throw Error('STATE');row.status='active';});}
  claimPurge(key,now){return this.atomic(()=>{const row=this.rows.get(key);if(row.status!=='trashed'||now<row.until)throw Error('STATE');row.status='purging';});}
  finishPurge(key,deleted){return this.atomic(()=>{const row=this.rows.get(key);if(row.status==='deleted')return;if(row.status!=='purging'||!deleted)throw Error('DELETE_UNCONFIRMED');this.used-=row.actual;row.status='deleted';});}
}
export function allowed({session=true,active=true,role='outsider',creator=false,photoState='active'},action){
  if(!session||!active||!['owner','admin','member','guest'].includes(role))return false;
  const manager=['owner','admin'].includes(role);
  if(action==='restore')return photoState==='trashed'&&(manager||creator);
  if(photoState!=='active')return false;
  if(['metadata','display','thumbnail','upload'].includes(action))return true;
  if(['archival','edit','trash'].includes(action))return manager||creator;
  return false; // no user-triggered permanent purge or post-departure author bypass
}
export function batchPolicy(files){
  if(!Array.isArray(files)||files.length<1||files.length>10)throw Error('BATCH_SIZE');
  const ids=new Set();return files.map(file=>{
    if(!file||typeof file.clientFileId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(file.clientFileId)||ids.has(file.clientFileId))throw Error('SLOT_ID');ids.add(file.clientFileId);
    return{clientFileId:file.clientFileId,status:Number.isSafeInteger(file.declaredBytes)&&file.declaredBytes>0&&file.declaredBytes<=20_000_000?'eligible':'rejected'};
  });
}
