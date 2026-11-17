/* 🔖 স্ট্যাম্প: the owner's stamp + signature (saved once, online, for every device) and a bank voucher photo →
   scan it like CamScanner (find the paper's 4 corners, straighten, clean white paper) → put the stamp on it → save / print / share.
   Everything runs in the browser (canvas); nothing is sent anywhere except the saved stamp (settings/stamp). */
(function(){
  const root = document.getElementById('stamp');
  if(!root) return;
  const BD = '০১২৩৪৫৬৭৮৯', toBn = s => String(s).replace(/[0-9]/g, d => BD[d]);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const toast = (h, ms) => { if(typeof kToast === 'function') kToast(h, ms || 3500); };

  /* ---------- image tools ---------- */
  const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  // a chosen photo → canvas, at most `max` px on the long side (phone photos are 12 MP; this keeps it fast)
  function fileToCanvas(file, max){
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = newCanvas(img.naturalWidth * k, img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('ছবিটা খোলা গেল না')); };
      img.src = url;
    });
  }
  const scaled = (src, max) => { const k = Math.min(1, max / Math.max(src.width, src.height)), c = newCanvas(src.width * k, src.height * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c; };

  // find the paper: the biggest bright patch (paper on a table / notebook), its 4 corners
  function findPaper(src){
    const s = scaled(src, 360), w = s.width, h = s.height, d = s.getContext('2d').getImageData(0, 0, w, h).data;
    const L = new Uint8Array(w * h), hist = new Array(256).fill(0);
    for(let i = 0; i < w * h; i++){ const v = (d[i*4] * 0.299 + d[i*4+1] * 0.587 + d[i*4+2] * 0.114) | 0; L[i] = v; hist[v]++; }
    // Otsu: the split between "paper" and "table"
    let sum = 0; for(let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, th = 128;
    for(let t = 0; t < 256; t++){ wB += hist[t]; if(!wB) continue; const wF = w * h - wB; if(!wF) break; sB += t * hist[t];
      const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) * (mB - mF); if(between > best){ best = between; th = t; } }
    // largest bright connected patch
    const seen = new Uint8Array(w * h); let bestPix = null;
    for(let i = 0; i < w * h; i++){
      if(seen[i] || L[i] <= th) continue;
      const stack = [i], pix = []; seen[i] = 1;
      while(stack.length){ const p = stack.pop(); pix.push(p); const x = p % w, y = (p / w) | 0;
        for(const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) if(q >= 0 && !seen[q] && L[q] > th){ seen[q] = 1; stack.push(q); } }
      if(!bestPix || pix.length > bestPix.length) bestPix = pix;
    }
    const kx = src.width / w, ky = src.height / h, inset = [[0.04, 0.04], [0.96, 0.04], [0.96, 0.96], [0.04, 0.96]].map(([a, b]) => ({x: a * src.width, y: b * src.height}));
    if(!bestPix || bestPix.length < w * h * 0.12) return inset;   // nothing clear: start a little inside the photo
    let tl = null, tr = null, br = null, bl = null;
    for(const p of bestPix){ const x = p % w, y = (p / w) | 0;
      if(!tl || x + y < tl[0] + tl[1]) tl = [x, y]; if(!br || x + y > br[0] + br[1]) br = [x, y];
      if(!tr || x - y > tr[0] - tr[1]) tr = [x, y]; if(!bl || x - y < bl[0] - bl[1]) bl = [x, y]; }
    return [tl, tr, br, bl].map(([x, y]) => ({x: (x + 0.5) * kx, y: (y + 0.5) * ky}));
  }

  // straighten: the 4 corners become a flat rectangle (perspective warp)
  function homography(dst, srcPts){
    const A = [], b = [];
    for(let i = 0; i < 4; i++){ const [x, y] = dst[i], X = srcPts[i].x, Y = srcPts[i].y;
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y); }
    for(let c = 0; c < 8; c++){   // Gaussian elimination
      let p = c; for(let r = c + 1; r < 8; r++) if(Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for(let r = 0; r < 8; r++){ if(r === c) continue; const f = A[r][c] / A[c][c]; for(let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    return b.map((v, i) => v / A[i][i]);
  }
  function warp(src, q){
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    const k = Math.min(1, 2400 / Math.max(W, H)); W = Math.round(W * k); H = Math.round(H * k);
    const h = homography([[0, 0], [W, 0], [W, H], [0, H]], q);
    const sw = src.width, sh = src.height, sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
    const out = newCanvas(W, H), octx = out.getContext('2d'), od = octx.createImageData(W, H), o = od.data;
    for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
      const den = h[6] * x + h[7] * y + 1, X = (h[0] * x + h[1] * y + h[2]) / den, Y = (h[3] * x + h[4] * y + h[5]) / den;
      const x0 = clamp(Math.floor(X), 0, sw - 2), y0 = clamp(Math.floor(Y), 0, sh - 2), fx = clamp(X - x0, 0, 1), fy = clamp(Y - y0, 0, 1);
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4, j = (y * W + x) * 4;
      for(let c = 0; c < 3; c++) o[j + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
      o[j + 3] = 255;
    }
    octx.putImageData(od, 0, 0);
    return out;
  }

  // the paper's own colour / light at every spot (text removed), so shadows and colour casts can be divided away
  function paperLight(src){
    const k = Math.min(1, 96 / Math.max(src.width, src.height)), w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
    const s = newCanvas(w, h), sc = s.getContext('2d'); sc.drawImage(src, 0, 0, w, h);
    const id = sc.getImageData(0, 0, w, h), d = id.data, tmp = new Uint8ClampedArray(d.length);
    const pass = (fn, r) => { for(let y = 0; y < h; y++) for(let x = 0; x < w; x++) for(let c = 0; c < 3; c++){
      let v = fn === 'max' ? 0 : 0, n = 0;
      for(let dy = -r; dy <= r; dy++) for(let dx = -r; dx <= r; dx++){ const xx = clamp(x + dx, 0, w - 1), yy = clamp(y + dy, 0, h - 1), u = d[(yy * w + xx) * 4 + c];
        if(fn === 'max'){ if(u > v) v = u; } else { v += u; n++; } }
      tmp[(y * w + x) * 4 + c] = fn === 'max' ? v : v / n; }
      for(let i = 0; i < d.length; i += 4){ d[i] = tmp[i]; d[i+1] = tmp[i+1]; d[i+2] = tmp[i+2]; } };
    pass('max', 2); pass('avg', 2); pass('avg', 2);   // ink strokes gone, then smooth
    sc.putImageData(id, 0, 0);
    const big = newCanvas(src.width, src.height), bc = big.getContext('2d'); bc.imageSmoothingQuality = 'high'; bc.drawImage(s, 0, 0, src.width, src.height);
    return bc.getImageData(0, 0, src.width, src.height).data;
  }

  // ✨ CamScanner-like: white paper, dark clear ink · 'orig' = only straightened
  function enhance(src, mode){
    if(mode === 'orig') return vivid(src);
    const W = src.width, H = src.height, out = newCanvas(W, H), oc = out.getContext('2d');
    const id = src.getContext('2d').getImageData(0, 0, W, H), d = id.data, bg = paperLight(src);
    for(let i = 0; i < d.length; i += 4){
      let r = d[i] * 255 / Math.max(40, bg[i]), g = d[i+1] * 255 / Math.max(40, bg[i+1]), b = d[i+2] * 255 / Math.max(40, bg[i+2]);
      {
        // levels + a darker middle (gamma) + more colour: faint pen writing stays readable on clean white
        // (tuned on the owner's own bank slips)
        const lift = c => 255 * Math.pow(clamp((c - 10) * 255 / 235, 0, 255) / 255, 2.3);
        r = lift(r); g = lift(g); b = lift(b);
        const m = (r + g + b) / 3, sat = 1.55;
        d[i] = clamp(m + (r - m) * sat, 0, 255); d[i+1] = clamp(m + (g - m) * sat, 0, 255); d[i+2] = clamp(m + (b - m) * sat, 0, 255);
        if(d[i] > 238 && d[i+1] > 238 && d[i+2] > 238){ d[i] = d[i+1] = d[i+2] = 255; }
      }
    }
    oc.putImageData(id, 0, 0);
    return out;
  }

  // 🖼 আসল: the slip's own colours (pink stays pink), just bolder — more contrast and colour
  function vivid(src){
    const W = src.width, H = src.height, out = newCanvas(W, H), oc = out.getContext('2d'), id = src.getContext('2d').getImageData(0, 0, W, H), d = id.data;
    for(let i = 0; i < d.length; i += 4){
      let r = clamp((d[i] - 25) * 255 / 215, 0, 255), g = clamp((d[i+1] - 25) * 255 / 215, 0, 255), b = clamp((d[i+2] - 25) * 255 / 215, 0, 255);
      r = 255 * Math.pow(r / 255, 1.35); g = 255 * Math.pow(g / 255, 1.35); b = 255 * Math.pow(b / 255, 1.35);
      const m = (r + g + b) / 3;
      d[i] = clamp(m + (r - m) * 1.45, 0, 255); d[i+1] = clamp(m + (g - m) * 1.45, 0, 255); d[i+2] = clamp(m + (b - m) * 1.45, 0, 255);
    }
    oc.putImageData(id, 0, 0);
    return out;
  }

  // stamp photo → only the ink (stamp + signature) on a see-through background, cropped
  function cutStamp(src, strength){
    const W = src.width, H = src.height, id = src.getContext('2d').getImageData(0, 0, W, H), d = id.data, bg = paperLight(src);
    const hi = 232 - strength * 45, lo = hi - 85, edge = Math.round(Math.min(W, H) * 0.03);   // paper edges / shadows are not ink
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for(let y = 0; y < H; y++) for(let x = 0; x < W; x++){
      const i = (y * W + x) * 4;
      const r = clamp(d[i] * 255 / Math.max(40, bg[i]), 0, 255), g = clamp(d[i+1] * 255 / Math.max(40, bg[i+1]), 0, 255), b = clamp(d[i+2] * 255 / Math.max(40, bg[i+2]), 0, 255);
      const L = 0.299 * r + 0.587 * g + 0.114 * b, sat = Math.max(r, g, b) - Math.min(r, g, b);
      const nearEdge = x < edge || y < edge || x >= W - edge || y >= H - edge;
      const a = nearEdge ? 0 : Math.max(clamp((hi - L) / (hi - lo), 0, 1), clamp((sat - 35 + strength * 15) / 55, 0, 1));
      // the ink colour itself (as if printed on white at full strength)
      const ink = c => a > 0.02 ? clamp(255 - (255 - c) / a, 0, 255) : 255;
      d[i] = ink(r) * 0.9; d[i+1] = ink(g) * 0.9; d[i+2] = ink(b) * 0.9; d[i+3] = a * 255;
      if(a > 0.25){ if(x < minX) minX = x; if(x > maxX) maxX = x; if(y < minY) minY = y; if(y > maxY) maxY = y; }
    }
    if(maxX < 0) return null;
    const full = newCanvas(W, H); full.getContext('2d').putImageData(id, 0, 0);
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad); maxX = Math.min(W - 1, maxX + pad); maxY = Math.min(H - 1, maxY + pad);
    const cw = maxX - minX + 1, ch = maxY - minY + 1, k = Math.min(1, 900 / Math.max(cw, ch));
    const out = newCanvas(cw * k, ch * k); out.getContext('2d').drawImage(full, minX, minY, cw, ch, 0, 0, out.width, out.height);
    return out;
  }
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

  /* ---------- saved stamp (online: settings/stamp → every phone / computer) ---------- */
  let stamp = null, stampImg = null, stampLoaded = false;
  async function useStamp(data){
    stamp = data && data.img ? data : null;
    stampImg = stamp ? await loadImg(stamp.img).catch(() => null) : null;
  }
  async function loadStamp(){
    try{ const db = await getDB(); if(db){ const d = await db.doc('settings/stamp').get(); await useStamp(d.exists ? d.data() : null); } }catch(_){}
    stampLoaded = true;
  }
  window.__stampRemote = async data => { await useStamp(data); if(!root.hidden) render(); };

  /* ---------- 📲 WhatsApp numbers (online: settings/wa → every device) ---------- */
  let wa = [], waLoaded = false;
  async function loadWa(){ try{ const db = await getDB(); if(db){ const d = await db.doc('settings/wa').get(); wa = d.exists && Array.isArray(d.data().list) ? d.data().list : []; } }catch(_){} waLoaded = true; }
  async function saveWa(){ try{ const db = await getDB(); if(db) await db.doc('settings/wa').set({list: wa}); }catch(_){} }
  window.__stampWaRemote = data => { wa = data && Array.isArray(data.list) ? data.list : []; if(!root.hidden) render(); };
  // 01712-345678 / +880 1712… / ০১৭… → 8801712345678
  const normPhone = p => { let d = String(p || '').replace(/[০-৯]/g, c => BD.indexOf(c)).replace(/\D/g, ''); if(d.startsWith('00')) d = d.slice(2); if(d.length === 11 && d[0] === '0') d = '88' + d; return d; };
  const showPhone = p => { const d = normPhone(p); return toBn(d.startsWith('880') ? '0' + d.slice(3) : d); };

  /* ---------- 📁 ভাউচার লিস্ট: finished vouchers are kept on THIS phone / computer only (IndexedDB — never in the
     online database, the pictures would fill it). meta = {id, ts, date, name, note, thumb, w, h, size, acts[{k, to, ts}]},
     img = the full JPG. Each device has its own list; clearing the app's data / uninstalling removes it. ---------- */
  const VL = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => {
      if(!window.indexedDB) return rej(new Error('এই ব্রাউজারে জায়গা নেই'));
      const r = indexedDB.open('khata-vouchers', 1);
      r.onupgradeneeded = () => { const d = r.result;
        if(!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', {keyPath: 'id'});
        if(!d.objectStoreNames.contains('img')) d.createObjectStore('img', {keyPath: 'id'}); };
      r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
      r.onerror = () => { dbp = null; rej(r.error || new Error('IndexedDB')); };
    }));
    const run = async (stores, mode, fn) => { const d = await open(); return new Promise((res, rej) => {
      const t = d.transaction(stores, mode); let out;
      t.oncomplete = () => res(out); t.onerror = t.onabort = () => rej(t.error || new Error('IndexedDB'));
      const rq = fn(t); if(rq) rq.onsuccess = () => { out = rq.result; };
    }); };
    return {
      all: () => run(['meta'], 'readonly', t => t.objectStore('meta').getAll()).then(l => (l || []).sort((a, b) => b.ts - a.ts)),
      get: id => run(['meta'], 'readonly', t => t.objectStore('meta').get(id)),
      img: id => run(['img'], 'readonly', t => t.objectStore('img').get(id)).then(r => r ? new Blob([r.buf], {type: r.type || 'image/jpeg'}) : null),
      put: (meta, buf) => run(['meta', 'img'], 'readwrite', t => { t.objectStore('meta').put(meta); t.objectStore('img').put({id: meta.id, buf, type: 'image/jpeg'}); }),
      meta: meta => run(['meta'], 'readwrite', t => { t.objectStore('meta').put(meta); }),
      del: id => run(['meta', 'img'], 'readwrite', t => { t.objectStore('meta').delete(id); t.objectStore('img').delete(id); }),
    };
  })();
  const blobBuf = b => b.arrayBuffer ? b.arrayBuffer() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(b); });
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const bnTime = ts => { const d = new Date(ts), h = d.getHours();
    return (h < 4 ? 'রাত' : h < 12 ? 'সকাল' : h < 15 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত') + ' ' + toBn((h % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0')); };
  const mb = n => toBn((n / 1048576).toFixed(n < 10485760 ? 1 : 0));
  const ACT = {save: '⬇ নামানো', print: '🖨 প্রিন্ট', share: '📤 শেয়ার'};
  const tagsOf = m => { const seen = new Set(), out = [];
    for(const a of (m.acts || [])){ const t = a.k === 'wa' ? '📲 ' + (a.to || 'WhatsApp') : ACT[a.k]; if(t && !seen.has(t)){ seen.add(t); out.push(t); } }
    return out; };
  let list = null, vlShow = 24, vlQ = '', persisted = false, keepWarned = false;

  /* ---------- page state ---------- */
  let newStamp = null;     // {src, strength, cut} while setting a new stamp
  let V = null;            // voucher: {src, quad, scan, mode, view, step}
  let place = {cx: 0.62, cy: 0.62, w: 0.26, rot: -8, on: true};
  try{ Object.assign(place, JSON.parse(localStorage.getItem('kg-khata-stamp-place') || '{}')); }catch(_){}
  const keepPlace = () => { try{ localStorage.setItem('kg-khata-stamp-place', JSON.stringify(place)); }catch(_){} };

  const pickBtns = (id) => `<div class="stp-pick">
      <label class="stp-btn main">📷 ছবি তুলুন<input type="file" accept="image/*" capture="environment" data-pick="${id}" hidden></label>
      <label class="stp-btn">🖼 গ্যালারি থেকে<input type="file" accept="image/*" data-pick="${id}" hidden></label></div>`;

  function render(){
    if(root.hidden) return;
    if(!stampLoaded || !waLoaded){ root.innerHTML = uHead('🔖 স্ট্যাম্প', 'ভাউচারে স্ট্যাম্প ও সই') + '<p class="loading">খোলা হচ্ছে…</p>'; Promise.all([stampLoaded || loadStamp(), waLoaded || loadWa()]).then(render); return; }
    const steps = ['ছবি', 'কোণা ঠিক', 'স্ট্যাম্প বসান', 'প্রিন্ট / নামান'], cur = !V ? 0 : V.step;
    root.innerHTML = uHead('🔖 স্ট্যাম্প', 'ভাউচারে স্ট্যাম্প ও সই বসিয়ে প্রিন্ট') + `
      <section class="stp-card">
        <h2>✍️ আপনার স্ট্যাম্প ও সই</h2>
        <p class="sub">একবার সাদা কাগজে স্ট্যাম্প আর সই দিয়ে ছবি তুলে সেভ করুন — সব ফোন / কম্পিউটারে থাকবে। বদলাতে চাইলে নতুন ছবি দিন।</p>
        ${newStamp ? `
          <div class="stp-chk"><canvas id="nsView"></canvas></div>
          <label class="stp-sl">কাগজের দাগ মুছুন: কম<input type="range" id="nsStr" min="0" max="100" value="${Math.round(newStamp.strength * 100)}">বেশি</label>
          <div class="stp-acts"><button type="button" class="stp-btn main" id="nsSave">✓ স্ট্যাম্প সেভ করুন</button><button type="button" class="stp-btn" id="nsNo">বাতিল</button></div>`
        : `${stampImg ? `<div class="stp-chk saved"><img src="${stamp.img}" alt="সেভ করা স্ট্যাম্প"></div><p class="stp-when">✓ সেভ করা আছে${stamp.by ? ' · ' + esc(stamp.by) : ''}</p>` : '<p class="stp-empty">এখনো কোনো স্ট্যাম্প সেভ করা নেই।</p>'}
           ${pickBtns('stamp')}`}
      </section>

      <section class="stp-card">
        <h2>🧾 ভাউচার</h2>
        <ol class="stp-steps">${steps.map((s, i) => `<li class="${i === cur ? 'now' : i < cur ? 'done' : ''}">${toBn(i + 1)}. ${s}</li>`).join('')}</ol>
        ${!V ? `<p class="sub">ব্যাংকের ভাউচার / রসিদের ছবি তুলুন — অ্যাপ নিজে কাগজটা খুঁজে সোজা আর পরিষ্কার করবে (CamScanner-এর মতো), তারপর আপনার স্ট্যাম্প বসাবে।</p>${pickBtns('voucher')}`
        : V.step === 1 ? `
          <p class="sub">কাগজের ৪ কোণায় গোল দাগগুলো টেনে ঠিক জায়গায় বসান।</p>
          <div class="stp-stage"><canvas id="vCrop"></canvas></div>
          <div class="stp-acts"><button type="button" class="stp-btn main" id="vScan">✨ স্ক্যান করুন</button><button type="button" class="stp-btn" id="vWhole">পুরো ছবি রাখুন</button><button type="button" class="stp-btn" id="vNew">বাতিল</button></div>`
        : `
          <div class="stp-modes" role="group" aria-label="ছবির ধরন">${[['color','✨ পরিষ্কার সাদা'],['orig','🎨 আসল রঙ (গাঢ়)']].map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${V.mode === k}">${l}</button>`).join('')}</div>
          <div class="stp-stage"><canvas id="vPlace"></canvas></div>
          ${stampImg ? `<label class="stp-on"><input type="checkbox" id="pOn" ${place.on ? 'checked' : ''}> স্ট্যাম্প ও সই দিন</label>
          <p class="sub">স্ট্যাম্পটা আঙুল / মাউস দিয়ে টেনে জায়গামতো বসান।</p>
          <label class="stp-sl">আকার<input type="range" id="pW" min="8" max="70" value="${Math.round(place.w * 100)}"></label>
          <label class="stp-sl">ঘোরান<input type="range" id="pR" min="-45" max="45" value="${Math.round(place.rot)}"></label>` : '<p class="stp-empty">উপরে আগে স্ট্যাম্প সেভ করুন — তাহলে এখানে বসানো যাবে।</p>'}
          <label class="stp-note">📝 নোট <small>(ইচ্ছা হলে — লিস্টে খুঁজতে সুবিধা)</small><input type="text" id="vNote" autocomplete="off" maxlength="120" value="${esc(V.note || '')}" placeholder="যেমন: Karnafully জমা ৫০,০০০"></label>
          <div class="stp-acts">
            <button type="button" class="stp-btn main" id="vSave">⬇ ছবি নামান</button>
            <button type="button" class="stp-btn" id="vKeep">${keepLabel()}</button>
            ${window.KhataApp ? '' : '<button type="button" class="stp-btn" id="vPrint">🖨 প্রিন্ট</button>'}
            ${navigator.canShare ? '<button type="button" class="stp-btn" id="vShare">📤 শেয়ার</button>' : ''}
            <button type="button" class="stp-btn" id="vNew">🧾 নতুন ভাউচার</button>
          </div>
          <p class="stp-hint">নামালে / পাঠালে ভাউচারটা নিজে থেকেই নিচের 📁 ভাউচার লিস্টে জমা হয়।</p>
          <div class="stp-wa">
            <h3>📲 WhatsApp-এ পাঠান</h3>
            <p class="sub">নামে চাপ দিলে ওই নম্বরের WhatsApp চ্যাট খুলবে, ভাউচারের ছবি সাথে থাকবে — শুধু Send চাপুন।</p>
            <div class="wa-list">${wa.length ? wa.map(c => `<span class="wa-c"><button type="button" class="wa-go" data-wa="${esc(c.id)}">🟢 ${esc(c.name)} <small>${showPhone(c.phone)}</small></button><button type="button" class="wa-x" data-wax="${esc(c.id)}" aria-label="নম্বর মুছুন">×</button></span>`).join('') : '<span class="stp-empty">এখনো কোনো নম্বর নেই — নিচে যোগ করুন।</span>'}</div>
            <div class="wa-add"><input id="waName" autocomplete="off" placeholder="নাম (যেমন Karnafully)"><input id="waNum" inputmode="tel" autocomplete="off" placeholder="WhatsApp নম্বর ০১৭…"><button type="button" class="stp-btn" id="waAdd">＋ যোগ</button></div>
          </div>`}
      </section>

      <section class="stp-card stp-vl" id="vlCard">
        <h2>📁 ভাউচার লিস্ট</h2>
        <p class="sub" id="vlSum">শুধু এই ফোন / কম্পিউটারে রাখা — অনলাইন ডেটাবেসে না।</p>
        <div class="vl-q" id="vlQw" hidden><input type="search" id="vlQ" autocomplete="off" placeholder="🔍 নোট, নাম বা তারিখ (যেমন ১৭ নভেম্বর)" value="${esc(vlQ)}"></div>
        <div id="vlBox"><p class="loading">খোলা হচ্ছে…</p></div>
      </section>`;
    bind();
    drawList();
  }

  // the 💾 button: not kept yet / kept / changed since it was kept
  const keepLabel = () => !V || !V.id ? '💾 লিস্টে রাখুন' : V.dirty ? '💾 বদলসহ আবার রাখুন' : '✓ লিস্টে রাখা আছে';
  const changed = () => { if(V && V.id && !V.dirty){ V.dirty = true; const b = root.querySelector('#vKeep'); if(b) b.textContent = keepLabel(); } };

  async function drawList(){
    const box = root.querySelector('#vlBox'); if(!box) return;
    if(!list){
      try{ list = await VL.all(); }
      catch(e){ box.innerHTML = `<p class="stp-empty">⚠️ এই ব্রাউজারে ভাউচার লিস্ট রাখা যাচ্ছে না (${esc(e.message)})।</p>`; return; }
      if(!root.querySelector('#vlBox')) return;
    }
    const size = list.reduce((s, m) => s + (m.size || 0), 0);
    const sum = root.querySelector('#vlSum');
    if(sum) sum.innerHTML = `শুধু এই ফোন / কম্পিউটারে রাখা — অনলাইন ডেটাবেসে না।${list.length ? ` <b>মোট ${toBn(list.length)}টা · ${mb(size)} MB</b>` : ''}`;
    const qw = root.querySelector('#vlQw'); if(qw) qw.hidden = list.length < 4 && !vlQ;
    if(!list.length){ box.innerHTML = '<p class="stp-empty">এখনো কোনো ভাউচার নেই — উপরে ভাউচার বানিয়ে ⬇ নামান / 📲 পাঠান / 💾 লিস্টে রাখুন চাপলে এখানে তারিখ অনুযায়ী জমা থাকবে।</p>'; return; }
    const q = toBn(vlQ.trim().toLowerCase());
    const rows = q ? list.filter(m => toBn((m.note || '').toLowerCase()).includes(q) || bnLongDate(m.date).includes(q) || tagsOf(m).some(t => t.toLowerCase().includes(q))) : list;
    if(!rows.length){ box.innerHTML = '<p class="stp-empty">এই খোঁজে কোনো ভাউচার নেই।</p>'; return; }
    const perDay = {}; rows.forEach(m => { perDay[m.date] = (perDay[m.date] || 0) + 1; });
    let html = '', day = null;
    rows.slice(0, vlShow).forEach(m => {
      if(m.date !== day){ if(day) html += '</div>'; day = m.date;
        html += `<h3 class="vl-day">📅 ${bnLongDate(day)}<small>${toBn(perDay[day])}টা ভাউচার</small></h3><div class="vl-grid">`; }
      const tags = tagsOf(m);
      html += `<button type="button" class="vl-it" data-vid="${esc(m.id)}">
        <span class="vl-img"><img src="${m.thumb}" alt="" loading="lazy"></span>
        <span class="vl-tm">🕘 ${bnTime(m.ts)}</span>
        ${m.note ? `<span class="vl-nt">${esc(m.note)}</span>` : ''}
        ${tags.length ? `<span class="vl-tg">${tags.map(t => `<i>${esc(t)}</i>`).join('')}</span>` : ''}</button>`;
    });
    html += '</div>';
    if(rows.length > vlShow) html += `<button type="button" class="stp-btn vl-more" id="vlMore">▾ আরো পুরনো ভাউচার (বাকি ${toBn(rows.length - vlShow)}টা)</button>`;
    box.innerHTML = html;
    box.querySelectorAll('[data-vid]').forEach(b => b.onclick = () => openV(b.dataset.vid));
    const more = box.querySelector('#vlMore'); if(more) more.onclick = () => { vlShow += 24; drawList(); };
  }

  // keep the voucher on screen in the list (the same voucher is updated, not added again)
  async function keep(f){
    const now = Date.now();
    let m = V.id ? ((list && list.find(x => x.id === V.id)) || await VL.get(V.id)) : null;
    m = m ? {...m} : {id: 'v' + now.toString(36) + Math.random().toString(36).slice(2, 6), ts: now, date: ymd(new Date(now)), acts: []};
    Object.assign(m, {upd: now, name: f.name, note: V.note || '', thumb: f.thumb, w: f.w, h: f.h, size: f.blob.size});
    await VL.put(m, await blobBuf(f.blob));
    V.id = m.id; V.dirty = false; list = null;
    if(!persisted){ persisted = true; try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(_){} }   // ask the browser not to clear it by itself
    const b = root.querySelector('#vKeep'); if(b) b.textContent = keepLabel();
    drawList();
    return m;
  }
  // the finished voucher on screen, kept in the list first (if the list can't be written, saving / sending still works)
  async function current(){
    const f = await finished();
    try{ if(!V.id || V.dirty) await keep(f); }
    catch(e){ if(!keepWarned){ keepWarned = true; toast('<b>⚠️ ভাউচার লিস্টে রাখা গেল না</b><span>' + esc(e.message || e) + '</span>', 5000); } }
    return f;
  }
  async function addAct(id, act){
    if(!id || !act) return;
    try{ const m = await VL.get(id); if(!m) return; m.acts = [...(m.acts || []), {...act, ts: Date.now()}]; await VL.meta(m); list = null; drawList(); }catch(_){}
  }

  // one kept voucher: big picture + নামান / শেয়ার / প্রিন্ট / WhatsApp / নোট / মুছুন
  async function openV(id){
    const m = (list || []).find(x => x.id === id) || await VL.get(id).catch(() => null); if(!m) return;
    const blob = await VL.img(id).catch(() => null);
    if(!blob){ toast('<b>⚠️ ছবিটা পাওয়া গেল না</b>'); return; }
    const url = URL.createObjectURL(blob), tags = tagsOf(m);
    const p = __auPop(`<h3>🧾 ভাউচার <button class="x" data-close aria-label="বন্ধ">✕</button></h3>
      <p class="sub">📅 ${bnLongDate(m.date)} · ${bnTime(m.ts)}${m.size ? ' · ' + mb(m.size) + ' MB' : ''}</p>
      <div class="vl-big"><img src="${url}" alt="ভাউচার"></div>
      ${tags.length ? `<p class="vl-tg vl-tg-b">${tags.map(t => `<i>${esc(t)}</i>`).join('')}</p>` : ''}
      <label class="f" for="vlNote">📝 নোট</label><input type="text" id="vlNote" autocomplete="off" maxlength="120" value="${esc(m.note || '')}" placeholder="যেমন: Karnafully জমা ৫০,০০০">
      <div class="stp-acts">
        <button type="button" class="stp-btn main" data-vx="save">⬇ ছবি নামান</button>
        ${window.KhataApp ? '' : '<button type="button" class="stp-btn" data-vx="print">🖨 প্রিন্ট</button>'}
        ${navigator.canShare ? '<button type="button" class="stp-btn" data-vx="share">📤 শেয়ার</button>' : ''}
      </div>
      ${wa.length ? `<div class="stp-wa vl-wa"><h4>📲 WhatsApp-এ পাঠান</h4><div class="wa-list">${wa.map(c => `<button type="button" class="wa-go" data-vwa="${esc(c.id)}">🟢 ${esc(c.name)} <small>${showPhone(c.phone)}</small></button>`).join('')}</div></div>` : ''}
      <div class="acts"><button type="button" class="r" id="vlDel">🗑 মুছুন</button><button type="button" data-close>বন্ধ</button></div>`,
      () => { setTimeout(() => URL.revokeObjectURL(url), 1000); saveNote(); });
    p.el.classList.add('vl-pop');
    const note = p.el.querySelector('#vlNote');
    const saveNote = async () => {
      const v = note.value.trim(); if(v === (m.note || '')) return;
      m.note = v; try{ const cur = await VL.get(id); if(cur){ cur.note = v; await VL.meta(cur); } }catch(_){}
      if(V && V.id === id){ V.note = v; const n = root.querySelector('#vNote'); if(n) n.value = v; }
      list = null; drawList();
    };
    note.onchange = saveNote;
    p.el.querySelectorAll('[data-vx]').forEach(b => b.onclick = async () => { const done = await exportBlob(b.dataset.vx, blob, m.name || 'voucher.jpg'); if(done) addAct(id, {k: done}); });
    p.el.querySelectorAll('[data-vwa]').forEach(b => b.onclick = async () => { const c = wa.find(x => x.id === b.dataset.vwa); if(c && await sendWaBlob(c, blob, m.name || 'voucher.jpg')) addAct(id, {k: 'wa', to: c.name}); });
    const del = p.el.querySelector('#vlDel');
    del.onclick = async () => {
      if(!del.classList.contains('sure')){ del.classList.add('sure'); del.textContent = '⚠️ আবার চাপুন — মুছে যাবে'; setTimeout(() => { del.classList.remove('sure'); del.textContent = '🗑 মুছুন'; }, 3500); return; }
      try{ await VL.del(id); }catch(e){ toast('<b>⚠️ মোছা গেল না</b><span>' + esc(e.message) + '</span>'); return; }
      if(V && V.id === id){ V.id = null; V.dirty = false; const b = root.querySelector('#vKeep'); if(b) b.textContent = keepLabel(); }
      m.note = note.value.trim(); list = null; p.close(); drawList(); toast('<b>🗑 ভাউচার মুছে ফেলা হয়েছে</b><span>শুধু এই ফোনের লিস্ট থেকে।</span>');
    };
  }

  function bind(){
    const $ = id => root.querySelector('#' + id);
    root.querySelectorAll('[data-pick]').forEach(inp => inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if(!f) return;
      try{
        if(inp.dataset.pick === 'stamp'){
          // only the white paper (a table / hand around it must not count as ink), straightened
          const photo = await fileToCanvas(f, 1600), src = warp(photo, findPaper(photo));
          newStamp = {src, strength: 0.5, cut: null}; newStamp.cut = cutStamp(src, 0.5);
          if(!newStamp.cut){ newStamp = null; toast('<b>⚠️ ছবিতে স্ট্যাম্প / সই পাওয়া গেল না</b><span>সাদা কাগজে, আলোতে আবার ছবি তুলুন।</span>', 5000); }
        } else {
          const src = await fileToCanvas(f, 2200);
          V = {src, quad: findPaper(src), scan: null, mode: 'orig', step: 1};   // owner: আসল রঙ (গাঢ়) by default
        }
        render();
      }catch(e){ toast('<b>⚠️ ' + esc(e.message) + '</b>'); }
    });
    // new stamp: preview, strength, save
    if($('nsView')) drawChecker($('nsView'), newStamp.cut);
    if($('nsStr')) $('nsStr').oninput = e => { newStamp.strength = e.target.value / 100; newStamp.cut = cutStamp(newStamp.src, newStamp.strength) || newStamp.cut; drawChecker($('nsView'), newStamp.cut); };
    if($('nsNo')) $('nsNo').onclick = () => { newStamp = null; render(); };
    if($('nsSave')) $('nsSave').onclick = async () => {
      const data = {img: newStamp.cut.toDataURL('image/png'), w: newStamp.cut.width, h: newStamp.cut.height, ts: Date.now(), by: (window.__me || {}).name || ''};
      try{ const db = await getDB(); if(db) await db.doc('settings/stamp').set(data); }catch(_){}
      await useStamp(data); newStamp = null; render(); toast('<b>✓ স্ট্যাম্প ও সই সেভ হয়েছে</b><span>এখন সব ভাউচারে এটাই বসবে।</span>');
    };
    // voucher step 1: corners
    if($('vCrop')) cropUI($('vCrop'));
    if($('vScan')) $('vScan').onclick = () => scanNow();
    if($('vWhole')) $('vWhole').onclick = () => { V.quad = [{x:0,y:0},{x:V.src.width,y:0},{x:V.src.width,y:V.src.height},{x:0,y:V.src.height}]; scanNow(); };
    root.querySelectorAll('#vNew').forEach(b => b.onclick = () => { V = null; render(); });
    // voucher step 2: mode, stamp place, export
    root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { if(V.mode === b.dataset.mode) return; V.mode = b.dataset.mode; V.view = enhance(V.scan, V.mode); changed(); render(); });
    if($('vPlace')) placeUI($('vPlace'));
    if($('pOn')) $('pOn').onchange = e => { place.on = e.target.checked; keepPlace(); changed(); drawPlace($('vPlace')); };
    if($('pW')) $('pW').oninput = e => { place.w = e.target.value / 100; keepPlace(); changed(); drawPlace($('vPlace')); };
    if($('pR')) $('pR').oninput = e => { place.rot = +e.target.value; keepPlace(); changed(); drawPlace($('vPlace')); };
    if($('vSave')) $('vSave').onclick = () => exportImg('save');
    // 📝 note: kept with the voucher in the list
    if($('vNote')){ let tm = 0; $('vNote').oninput = e => { V.note = e.target.value.trim(); if(V.id){ clearTimeout(tm); tm = setTimeout(async () => {
      try{ const m = await VL.get(V.id); if(m){ m.note = V.note; await VL.meta(m); list = null; drawList(); } }catch(_){} }, 500); } }; }
    if($('vKeep')) $('vKeep').onclick = async () => {
      const b = $('vKeep'); if(V.id && !V.dirty){ root.querySelector('#vlCard').scrollIntoView({behavior: 'smooth', block: 'start'}); return; }
      b.disabled = true; b.textContent = '⏳ রাখা হচ্ছে…';
      try{ await keep(await finished()); toast('<b>✓ ভাউচার লিস্টে রাখা হয়েছে</b><span>নিচে 📁 ভাউচার লিস্টে আজকের তারিখে আছে (শুধু এই ফোনে)।</span>'); }
      catch(e){ toast('<b>⚠️ লিস্টে রাখা গেল না</b><span>' + esc(e.message || e) + '</span>', 5000); }
      b.disabled = false; b.textContent = keepLabel();
    };
    if($('vlQ')) $('vlQ').oninput = e => { vlQ = e.target.value; vlShow = 24; drawList(); };
    root.querySelectorAll('[data-wa]').forEach(b => b.onclick = () => sendWa(wa.find(c => c.id === b.dataset.wa), b));
    root.querySelectorAll('[data-wax]').forEach(b => b.onclick = async () => {
      if(!b.classList.contains('sure')){ b.classList.add('sure'); b.textContent = 'মুছুন?'; setTimeout(() => { b.classList.remove('sure'); b.textContent = '×'; }, 3000); return; }
      wa = wa.filter(c => c.id !== b.dataset.wax); await saveWa(); render();
    });
    if($('waAdd')) $('waAdd').onclick = async () => {
      const name = $('waName').value.trim(), phone = normPhone($('waNum').value);
      if(!name || phone.length < 10){ toast('<b>নাম আর সঠিক WhatsApp নম্বর দিন</b>'); return; }
      wa.push({id: Date.now().toString(36), name, phone}); await saveWa(); render();
    };
    if($('vPrint')) $('vPrint').onclick = () => exportImg('print');
    if($('vShare')) $('vShare').onclick = () => exportImg('share');
  }

  function drawChecker(cv, img){
    if(!cv || !img) return;
    const maxW = Math.min(520, cv.parentElement.clientWidth || 520), k = Math.min(1, maxW / img.width);
    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); c.drawImage(img, 0, 0, cv.width, cv.height);
  }

  function scanNow(){
    const b = root.querySelector('#vScan'); if(b){ b.disabled = true; b.textContent = '⏳ স্ক্যান হচ্ছে…'; }
    setTimeout(() => {   // let the button text show first
      V.scan = warp(V.src, V.quad); V.view = enhance(V.scan, V.mode); V.step = 2; render();
      root.querySelector('.stp-stage') && root.querySelector('.stp-stage').scrollIntoView({block: 'nearest'});
    }, 30);
  }

  // drag the 4 corner dots
  function cropUI(cv){
    const src = V.src, maxW = cv.parentElement.clientWidth || 600, maxH = Math.max(260, window.innerHeight * 0.62);
    const k = Math.min(maxW / src.width, maxH / src.height, 1); cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k);
    const ctx = cv.getContext('2d');
    const draw = () => {
      ctx.drawImage(src, 0, 0, cv.width, cv.height);
      ctx.fillStyle = 'rgba(15,23,42,.35)'; ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height);
      V.quad.slice().reverse().forEach((p, i) => i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)); ctx.closePath(); ctx.fill('evenodd');
      ctx.strokeStyle = '#2E90FA'; ctx.lineWidth = 2.5; ctx.beginPath(); V.quad.forEach((p, i) => i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)); ctx.closePath(); ctx.stroke();
      V.quad.forEach(p => { ctx.beginPath(); ctx.arc(p.x * k, p.y * k, 11, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#1F4AA8'; ctx.stroke(); });
    };
    draw();
    let drag = -1;
    const pos = e => { const r = cv.getBoundingClientRect(); return {x: (e.clientX - r.left) * cv.width / r.width / k, y: (e.clientY - r.top) * cv.height / r.height / k}; };
    cv.onpointerdown = e => { const p = pos(e); let bestD = 1e9; V.quad.forEach((q, i) => { const dd = Math.hypot(q.x - p.x, q.y - p.y); if(dd < bestD){ bestD = dd; drag = i; } });
      if(bestD * k > 48) drag = -1; else { cv.setPointerCapture(e.pointerId); e.preventDefault(); } };
    cv.onpointermove = e => { if(drag < 0) return; const p = pos(e); V.quad[drag] = {x: clamp(p.x, 0, src.width), y: clamp(p.y, 0, src.height)}; draw(); };
    cv.onpointerup = cv.onpointercancel = () => { drag = -1; };
  }

  // the stamp as it goes on paper (owner: bold and colourful like a real stamp): lines 1 px thicker, ink full strength,
  // the stamp's colour (blue / violet) brighter, the signature (grey) near black
  let bold = null;
  function boldStamp(){
    if(!stampImg) return null;
    if(bold && bold.of === stampImg) return bold.c;
    const w = stampImg.naturalWidth, h = stampImg.naturalHeight, c = newCanvas(w, h), cx = c.getContext('2d');
    cx.drawImage(stampImg, 0, 0); const id = cx.getImageData(0, 0, w, h), d = id.data, o = new Uint8ClampedArray(d.length);
    for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
      let best = (y * w + x) * 4;
      for(let dy = -1; dy <= 1; dy++) for(let dx = -1; dx <= 1; dx++){ const xx = x + dx, yy = y + dy; if(xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = (yy * w + xx) * 4; if(d[j + 3] > d[best + 3]) best = j; }
      const i = (y * w + x) * 4;
      const r = d[best], g = d[best+1], b = d[best+2], m = (r + g + b) / 3, sat = Math.max(r, g, b) - Math.min(r, g, b);
      if(sat > 22){ const k = 1.9; o[i] = clamp((m + (r - m) * k) * 0.82, 0, 255); o[i+1] = clamp((m + (g - m) * k) * 0.82, 0, 255); o[i+2] = clamp((m + (b - m) * k) * 0.82, 0, 255); }
      else { o[i] = r * 0.35; o[i+1] = g * 0.35; o[i+2] = b * 0.35; }
      o[i+3] = Math.min(255, d[best+3] * 1.9);
    }
    id.data.set(o); cx.putImageData(id, 0, 0);
    bold = {of: stampImg, c};
    return c;
  }
  // the voucher with the stamp on it (full size for saving, or scaled for the screen)
  function compose(target, k){
    const v = V.view, ctx = target.getContext('2d');
    ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(v, 0, 0, v.width * k, v.height * k);
    const st = place.on ? boldStamp() : null;
    if(st){
      const w = v.width * place.w * k, h = w * st.height / st.width;
      ctx.save(); ctx.globalCompositeOperation = 'multiply';   // like real ink: the paper shows through
      ctx.translate(v.width * place.cx * k, v.height * place.cy * k); ctx.rotate(place.rot * Math.PI / 180);
      ctx.drawImage(st, -w / 2, -h / 2, w, h); ctx.restore();
    }
  }
  let viewK = 1;
  function drawPlace(cv){
    if(!cv) return;
    const v = V.view, maxW = cv.parentElement.clientWidth || 700, maxH = Math.max(260, window.innerHeight * 0.7);
    viewK = Math.min(maxW / v.width, maxH / v.height, 1); cv.width = Math.round(v.width * viewK); cv.height = Math.round(v.height * viewK);
    compose(cv, viewK);
  }
  function placeUI(cv){
    drawPlace(cv);
    let drag = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return {x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height}; };
    cv.onpointerdown = e => { if(!stampImg || !place.on) return; const p = pos(e); drag = {dx: place.cx - p.x, dy: place.cy - p.y};
      const near = Math.hypot((p.x - place.cx) * cv.width, (p.y - place.cy) * cv.height) < place.w * cv.width * 0.8;
      if(!near) drag = {dx: 0, dy: 0}; place.cx = p.x + drag.dx; place.cy = p.y + drag.dy; drawPlace(cv); cv.setPointerCapture(e.pointerId); e.preventDefault(); };
    cv.onpointermove = e => { if(!drag) return; const p = pos(e); place.cx = clamp(p.x + drag.dx, 0, 1); place.cy = clamp(p.y + drag.dy, 0, 1); drawPlace(cv); };
    cv.onpointerup = cv.onpointercancel = () => { if(drag){ drag = null; keepPlace(); changed(); } };
  }

  async function finished(){
    const v = V.view, full = newCanvas(v.width, v.height); compose(full, 1);
    const blob = await new Promise(r => full.toBlob(r, 'image/jpeg', 0.92));
    const d = new Date();
    if(!V.name) V.name = `voucher-${ymd(d)}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}.jpg`;
    return {blob, name: V.name, thumb: scaled(full, 360).toDataURL('image/jpeg', 0.72), w: full.width, h: full.height};
  }
  const toB64 = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
  // 📲 to one number: Android app → that WhatsApp chat with the picture attached; phone browser → share sheet; else save + open the chat
  async function sendWa(c){
    if(!c) return;
    const f = await current();
    if(await sendWaBlob(c, f.blob, f.name)) addAct(V.id, {k: 'wa', to: c.name});
  }
  async function sendWaBlob(c, blob, name){
    const phone = normPhone(c.phone);
    if(window.KhataApp && window.KhataApp.shareWhatsApp){
      if(window.KhataApp.shareWhatsApp(await toB64(blob), name, 'image/jpeg', phone)) return true;
    }
    const file = new File([blob], name, {type: 'image/jpeg'});
    if(!window.KhataApp && navigator.canShare && navigator.canShare({files: [file]})){
      try{ await navigator.share({files: [file], title: 'ভাউচার'}); toast('<b>WhatsApp বেছে ' + esc(c.name) + '-কে পাঠান</b>', 5000); return true; }catch(e){ if(e && e.name === 'AbortError') return false; }
    }
    await exportBlob('save', blob, name);
    toast('<b>ছবি নামানো হয়েছে — WhatsApp খুলছে</b><span>' + esc(c.name) + '-এর চ্যাটে 📎 দিয়ে ছবিটা পাঠান।</span>', 7000);
    window.open('https://wa.me/' + phone, '_blank');
    return true;
  }
  async function exportImg(how){
    const f = await current();
    const done = await exportBlob(how, f.blob, f.name);
    if(done) addAct(V.id, {k: done});
  }
  // returns what was done ('share' / 'print' / 'save') or false (cancelled)
  async function exportBlob(how, blob, name){
    if(how === 'share'){
      const file = new File([blob], name, {type: 'image/jpeg'});
      try{ if(navigator.canShare && navigator.canShare({files: [file]})){ await navigator.share({files: [file], title: 'ভাউচার'}); return 'share'; } }catch(e){ if(e && e.name === 'AbortError') return false; }
      how = 'save';
    }
    if(how === 'print'){
      const url = URL.createObjectURL(blob), f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(f);
      f.contentDocument.write(`<html><head><title>${name}</title><style>@page{margin:10mm}body{margin:0}img{max-width:100%;max-height:96vh;display:block;margin:0 auto}</style></head><body><img src="${url}"></body></html>`);
      f.contentDocument.close();
      f.contentWindow.onafterprint = () => setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 500);
      const img = f.contentDocument.querySelector('img');
      const go = () => { f.contentWindow.focus(); f.contentWindow.print(); };
      if(img.complete) go(); else img.onload = go;
      return 'print';
    }
    if(window.KhataApp && window.KhataApp.saveFile){   // inside the Android app: Download/HisabKhata
      window.KhataApp.saveFile(await toB64(blob), name, 'image/jpeg'); return 'save';
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('<b>✓ ছবি নামানো হয়েছে</b><span>' + esc(name) + '</span>');
    return 'save';
  }

  window.addEventListener('resize', () => { if(root.hidden || !V) return; const c = root.querySelector('#vPlace'); if(c) drawPlace(c); });
  window.__stampRender = render;
  window.__stampTools = {findPaper, warp, enhance, cutStamp, fileToCanvas, VL};   // for checks
})();
