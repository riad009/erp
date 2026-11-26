/* 🖨 প্রিন্ট (owner bought an HP Smart Tank 580): pick many pictures (camera / gallery / 📁 ভাউচার লিস্ট) or a PDF →
   rotate each picture, A4 খাড়া / আড়াআড়ি, ১ · ২ · ৪ · ৬ · ৯ pictures on one paper, preview → print or save as PDF.
   Everything is made in the browser (canvas, jsPDF). Printing: computer / phone browser → the browser's print window;
   Android app ≥ 1.5 → the phone's print screen (KhataApp.printPdf); older app → the PDF is saved and opened. */
(function(){
  const root = document.getElementById('print');
  if(!root) return;
  const BD = '০১২৩৪৫৬৭৮৯', toBn = s => String(s).replace(/[0-9]/g, d => BD[d]);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast = (h, ms) => { if(typeof kToast === 'function') kToast(h, ms || 3500); };
  const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
  const newCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('ছবি খোলা গেল না')); i.src = src; });
  async function decode(blob){   // a picture file → <img> (the phone's own turn from the photo is kept)
    const url = URL.createObjectURL(blob);
    try{ return await loadImg(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }

  /* ---------- what to print ---------- */
  let items = [];   // [{key, file (Blob), name, w, h, thumb (small canvas), rot (0/90/180/270)}]
  let seq = 0, busy = '';
  const opts = {land: false, n: 1, auto: false, cut: false};
  try{ Object.assign(opts, JSON.parse(localStorage.getItem('kg-khata-print-opts') || '{}')); }catch(_){}
  const keepOpts = () => { try{ localStorage.setItem('kg-khata-print-opts', JSON.stringify(opts)); }catch(_){} };
  const NS = [1, 2, 4, 6, 9];
  if(!NS.includes(opts.n)) opts.n = 1;

  // a small copy for the screen (the real file is used for printing)
  async function looks(f){
    const im = await decode(f), w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, 480 / Math.max(w, h));
    const thumb = newCanvas(w * k, h * k); thumb.getContext('2d').drawImage(im, 0, 0, thumb.width, thumb.height);
    return {w, h, thumb};
  }
  async function addFiles(files){
    busy = `⏳ ${toBn(files.length)}টা ছবি খোলা হচ্ছে…`; render();
    let bad = 0;
    for(const f of files){
      try{ items.push({key: ++seq, file: f, name: f.name || 'ছবি', rot: 0, ...(await looks(f))}); }catch(_){ bad++; }
      await tick();
    }
    busy = '';
    if(bad) toast(`<b>⚠️ ${toBn(bad)}টা ছবি খোলা গেল না</b><span>JPG / PNG ছবি দিন।</span>`, 5000);
    render();
  }

  /* ---------- the paper: A4, margin 8 mm, 4 mm between pictures ---------- */
  const GRID = {1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3], 9: [3, 3]};   // columns × rows on a খাড়া page
  const paper = () => opts.land ? [297, 210] : [210, 297];
  function cells(){
    const [PW, PH] = paper(), M = 8, G = 4;
    let [c, r] = GRID[opts.n]; if(opts.land) [c, r] = [r, c];
    const w = (PW - 2 * M - (c - 1) * G) / c, h = (PH - 2 * M - (r - 1) * G) / r, out = [];
    for(let y = 0; y < r; y++) for(let x = 0; x < c; x++) out.push({x: M + x * (w + G), y: M + y * (h + G), w, h});
    return out;
  }
  const pages = () => { const out = []; for(let i = 0; i < items.length; i += opts.n) out.push(items.slice(i, i + opts.n)); return out; };
  // the picture turned by `rot`, as big as fits in the box, in the middle (auto: turned another 90° when that makes it bigger)
  function drawFit(ctx, src, sw, sh, rot, x, y, w, h){
    let r = ((rot % 360) + 360) % 360;
    const fit = rr => { const side = rr === 90 || rr === 270; return Math.min(w / (side ? sh : sw), h / (side ? sw : sh)); };
    if(opts.auto && fit((r + 90) % 360) > fit(r) * 1.05) r = (r + 90) % 360;
    const side = r === 90 || r === 270, k = fit(r), bw = sw * k, bh = sh * k;
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(r * Math.PI / 180);
    ctx.drawImage(src, -bw / 2, -bh / 2, bw, bh); ctx.restore();
  }
  // one page; pxmm = pixels per mm; pic(it) gives the picture to draw
  async function drawPage(list, pxmm, pic){
    const [PW, PH] = paper(), c = newCanvas(PW * pxmm, PH * pxmm), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const cs = cells();
    for(let i = 0; i < list.length; i++){
      const it = list[i], b = cs[i], src = await pic(it);
      drawFit(ctx, src, src.naturalWidth || src.width, src.naturalHeight || src.height, it.rot, b.x * pxmm, b.y * pxmm, b.w * pxmm, b.h * pxmm);
    }
    if(opts.cut && cs.length > 1){   // dashed lines to cut along
      ctx.save(); ctx.strokeStyle = '#9AA3B2'; ctx.lineWidth = Math.max(1, pxmm * 0.25); ctx.setLineDash([pxmm * 2, pxmm * 1.5]);
      const xs = new Set(), ys = new Set();
      cs.forEach(b => { if(b.x > 9) xs.add(b.x - 2); if(b.y > 9) ys.add(b.y - 2); });
      xs.forEach(x => { ctx.beginPath(); ctx.moveTo(x * pxmm, 0); ctx.lineTo(x * pxmm, c.height); ctx.stroke(); });
      ys.forEach(y => { ctx.beginPath(); ctx.moveTo(0, y * pxmm); ctx.lineTo(c.width, y * pxmm); ctx.stroke(); });
      ctx.restore();
    }
    return c;
  }

  /* ---------- page ---------- */
  function render(){
    if(root.hidden) return;
    const ps = pages(), n = items.length;
    const chip = (attr, val, on, label) => `<button type="button" ${attr}="${val}" aria-pressed="${on}">${label}</button>`;
    root.innerHTML = uHead('🖨 প্রিন্ট', 'ছবি · ভাউচার · PDF প্রিন্ট') + `
      <section class="stp-card">
        <h2>📥 কী প্রিন্ট করবেন</h2>
        <p class="sub">একসাথে অনেকগুলো ছবি বাছাই করতে পারেন — এক কাগজে ১টা, ২টা, ৪টা… যেভাবে চান বসিয়ে প্রিন্ট করুন।</p>
        <div class="stp-pick prn-pick">
          <label class="stp-btn main">📷 ছবি তুলুন<input type="file" accept="image/*" capture="environment" data-padd hidden></label>
          <label class="stp-btn">🖼 গ্যালারি থেকে<input type="file" accept="image/*" multiple data-padd hidden></label>
          ${window.__stampTools && window.__stampTools.VL ? '<button type="button" class="stp-btn" id="prVl">📁 ভাউচার লিস্ট থেকে</button>' : ''}
          <label class="stp-btn">📄 PDF ফাইল<input type="file" accept="application/pdf" id="prPdf" hidden></label>
        </div>
        ${busy ? `<p class="q-busy">${busy}</p>` : ''}
      </section>
      ${n ? `
      <section class="stp-card">
        <h2>🖼 ছবি <small class="q-h">${toBn(n)}টা</small></h2>
        <p class="sub">⟲ ⟳ দিয়ে ঘোরান, ✂ দিয়ে যতটুকু দরকার ততটুকু কেটে রাখুন।</p>
        <div class="prn-grid">${items.map((it, i) => `<div class="prn-it">
          <div class="prn-th"><canvas data-pth="${i}"></canvas><span class="q-no">${toBn(i + 1)}</span></div>
          <div class="prn-row">
            <button type="button" data-prot="${i}" data-d="-90" aria-label="বাঁয়ে ঘোরান">⟲</button>
            <button type="button" data-prot="${i}" data-d="90" aria-label="ডানে ঘোরান">⟳</button>
            <button type="button" class="cr" data-pcrop="${i}" aria-label="কাটুন">✂ কাটুন</button>
            <button type="button" class="x" data-px="${i}" aria-label="বাদ দিন">×</button>
          </div></div>`).join('')}</div>
        <div class="stp-acts"><button type="button" class="stp-btn" id="prRotAll">⟳ সব ঘোরান</button><button type="button" class="stp-btn" id="prClear">🗑 সব বাদ দিন</button></div>
      </section>
      <section class="stp-card">
        <h2>📐 কাগজে কীভাবে বসবে</h2>
        <div class="prn-opt"><span>কাগজ (A4)</span><div class="stp-modes">${chip('data-pl', '0', !opts.land, '📄 খাড়া')}${chip('data-pl', '1', opts.land, '📃 আড়াআড়ি')}</div></div>
        <div class="prn-opt"><span>এক কাগজে কয়টা ছবি</span><div class="stp-modes">${NS.map(k => chip('data-pn', k, opts.n === k, toBn(k) + 'টা')).join('')}</div></div>
        <label class="stp-on"><input type="checkbox" id="prAuto" ${opts.auto ? 'checked' : ''}> ছবি নিজে থেকে ঘুরিয়ে বড় করে বসান</label>
        <label class="stp-on"><input type="checkbox" id="prCut" ${opts.cut ? 'checked' : ''}> কাটার দাগ দিন (ছবির মাঝে)</label>
        <h3 class="prn-h3">👁 দেখে নিন — ${toBn(ps.length)} পাতা</h3>
        <div class="prn-pages ${opts.land ? 'land' : ''}">${ps.map((_, i) => `<figure><canvas data-ppg="${i}"></canvas><figcaption>পাতা ${toBn(i + 1)}</figcaption></figure>`).join('')}</div>
        <div class="stp-acts">
          <button type="button" class="stp-btn main" id="prGo">🖨 প্রিন্ট করুন (${toBn(ps.length)} পাতা)</button>
          <button type="button" class="stp-btn" id="prSave">⬇ PDF সেভ করুন</button>
        </div>
        <p class="stp-hint">প্রিন্টের জায়গায় প্রিন্টার <b>HP Smart Tank 580</b> বেছে নিন। কাগজ A4।</p>
      </section>` : ''}`;
    bind();
    drawAll();
  }

  function drawAll(){
    root.querySelectorAll('[data-pth]').forEach(cv => {
      const it = items[+cv.dataset.pth]; if(!it) return;
      const r = ((it.rot % 360) + 360) % 360, side = r === 90 || r === 270, t = it.thumb;
      cv.width = side ? t.height : t.width; cv.height = side ? t.width : t.height;
      const ctx = cv.getContext('2d'); ctx.save(); ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate(r * Math.PI / 180); ctx.drawImage(t, -t.width / 2, -t.height / 2); ctx.restore();
    });
    const ps = pages();
    root.querySelectorAll('[data-ppg]').forEach(async cv => {
      const list = ps[+cv.dataset.ppg]; if(!list) return;
      const pxmm = Math.min(2, window.devicePixelRatio || 1) * (opts.land ? 1.1 : 0.9);
      const c = await drawPage(list, pxmm, it => it.thumb);
      cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0);
    });
  }

  function bind(){
    const $ = id => root.querySelector('#' + id);
    root.querySelectorAll('[data-padd]').forEach(inp => inp.onchange = () => { const fs = [...(inp.files || [])]; inp.value = ''; if(fs.length) addFiles(fs); });
    if($('prPdf')) $('prPdf').onchange = async e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if(f) await printPdfFile(f); };
    if($('prVl')) $('prVl').onclick = pickVouchers;
    root.querySelectorAll('[data-prot]').forEach(b => b.onclick = () => { const it = items[+b.dataset.prot]; it.rot = (it.rot + Number(b.dataset.d) + 360) % 360; render(); });
    root.querySelectorAll('[data-pcrop]').forEach(b => b.onclick = () => cropItem(+b.dataset.pcrop));
    root.querySelectorAll('[data-px]').forEach(b => b.onclick = () => { items.splice(+b.dataset.px, 1); render(); });
    if($('prRotAll')) $('prRotAll').onclick = () => { items.forEach(it => { it.rot = (it.rot + 90) % 360; }); render(); };
    if($('prClear')) $('prClear').onclick = () => {
      const b = $('prClear');
      if(items.length > 1 && !b.classList.contains('sure')){ b.classList.add('sure'); b.textContent = '⚠️ আবার চাপুন — সব বাদ যাবে'; setTimeout(() => { if(b.isConnected){ b.classList.remove('sure'); b.textContent = '🗑 সব বাদ দিন'; } }, 3500); return; }
      items = []; render();
    };
    root.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => { opts.land = b.dataset.pl === '1'; keepOpts(); render(); });
    root.querySelectorAll('[data-pn]').forEach(b => b.onclick = () => { opts.n = Number(b.dataset.pn); keepOpts(); render(); });
    if($('prAuto')) $('prAuto').onchange = e => { opts.auto = e.target.checked; keepOpts(); drawAll(); };
    if($('prCut')) $('prCut').onchange = e => { opts.cut = e.target.checked; keepOpts(); drawAll(); };
    if($('prGo')) $('prGo').onclick = () => run('print', $('prGo'));
    if($('prSave')) $('prSave').onclick = () => run('pdf', $('prSave'));
  }

  /* ---------- the real pages (200 dpi) → print / PDF ---------- */
  let running = false;
  async function buildPages(btn){
    const ps = pages(), out = [], pxmm = 200 / 25.4;
    for(let i = 0; i < ps.length; i++){
      if(btn) btn.textContent = `⏳ পাতা ${toBn(i + 1)} / ${toBn(ps.length)} তৈরি হচ্ছে…`;
      await tick(20);
      const c = await drawPage(ps[i], pxmm, it => decode(it.file));
      out.push(c.toDataURL('image/jpeg', 0.9));
    }
    return out;
  }
  const scriptP = {};
  const loadScript = src => scriptP[src] || (scriptP[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete scriptP[src]; rej(new Error('ইন্টারনেট লাগবে')); }; document.head.appendChild(s); }));
  async function toPdf(urls){
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    const [PW, PH] = paper(), o = opts.land ? 'landscape' : 'portrait', pdf = new window.jspdf.jsPDF({unit: 'mm', format: 'a4', orientation: o});
    urls.forEach((u, i) => { if(i) pdf.addPage('a4', o); pdf.addImage(u, 'JPEG', 0, 0, PW, PH); });
    return pdf.output('blob');
  }
  const fileName = () => { const d = new Date(); return `print-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.pdf`; };
  // the pages in the browser's print window (each picture is a whole A4 page; only they are printed — printImgs in index.html)
  function printInBrowser(urls){ window.__khataPrint.printImgs(urls, 'প্রিন্ট', {full: true, land: opts.land}); }
  async function savePdf(blob, name){
    if(window.KhataApp && window.KhataApp.saveFile){
      const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
      window.KhataApp.saveFile(b64, name, 'application/pdf'); return;
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    toast('<b>✓ PDF সেভ হয়েছে</b><span>' + esc(name) + '</span>');
  }
  async function run(how, btn){
    if(running || !items.length) return;
    running = true;
    const label = btn.innerHTML; btn.disabled = true;
    try{
      const urls = await buildPages(btn);
      btn.textContent = '⏳ একটু অপেক্ষা…';
      if(how === 'pdf') await savePdf(await toPdf(urls), fileName());
      else if(window.KhataApp){   // Android app: the phone's print screen (1.5) — older app opens the PDF
        const P = window.__khataPrint;
        if(P) await P.appPrint(await toPdf(urls), fileName()); else await savePdf(await toPdf(urls), fileName());
      } else printInBrowser(urls);
    }catch(e){ toast('<b>⚠️ ' + esc(e.message || e) + '</b>', 5000); }
    setTimeout(() => { running = false; if(btn.isConnected){ btn.innerHTML = label; btn.disabled = false; } }, 1500);
  }
  // 📄 a PDF file: printed as it is
  async function printPdfFile(f){
    if(window.KhataApp){ const P = window.__khataPrint; if(P) await P.appPrint(f, f.name || 'file.pdf'); return; }
    const url = URL.createObjectURL(f);
    if(window.matchMedia('(pointer: coarse)').matches){ window.open(url, '_blank'); toast('<b>PDF খোলা হয়েছে</b><span>সেখান থেকে প্রিন্ট করুন।</span>', 5000); return; }
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    fr.onload = () => setTimeout(() => { try{ fr.contentWindow.focus(); fr.contentWindow.print(); }catch(_){ window.open(url, '_blank'); } }, 300);
    fr.src = url; document.body.appendChild(fr);
    setTimeout(() => { fr.remove(); URL.revokeObjectURL(url); }, 120000);
  }

  /* ---------- ✂ কাটুন: keep only a part of one picture (drag the box / its corners; ✨ finds the paper by itself) ----------
     The cut is made from the full photo, turned the way it shows; the result becomes the picture (↺ brings the original back). */
  async function cropItem(i){
    const it = items[i]; if(!it) return;
    let im; try{ im = await decode(it.file); }catch(e){ toast('<b>⚠️ ছবিটা খোলা গেল না</b>'); return; }
    const r = ((it.rot % 360) + 360) % 360, side = r === 90 || r === 270;
    const W0 = side ? im.naturalHeight : im.naturalWidth, H0 = side ? im.naturalWidth : im.naturalHeight;
    const turned = (c, k, ox, oy) => {   // the photo turned by r, scaled by k, moved by (ox, oy)
      const ctx = c.getContext('2d'); ctx.save(); ctx.translate(W0 * k / 2 - ox, H0 * k / 2 - oy); ctx.rotate(r * Math.PI / 180);
      ctx.drawImage(im, -im.naturalWidth * k / 2, -im.naturalHeight * k / 2, im.naturalWidth * k, im.naturalHeight * k); ctx.restore();
    };
    const kv = Math.min(1, 1400 / Math.max(W0, H0)), view = newCanvas(W0 * kv, H0 * kv); turned(view, kv, 0, 0);
    let rc = {x: 0.03, y: 0.03, w: 0.94, h: 0.94};
    const finder = window.__stampTools && window.__stampTools.findPaper;
    const p = __auPop(`<h3>✂ ছবি কাটুন <button class="x" data-close aria-label="বন্ধ">✕</button></h3>
      <p class="sub">সাদা বাক্সের কোণা টেনে যতটুকু রাখবেন ততটুকু বাছাই করুন — বাক্সের ভিতরে টেনে পুরো বাক্স সরান।</p>
      <div class="prn-crop"><canvas id="crCv"></canvas></div>
      <div class="stp-acts">${finder ? '<button type="button" class="stp-btn" id="crAuto">✨ কাগজ নিজে খুঁজুন</button>' : ''}<button type="button" class="stp-btn" id="crAll">⬜ পুরো ছবি</button>${it.orig ? '<button type="button" class="stp-btn" id="crBack">↺ আসল ছবি ফেরত</button>' : ''}</div>
      <div class="acts"><button type="button" data-close>বাতিল</button><button type="button" class="p" id="crOk">✓ কাটুন</button></div>`);
    p.el.classList.add('prn-pop');
    const cv = p.el.querySelector('#crCv'), ctx = cv.getContext('2d');
    const box = p.el.querySelector('.prn-crop'), maxW = Math.max(200, box.clientWidth - 4), maxH = Math.max(220, window.innerHeight * 0.55);
    const ks = Math.min(maxW / view.width, maxH / view.height, 1); cv.width = Math.round(view.width * ks); cv.height = Math.round(view.height * ks);
    const draw = () => {
      ctx.drawImage(view, 0, 0, cv.width, cv.height);
      const x = rc.x * cv.width, y = rc.y * cv.height, w = rc.w * cv.width, h = rc.h * cv.height;
      ctx.fillStyle = 'rgba(15,23,42,.55)'; ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height); ctx.rect(x + w, y, -w, h); ctx.fill('evenodd');
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1;
      for(const t of [1 / 3, 2 / 3]){ ctx.beginPath(); ctx.moveTo(x + w * t, y); ctx.lineTo(x + w * t, y + h); ctx.moveTo(x, y + h * t); ctx.lineTo(x + w, y + h * t); ctx.stroke(); }
      ctx.setLineDash([]);
      [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].forEach(([a, b]) => { ctx.beginPath(); ctx.arc(a, b, 10, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#1F4AA8'; ctx.stroke(); });
    };
    draw();
    const pos = e => { const b = cv.getBoundingClientRect(); return {x: (e.clientX - b.left) / b.width, y: (e.clientY - b.top) / b.height, px: b.width, py: b.height}; };
    let drag = null;
    cv.onpointerdown = e => {
      const q = pos(e), cs = [[rc.x, rc.y], [rc.x + rc.w, rc.y], [rc.x + rc.w, rc.y + rc.h], [rc.x, rc.y + rc.h]];
      let best = -1, bd = 1e9; cs.forEach(([a, b], k) => { const d = Math.hypot((a - q.x) * q.px, (b - q.y) * q.py); if(d < bd){ bd = d; best = k; } });
      if(bd < 34) drag = {k: best};
      else if(q.x > rc.x && q.x < rc.x + rc.w && q.y > rc.y && q.y < rc.y + rc.h) drag = {move: true, dx: q.x - rc.x, dy: q.y - rc.y};
      else drag = {k: 2, from: {x: q.x, y: q.y}};   // outside the box: draw a new one from here
      if(drag.from){ rc = {x: q.x, y: q.y, w: 0.02, h: 0.02}; }
      cv.setPointerCapture(e.pointerId); e.preventDefault();
    };
    cv.onpointermove = e => {
      if(!drag) return;
      const q = pos(e), X = Math.min(1, Math.max(0, q.x)), Y = Math.min(1, Math.max(0, q.y)), MIN = 0.04;
      if(drag.move){ rc.x = Math.min(1 - rc.w, Math.max(0, X - drag.dx)); rc.y = Math.min(1 - rc.h, Math.max(0, Y - drag.dy)); }
      else {
        let x1 = rc.x, y1 = rc.y, x2 = rc.x + rc.w, y2 = rc.y + rc.h;
        if(drag.from){ x1 = Math.min(drag.from.x, X); x2 = Math.max(drag.from.x, X); y1 = Math.min(drag.from.y, Y); y2 = Math.max(drag.from.y, Y); }
        else {
          if(drag.k === 0 || drag.k === 3) x1 = Math.min(X, x2 - MIN); else x2 = Math.max(X, x1 + MIN);
          if(drag.k === 0 || drag.k === 1) y1 = Math.min(Y, y2 - MIN); else y2 = Math.max(Y, y1 + MIN);
        }
        rc = {x: x1, y: y1, w: Math.max(MIN, x2 - x1), h: Math.max(MIN, y2 - y1)};
      }
      draw();
    };
    cv.onpointerup = cv.onpointercancel = () => { drag = null; };
    const $p = id => p.el.querySelector('#' + id);
    if($p('crAuto')) $p('crAuto').onclick = () => {
      try{
        const q = finder(view), xs = q.map(t => t.x / view.width), ys = q.map(t => t.y / view.height);
        const x1 = Math.max(0, Math.min(...xs)), y1 = Math.max(0, Math.min(...ys)), x2 = Math.min(1, Math.max(...xs)), y2 = Math.min(1, Math.max(...ys));
        if(x2 - x1 > 0.05 && y2 - y1 > 0.05) rc = {x: x1, y: y1, w: x2 - x1, h: y2 - y1};
        draw();
      }catch(_){ toast('<b>কাগজ খুঁজে পাওয়া গেল না</b><span>কোণা টেনে নিজে ঠিক করুন।</span>'); }
    };
    $p('crAll').onclick = () => { rc = {x: 0, y: 0, w: 1, h: 1}; draw(); };
    if($p('crBack')) $p('crBack').onclick = async () => {
      Object.assign(it, {file: it.orig.file, rot: it.orig.rot}, await looks(it.orig.file)); delete it.orig; p.close(); render();
    };
    $p('crOk').onclick = async () => {
      const b = $p('crOk'); b.disabled = true; b.textContent = '⏳ কাটা হচ্ছে…';
      try{
        const sx = Math.round(rc.x * W0), sy = Math.round(rc.y * H0), cw = Math.max(8, Math.round(rc.w * W0)), ch = Math.max(8, Math.round(rc.h * H0));
        const c = newCanvas(cw, ch), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch);
        turned(c, 1, sx, sy);
        const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.92));
        if(!it.orig) it.orig = {file: it.file, rot: it.rot};
        Object.assign(it, {file: blob, rot: 0}, await looks(blob));
        p.close(); render();
      }catch(e){ b.disabled = false; b.textContent = '✓ কাটুন'; toast('<b>⚠️ কাটা গেল না</b><span>' + esc(e.message || e) + '</span>'); }
    };
  }

  /* ---------- 📁 from the voucher list (kept on this phone by the স্ট্যাম্প page) ---------- */
  async function pickVouchers(){
    const VL = window.__stampTools && window.__stampTools.VL; if(!VL) return;
    let list = [];
    try{ list = await VL.all(); }catch(_){}
    if(!list.length){ toast('<b>ভাউচার লিস্ট খালি</b><span>স্ট্যাম্প পাতায় ভাউচার বানালে এখানে পাবেন।</span>', 5000); return; }
    const sel = new Set();
    const p = __auPop(`<h3>📁 ভাউচার বাছাই করুন <button class="x" data-close aria-label="বন্ধ">✕</button></h3>
      <p class="sub">যেগুলো প্রিন্ট করবেন সেগুলোতে চাপ দিন।</p>
      <div class="prn-vl">${list.map(m => `<button type="button" class="prn-v" data-vid="${esc(m.id)}" aria-pressed="false">
        <img src="${m.thumb}" alt=""><span>${esc(bnLongDate(m.date).split(',')[1] || m.date)}${m.note ? ' · ' + esc(m.note) : ''}</span></button>`).join('')}</div>
      <div class="acts"><button type="button" id="prVall">সব বাছুন</button><button type="button" class="p" id="prVadd" disabled>✓ যোগ করুন</button></div>`);
    p.el.classList.add('prn-pop');
    const add = p.el.querySelector('#prVadd'), upd = () => { add.disabled = !sel.size; add.textContent = sel.size ? `✓ ${toBn(sel.size)}টা যোগ করুন` : '✓ যোগ করুন'; };
    p.el.querySelectorAll('[data-vid]').forEach(b => b.onclick = () => { const id = b.dataset.vid; if(sel.has(id)) sel.delete(id); else sel.add(id); b.setAttribute('aria-pressed', sel.has(id)); upd(); });
    p.el.querySelector('#prVall').onclick = () => { list.forEach(m => sel.add(m.id)); p.el.querySelectorAll('[data-vid]').forEach(b => b.setAttribute('aria-pressed', 'true')); upd(); };
    add.onclick = async () => {
      const ids = list.filter(m => sel.has(m.id)); p.close();
      const blobs = [];
      for(const m of ids){ try{ const b = await VL.img(m.id); if(b) blobs.push(Object.assign(b, {name: m.name})); }catch(_){} }
      if(blobs.length) addFiles(blobs);
    };
  }

  window.addEventListener('resize', () => { if(!root.hidden && items.length) drawAll(); });
  window.__printRender = render;
})();
