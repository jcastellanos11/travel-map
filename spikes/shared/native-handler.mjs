// Loopback-only experiment interface. Never deploy. Mock sessions, no production API.
const denied = () => Response.json({ error: 'unavailable' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
const result = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const validId = (s) => typeof s === 'string' && s.length > 0 && s.length < 200;

export function createHandler(connect, engine) {
  return async function handle(request, env) {
    let db;
    try {
      const url = new URL(request.url);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return denied();
      if (request.headers.has('origin') && request.headers.get('origin') !== url.origin) return denied();
      db = await connect(env);
      if(url.pathname==='/harness/transform-stream') {
        try {
          const output=await env.IMAGES.input(request.body).transform({width:64}).output({format:'image/webp'});
          const response=output.response();
          return new Response(response.body,{headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store'}});
        } catch(error) {return result({error:'local_images_failure',detail:error.message},422);}
      }
      const body = request.method === 'POST' ? await request.json() : {};
      if (url.pathname === '/health') {
        try { return result({ engine, sessionCheck:!!db.sessionCheck, version: await db.all(engine === 'D1' ? "SELECT 'local-D1-binding' version,1 binding_ready" : 'SELECT version() version') }); }
        catch(error) { return result({ error:'static_health_query',detail:error.message },500); }
      }
      // Harness-only controls deliberately separate from authenticated experimental operations.
      if (url.pathname.startsWith('/harness/')) {
        if (url.pathname === '/harness/account') {
          if (!validId(body.id) || !integer(body.used)) return result({ error: 'invalid' }, 400);
          await db.run('INSERT INTO account(user_id,used,quota) VALUES(?,?,?)', [body.id, body.used, 500_000_000]);
          return result({ ok: true });
        }
        if (url.pathname === '/harness/snapshot') return result({
          account: await db.all('SELECT * FROM account WHERE user_id=?', [body.id]),
          uploads: await db.all('SELECT * FROM upload WHERE user_id=? ORDER BY op,file', [body.id]),
          assets: await db.all('SELECT * FROM asset WHERE user_id=? ORDER BY op,file,kind', [body.id]),
        });
        if (url.pathname === '/harness/revoke') {
          await db.run('UPDATE tm SET active=? WHERE user_id=? AND trip_id=?', [body.active ? 1 : 0, body.user, body.trip]);
          return result({ ok: true });
        }
        if (url.pathname === '/harness/state') {
          if (!['photos', 'visits', 'trips', 'projects'].includes(body.table)) return result({ error: 'invalid' }, 400);
          await db.run(`UPDATE ${body.table} SET state=? WHERE id=?`, [body.state, body.id]);
          return result({ ok: true });
        }
        if (url.pathname === '/harness/invite') {
          await db.run('INSERT INTO invite(id,token_hash,trip_id,expires,revoked) VALUES(?,?,?,?,?)', [body.id,body.hash,'trip-italy',body.expires,body.revoked ? 1 : 0]);
          return result({ ok: true });
        }
        if (url.pathname === '/harness/rollback') {
          try {
            await db.batch([
              ['INSERT INTO rollback_probe VALUES(?)',[body.id]],
              ['INSERT INTO rollback_probe VALUES(?)',[body.id]],
            ]);
          } catch {
            return result({ rolledBack: (await db.all('SELECT * FROM rollback_probe WHERE id=?',[body.id])).length === 0 });
          }
          return result({ rolledBack: false });
        }
        if (url.pathname === '/harness/object') {
          await env.MEDIA.put(body.key, Uint8Array.from(atob(body.base64), (c) => c.charCodeAt(0)));
          return result({ ok: true });
        }
        if (url.pathname === '/harness/transform') {
          try {
            const input=Uint8Array.from(atob(body.base64),(c)=>c.charCodeAt(0));
            const stream=body.fromR2 ? (await env.MEDIA.get(body.fromR2))?.body : new Response(input).body;
            if(!stream)return denied();
            const output=await env.IMAGES.input(stream).transform({width:64}).output({format:'image/webp'});
            const response=output.response();
            return new Response(response.body,{headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store'}});
          } catch(error) { return result({error:'local_images_failure',detail:error.message},422); }
        }
        if (url.pathname === '/harness/expire') {
          await db.run("UPDATE upload SET state='failed' WHERE user_id=? AND state='reserved' AND expires<=?", [body.id,body.now]);
          return result({ ok: true });
        }
        if(url.pathname==='/harness/benchmark') {
          if(!validId(body.id))return denied();
          const items=[['INSERT INTO projects VALUES(?,?,?,?)',[body.id,'member','active',0]],['INSERT INTO trips VALUES(?,?,?)',[body.id,body.id,'active']]];
          for(let i=0;i<100;i++){
            items.push(['INSERT INTO visits VALUES(?,?,?,?,?)',[`${body.id}-${i}`,body.id,'place-bogota','member','active']]);
            items.push(['INSERT INTO photos VALUES(?,?,?,?)',[`${body.id}-${i}`,`${body.id}-${i}`,'member','ready']]);
          }
          await db.batch(items);return result({visits:100});
        }
        return denied();
      }
      const identity = request.headers.has('authorization') && db.resolveIdentity
        ? await db.resolveIdentity(request.headers.get('authorization'))
        : (await db.all('SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.active=1 AND u.active=1', [request.headers.get('x-poc-session') ?? '']))[0]?.id;
      if (!identity) return denied();
      // Never trust a body-provided user or role. This suffix only namespaces isolated ledger runs.
      const ledgerUser = body.namespace ? `${identity}:${body.namespace}` : identity;
      const scoped = `SELECT ph.id,ph.author_id,v.id visit_id,v.creator_id,t.id trip_id,p.id project_id,p.owner_id,
        CASE WHEN p.owner_id=? OR EXISTS(SELECT 1 FROM pm WHERE project_id=p.id AND user_id=? AND active=1 AND role='admin') THEN 1 ELSE 0 END administrator
        FROM photos ph JOIN visits v ON v.id=ph.visit_id JOIN trips t ON t.id=v.trip_id JOIN projects p ON p.id=t.project_id JOIN places pl ON pl.id=v.place_id
        WHERE ph.state='ready' AND v.state='active' AND t.state='active' AND p.state='active'
        AND (p.owner_id=? OR EXISTS(SELECT 1 FROM pm WHERE project_id=p.id AND user_id=? AND active=1) OR EXISTS(SELECT 1 FROM tm WHERE trip_id=t.id AND user_id=? AND active=1))`;
      const identityParams = [identity,identity,identity,identity,identity];
      if (url.pathname === '/photos') {
        const rows = await db.all(scoped + ' AND p.id=?' + (body.country ? ' AND pl.country=?' : '') + ' ORDER BY ph.id', [...identityParams,body.project??'project-main', ...(body.country ? [body.country] : [])]);
        return result({ photos: rows.map((r) => r.id), count: rows.length });
      }
      if (url.pathname === '/photo' || url.pathname === '/media') {
        const photo = (await db.all(scoped + ' AND ph.id=?', [...identityParams,body.id]))[0];
        if (!photo || (body.variant === 'original' && photo.author_id !== identity && !Number(photo.administrator))) return denied();
        if (url.pathname === '/photo') return result({ id: photo.id });
        if (!['original','display'].includes(body.variant)) return denied();
        const asset = await env.MEDIA.get(`${photo.id}/${body.variant}`);
        if (!asset) return denied();
        return new Response(asset.body, { headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' } });
      }
      if (url.pathname === '/capability') {
        const p = (await db.all('SELECT * FROM projects WHERE id=? AND state=?',[body.id,'active']))[0];
        if (p) {
          const m = (await db.all('SELECT role FROM pm WHERE project_id=? AND user_id=? AND active=1',[p.id,identity]))[0];
          const owner = p.owner_id === identity;
          let ok = false;
          if (['project.overview','project.counts'].includes(body.action)) ok = owner || !!m;
          if (['project.archive','project.manageAdmins','project.transfer'].includes(body.action)) ok = owner;
          if (body.action === 'trip.create') ok = owner || m?.role === 'admin' || (m?.role === 'member' && !!Number(p.members_create));
          return ok ? result({ ok: true }) : denied();
        }
        const v = (await db.all(`SELECT v.creator_id,p.owner_id FROM visits v JOIN trips t ON t.id=v.trip_id JOIN projects p ON p.id=t.project_id
          WHERE v.id=? AND v.state='active' AND t.state='active' AND p.state='active' AND
          (p.owner_id=? OR EXISTS(SELECT 1 FROM pm WHERE project_id=p.id AND user_id=? AND active=1) OR EXISTS(SELECT 1 FROM tm WHERE trip_id=t.id AND user_id=? AND active=1))`,[body.id,identity,identity,identity]))[0];
        if (!v) return denied();
        if (['visit.read','visit.create','photo.upload'].includes(body.action)) return result({ ok: true });
        const admin = (await db.all("SELECT 1 ok FROM pm JOIN trips t ON t.project_id=pm.project_id JOIN visits v ON v.trip_id=t.id WHERE v.id=? AND pm.user_id=? AND pm.role='admin' AND pm.active=1",[body.id,identity])).length > 0;
        return ['visit.edit','visit.delete'].includes(body.action) && (v.creator_id===identity || v.owner_id===identity || admin) ? result({ ok: true }) : denied();
      }
      if (url.pathname === '/invite/redeem') {
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.token)))].map((b) => b.toString(16).padStart(2,'0')).join('');
        const rows = await db.all('UPDATE invite SET used_by=? WHERE token_hash=? AND used_by IS NULL AND revoked=0 AND expires>? RETURNING id',[identity,digest,body.now]);
        return rows.length ? result({ accepted: true }) : denied();
      }
      if (url.pathname.startsWith('/upload/')) {
        const allowed = (await db.all(`SELECT 1 ok FROM visits v JOIN trips t ON t.id=v.trip_id JOIN projects p ON p.id=t.project_id WHERE v.id=? AND v.state='active' AND t.state='active' AND p.state='active' AND (p.owner_id=? OR EXISTS(SELECT 1 FROM pm WHERE project_id=p.id AND user_id=? AND active=1) OR EXISTS(SELECT 1 FROM tm WHERE trip_id=t.id AND user_id=? AND active=1))`,[body.visit,identity,identity,identity])).length;
        if (!allowed) return denied();
        if (![body.op,body.file,body.fingerprint].every(validId) || !Number.isSafeInteger(body.estimate) || body.estimate<=0) return result({ error:'invalid' },400);
        const key = [ledgerUser,body.op,body.file];
        const get = async () => (await db.all('SELECT * FROM upload WHERE user_id=? AND op=? AND file=?',key))[0];
        const matches = (r) => r && r.fingerprint===body.fingerprint && r.visit_id===body.visit && Number(r.estimate)===body.estimate;
        if (url.pathname === '/upload/reserve') {
          let row = await get();
          if (row && !matches(row)) return result({ error:'idempotency_conflict' },409);
          if (row && row.state!=='failed') return result({ outcome:'replay' });
          try {
            if (row) {
              const rows = await db.all("UPDATE upload SET state='reserved',attempts=attempts+1,expires=? WHERE user_id=? AND op=? AND file=? AND state='failed' RETURNING file",[body.expires??1000,...key]);
              return result({ outcome:rows.length?'reserved':'replay' });
            }
            await db.run("INSERT INTO upload(user_id,op,file,visit_id,fingerprint,estimate,state,expires) VALUES(?,?,?,?,?,?,'reserved',?)",[...key,body.visit,body.fingerprint,body.estimate,body.expires??1000]);
            return result({ outcome:'reserved' });
          } catch {
            row=await get();
            if (row && matches(row)) return result({ outcome:'replay' });
            return result({ error:row?'idempotency_conflict':'quota_denied' },409);
          }
        }
        const row = await get();
        if (!matches(row)) return result({ error:'unavailable' },404);
        if (url.pathname === '/upload/fail') {
          const rows = await db.all("UPDATE upload SET state='failed' WHERE user_id=? AND op=? AND file=? AND state='reserved' RETURNING file",key);
          return result({ outcome:rows.length?'released':'noop' });
        }
        if (url.pathname === '/upload/complete' || url.pathname === '/upload/complete-objects') {
          if(url.pathname==='/upload/complete-objects') {
            const prefix=`upload/${ledgerUser}/${encodeURIComponent(body.op)}/${encodeURIComponent(body.file)}`;
            const original=await env.MEDIA.head(`${prefix}/original`);
            const display=await env.MEDIA.head(`${prefix}/display`);
            if(!original || !display)return result({error:'required_asset_missing'},409);
            body.original=original.size;body.display=display.size;
          }
          if (![body.original,body.display].every((n) => Number.isSafeInteger(n) && n>0)) return result({ error:'invalid_assets' },400);
          if (row.state==='ready') return Number(row.original_bytes)===body.original && Number(row.display_bytes)===body.display ? result({ outcome:'replay' }) : result({ error:'completion_conflict' },409);
          try {
            const rows = await db.all("UPDATE upload SET state='ready',original_bytes=?,display_bytes=?,actual=? WHERE user_id=? AND op=? AND file=? AND state='reserved' RETURNING file",[body.original,body.display,body.original+body.display,...key]);
            if (rows.length) return result({ outcome:'ready' });
            const current=await get();
            return current.state==='ready' && Number(current.original_bytes)===body.original && Number(current.display_bytes)===body.display ? result({ outcome:'replay' }) : result({ error:'invalid_state' },409);
          } catch { return result({ error:'quota_actual_bytes' },409); }
        }
        if (url.pathname === '/upload/trash') {
          await db.run("UPDATE upload SET state='trash',deleted_at=? WHERE user_id=? AND op=? AND file=? AND state='ready'",[body.now,...key]);
          return result({ ok:true });
        }
        if (url.pathname === '/upload/restore') {
          const rows=await db.all("UPDATE upload SET state='ready',deleted_at=NULL WHERE user_id=? AND op=? AND file=? AND state='trash' AND deleted_at>? RETURNING file",[...key,body.now-30*86400]);
          return rows.length?result({ restored:true }):denied();
        }
      }
      return denied();
    } catch (error) {
      // Do not log request bodies, session material or private media paths.
      return result({ error:'experiment_error', category: String(error.code ?? error.name ?? 'unknown') },500);
    } finally { if (db?.close) await db.close(); }
  };
}
