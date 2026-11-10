/* Khata data layer: talks to /api/db (MongoDB). Same small API the app used on claude.ai:
   db.collection(name).get() → {docs:[{id, exists, data()}]}
   db.doc('col/id').get() → {exists, data()} · .set(obj) · .delete()

   Works without internet too (owner's rule: nothing typed may be lost):
   - every save first goes into an "outbox" kept in this browser (localStorage), then is sent;
     no internet → it waits there and is sent by itself when the internet is back
   - what was read before is kept (cache), so reading still works when the connection drops
   - if someone else changed the same record meanwhile, both are merged (lines are matched by id)   */
(function(){
  // this open page: its own saves are not "news" for live sync
  const CID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const OUT_KEY = 'kg-khata-outbox', CACHE_KEY = 'kg-khata-dbcache';
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const load = (k, d) => { try{ return JSON.parse(localStorage.getItem(k)) || d; }catch(_){ return d; } };
  const keep = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(_){} };

  let online = true;
  // outbox: one item per record (latest wins) — {path, op:'set'|'delete', data, base, since, cid, t}
  let outbox = load(OUT_KEY, []);
  // cache: last known copy of every record, for reading without internet
  const cache = load(CACHE_KEY, {});
  let cacheT = 0;
  const saveCache = () => { clearTimeout(cacheT); cacheT = setTimeout(() => keep(CACHE_KEY, cache), 400); };

  const listeners = [];
  const status = () => ({online, pending: outbox.length, paths: outbox.map(o => o.path)});
  const emit = () => listeners.forEach(f => { try{ f(status()); }catch(_){} });
  const setOnline = v => { if(online !== v){ online = v; emit(); } };

  const netErr = e => e && (e.name === 'TypeError' || e.offline);
  const call = async body => {
    let r;
    try{ r = await fetch('/api/db', {method:'POST', headers:{'Content-Type':'application/json', 'x-khata-client': CID}, body: JSON.stringify(body)}); }
    catch(e){ setOnline(false); const x = new Error('offline'); x.offline = true; throw x; }
    setOnline(true);
    const j = await r.json().catch(() => ({}));
    // logged out (or the login was ended by the admin) → login page (the outbox stays and is sent after login)
    if(r.status === 401){ location.href = '/login?next=' + encodeURIComponent(location.pathname); throw new Error('login'); }
    if(!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  };

  // reading: online answer + what this browser still has to send; no internet → the cache
  const pendingFor = path => outbox.find(o => o.path === path);
  async function getDoc(path){
    let j;
    try{ j = await call({op:'get', path}); cache[path] = j.exists ? j.data : null; saveCache(); }
    catch(e){ if(!netErr(e)) throw e; if(!(path in cache) && !pendingFor(path)) throw e; j = {exists: cache[path] != null, data: cache[path]}; }
    const p = pendingFor(path);
    if(p) j = p.op === 'delete' ? {exists:false, data:null} : {exists:true, data: clone(p.data)};
    return j;
  }
  async function listCol(col){
    let docs;
    try{
      docs = (await call({op:'list', col})).docs;
      Object.keys(cache).forEach(k => { if(k.startsWith(col + '/')) delete cache[k]; });
      docs.forEach(d => { cache[col + '/' + d.id] = d.data; }); saveCache();
    }catch(e){
      if(!netErr(e)) throw e;
      const ks = Object.keys(cache).filter(k => k.startsWith(col + '/'));
      if(!ks.length) throw e;
      docs = ks.filter(k => cache[k] != null).map(k => ({id: k.slice(col.length + 1), data: cache[k]}));
    }
    const map = new Map(docs.map(d => [d.id, d]));
    outbox.filter(o => o.path.startsWith(col + '/')).forEach(o => {
      const id = o.path.slice(col.length + 1);
      if(o.op === 'delete') map.delete(id); else map.set(id, {id, data: clone(o.data)});
    });
    return [...map.values()];
  }

  // two copies of one record → one. base = how it was before this browser changed it.
  // Lists of lines are joined by id: this browser's lines win; lines only online are kept unless this browser deleted them.
  const isIdList = a => Array.isArray(a) && a.every(x => x && typeof x === 'object' && 'id' in x);
  function merge(server, mine, base){
    if(!server) return mine;
    base = base || {};
    const out = Object.assign({}, server, mine);
    Object.keys(mine).forEach(k => {
      const a = server[k], b = mine[k];
      if(isIdList(a) && isIdList(b)){
        const ids = new Set(b.map(x => String(x.id))), had = new Set(isIdList(base[k]) ? base[k].map(x => String(x.id)) : []);
        out[k] = b.concat(a.filter(x => !ids.has(String(x.id)) && !had.has(String(x.id))));
      } else if(k === 'map' && a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)){
        const m = Object.assign({}, a, b), bm = (base.map && typeof base.map === 'object') ? base.map : {};
        Object.keys(bm).forEach(d => { if(!(d in b)) delete m[d]; });   // removed here → stays removed
        out[k] = m;
      }
    });
    return out;
  }

  // send what is waiting, oldest first
  let flushing = null;
  function flush(){
    if(flushing) return flushing;
    if(!outbox.length){ emit(); return Promise.resolve(true); }
    flushing = (async () => {
      try{
        // records someone else changed after this browser went offline → merge instead of overwrite
        const since = Math.min(...outbox.map(o => o.since || Date.now()));
        const mine = new Set(outbox.map(o => o.cid).concat(CID));
        const ch = await call({op:'changes', since: since - 1});
        const touched = new Set((ch.rows || []).filter(r => !mine.has(r.cid)).map(r => r.path));
        while(outbox.length){
          const o = outbox[0];
          let data = o.data;
          if(touched.has(o.path) || touched.has('*')){
            const cur = await call({op:'get', path: o.path});
            if(o.op === 'delete'){ if(cur.exists){ data = cur.data; o.op = 'skip'; } }
            else data = merge(cur.exists ? cur.data : null, o.data, o.base);
          }
          if(o.op === 'set') await call({op:'set', path: o.path, data});
          else if(o.op === 'delete') await call({op:'delete', path: o.path});
          cache[o.path] = o.op === 'delete' ? null : data; saveCache();
          // only drop it if nothing newer was saved for this record while it was being sent
          if(outbox[0] === o) outbox.shift(); else outbox = outbox.filter(x => x !== o);
          keep(OUT_KEY, outbox);
          if(data !== o.data && window.__khataDB.onMerged) window.__khataDB.onMerged(o.path, clone(data));
          emit();
        }
        return true;
      }catch(e){ emit(); return false; }
      finally{ flushing = null; }
    })();
    return flushing;
  }
  function enqueue(path, op, data){
    const old = outbox.find(o => o.path === path);
    const item = {path, op, data: clone(data), base: old ? old.base : clone(cache[path]), since: old ? old.since : (window.__khataDB.since || Date.now()), cid: CID, t: Date.now()};
    outbox = outbox.filter(o => o.path !== path); outbox.push(item); keep(OUT_KEY, outbox);
    cache[path] = op === 'delete' ? null : clone(data); saveCache();
    emit();
    flush();
    return Promise.resolve();   // saved in this browser; it goes online by itself
  }
  addEventListener('online', () => flush());
  addEventListener('offline', () => setOnline(false));
  setInterval(() => { if(outbox.length) flush(); }, 8000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden && outbox.length) flush(); });

  const snap = (exists, data, id) => ({id, exists, data: () => data});
  const api = {
    collection: col => ({ get: async () => ({ docs: (await listCol(col)).map(d => snap(true, d.data, d.id)) }) }),
    doc: path => ({
      get: async () => { const j = await getDoc(path); return snap(j.exists, j.data, path.split('/')[1]); },
      set: data => enqueue(path, 'set', data),
      delete: () => enqueue(path, 'delete', null)
    })
  };

  // backup object ({days, ledgers, companies, khoroch, cats, rates, sabek, labour}) → [{path, data}]
  const LS = {days:'kg-khata-days-v1', ledgers:'kg-khata-ledger-v1', companies:'kg-khata-company-v1',
              khoroch:'kg-khata-khoroch-v1', cats:'kg-khata-cats-v1', rates:'kg-khata-rates', sabek:'kg-khata-sabek-v1'};
  function toDocs(b){
    const out = [], arr = (col, list) => (Array.isArray(list) ? list : []).forEach(x => { if(x && x.id) out.push({path: col+'/'+x.id, data: x}); });
    arr('days', b.days); arr('ledgers', b.ledgers); arr('companies', b.companies);
    Object.entries(b.khoroch || {}).forEach(([date, items]) => out.push({path: 'khoroch/'+date, data: {date, items}}));
    if(Array.isArray(b.cats) && b.cats.length) out.push({path: 'settings/cats', data: {list: b.cats}});
    if(b.rates) out.push({path: 'settings/rates', data: b.rates});
    if(b.sabek) out.push({path: 'amdani/sabek', data: {map: b.sabek}});
    if(Number(b.labour) > 0) out.push({path: 'settings/labour', data: {rate: Number(b.labour)}});
    return out;
  }
  function localBackup(){
    const b = {};
    Object.entries(LS).forEach(([k, key]) => { try{ const v = localStorage.getItem(key); if(v) b[k] = JSON.parse(v); }catch(_){} });
    try{ b.labour = Number(localStorage.getItem('kg-khata-labour-rate')) || 0; }catch(_){}
    return b;
  }

  // saved copies of the data in this browser (not login, not screen choices)
  const WIPE_KEY = 'kg-khata-wipe-seen';
  const DATA_KEYS = ['kg-khata-days-v1', 'kg-khata-ledger-v1', 'kg-khata-company-v1', 'kg-khata-khoroch-v1', 'kg-khata-cats-v1', 'kg-khata-rates',
                     'kg-khata-sabek-v1', 'kg-khata-labour-rate', 'kg-khata-drafts', 'kg-khata-unsynced', CACHE_KEY];
  function dropLocal(wipeTs){
    let had = false;
    DATA_KEYS.forEach(k => { try{ if(localStorage.getItem(k) != null){ had = true; localStorage.removeItem(k); } }catch(_){} });
    clearTimeout(cacheT); Object.keys(cache).forEach(k => delete cache[k]);
    const n = outbox.length;
    outbox = outbox.filter(o => (o.t || 0) > wipeTs);   // saves made before the delete must not bring data back
    if(outbox.length !== n){ had = true; keep(OUT_KEY, outbox); }
    return had;
  }

  let ready = null;
  window.__khataDB = {
    LS, toDocs, localBackup,
    importAll: b => call({op:'import', docs: toDocs(b)}),
    changes: since => call({op:'changes', since}),
    since: 0,
    status, flush,
    onStatus: f => { listeners.push(f); f(status()); },
    pending: path => !!pendingFor(path),
    onMerged: null,
    // resolves to the db, or null when the server was never reached and nothing is saved here
    open(){
      if(!ready) ready = (async () => {
        try{
          const p = await call({op:'ping'});
          // 👑 ডেটা মুছুন happened since this device last looked → drop every saved copy here (once), start fresh from online
          if(p.wipe && p.wipe.ts){
            let seen = 0; try{ seen = Number(localStorage.getItem(WIPE_KEY)) || 0; }catch(_){}
            if(p.wipe.ts > seen){
              keep(WIPE_KEY, p.wipe.ts);
              if(dropLocal(p.wipe.ts)){ location.reload(); return new Promise(() => {}); }
            }
          }
          // first time on an empty database: move this browser's data up so nothing is lost
          if(p.empty){ const docs = toDocs(localBackup()); if(docs.length) await call({op:'import', docs}); }
          // live sync starts from now (before the tabs read their data)
          try{ window.__khataDB.since = (await call({op:'changes', since:0})).now; }catch(_){}
          // what waited in this browser goes up first, so every tab reads the newest
          if(outbox.length) await Promise.race([flush(), new Promise(r => setTimeout(r, 8000))]);
          return api;
        }catch(e){
          // no internet right now: keep working from what this browser has; it is sent when the internet is back
          if(netErr(e) && (Object.keys(cache).length || outbox.length)) return api;
          console.warn('khata db offline, using this browser only:', e.message); return null;
        }
      })();
      return ready;
    }
  };
})();
