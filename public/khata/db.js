/* Khata data layer: talks to /api/db (MongoDB). Same small API the app used on claude.ai:
   db.collection(name).get() → {docs:[{id, exists, data()}]}
   db.doc('col/id').get() → {exists, data()} · .set(obj) · .delete()                         */
(function(){
  const call = async body => {
    const r = await fetch('/api/db', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if(!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  };
  const snap = (exists, data, id) => ({id, exists, data: () => data});
  const api = {
    collection: col => ({ get: async () => ({ docs: (await call({op:'list', col})).docs.map(d => snap(true, d.data, d.id)) }) }),
    doc: path => ({
      get: async () => { const j = await call({op:'get', path}); return snap(j.exists, j.data, path.split('/')[1]); },
      set: data => call({op:'set', path, data}),
      delete: () => call({op:'delete', path})
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

  let ready = null;
  window.__khataDB = {
    LS, toDocs, localBackup,
    importAll: b => call({op:'import', docs: toDocs(b)}),
    // resolves to the db, or null when the server is not there (then the app keeps using this browser only)
    open(){
      if(!ready) ready = (async () => {
        try{
          const p = await call({op:'ping'});
          // first time on an empty database: move this browser's data up so nothing is lost
          if(p.empty){ const docs = toDocs(localBackup()); if(docs.length) await call({op:'import', docs}); }
          return api;
        }catch(e){ console.warn('khata db offline, using this browser only:', e.message); return null; }
      })();
      return ready;
    }
  };
})();
