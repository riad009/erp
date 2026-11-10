import type { Db } from 'mongodb';
import nodemailer from 'nodemailer';
import { getDoc, listDocs } from './store';
import { bnDate, logAct } from './activity';
import type { User } from './auth';

// Nightly email: the whole day, category by category (body) + that day's records as one JSON file.

type Data = Record<string, unknown>;
export type MailCfg = { enabled: boolean; to: string[]; from: string; appPass: string; lastSent?: string };
const CFG_ID = 'email_config';

export async function getCfg(db: Db): Promise<MailCfg> {
  const r = await db.collection<Data & { _id: string }>('settings').findOne({ _id: CFG_ID });
  return { enabled: !!r?.enabled, to: (r?.to as string[]) || [], from: String(r?.from || ''), appPass: String(r?.appPass || ''), lastSent: r?.lastSent as string | undefined };
}
export async function saveCfg(db: Db, c: Partial<MailCfg>) {
  await db.collection<Data & { _id: string }>('settings').updateOne({ _id: CFG_ID }, { $set: c }, { upsert: true });
}

// today in Dhaka (UTC+6); `minus` minutes earlier so a run a little after midnight still counts the day before
export function dhakaDate(minus = 0) {
  return new Date(Date.now() + 6 * 3600e3 - minus * 60e3).toISOString().slice(0, 10);
}

export async function fullBackup(db: Db) {
  const data = async (p: string) => (await getDoc(db, p)).data;
  const list = async (c: string) => (await listDocs(db, c)).map(d => d.data);
  const khoroch: Data = {};
  for (const k of await list('khoroch')) if (k.date) khoroch[String(k.date)] = k.items || [];
  return {
    exported: new Date().toISOString(),
    days: await list('days'), ledgers: await list('ledgers'), companies: await list('companies'), khoroch,
    cats: ((await data('settings/cats'))?.list) || [], rates: (await data('settings/rates')) || {},
    sabek: ((await data('amdani/sabek'))?.map) || {}, labour: Number((await data('settings/labour'))?.rate) || 0,
  };
}

const BD = '০১২৩৪৫৬৭৮৯';
const bn = (v: unknown) => String(v ?? '').replace(/[0-9]/g, d => BD[+d]);
const tk = (n: unknown) => '৳' + bn(Math.round(Number(n) || 0).toLocaleString('en-IN'));
const kgs = (n: unknown) => bn((Number(n) || 0).toLocaleString('en-IN')) + ' কেজি';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// everything that happened on `date`, worked out exactly like the app's own pages
// (দৈনিক: সাবেক + নিট = হাতে নগদ · স্টক: itemStats · খতিয়ান / কোম্পানি balances)
type Full = Awaited<ReturnType<typeof fullBackup>>;
const N = (v: unknown) => Number(v) || 0;
const TYPE: Record<string, string> = { soft: 'সফট', hard: 'হার্ড' };

export async function dayRecord(_db: Db, date: string, full: Full) {
  const D = date, ledgers = full.ledgers as Data[], companies = full.companies as Data[], days = full.days as Data[];
  const kh = full.khoroch as Record<string, Data[]>, sabekMap = full.sabek as Record<string, number>;

  // sizes: id → মার্কা + সাইজ
  const sizes = new Map<string, { marka: string; size: string; open: number }>();
  for (const m of full.cats as Data[]) for (const it of (m.items as Data[]) || [])
    sizes.set(String(it.id), { marka: String(m.name), size: `${it.h ?? ''} × ${it.w ?? ''}`, open: N(it.open) });
  const sizeOf = (id: unknown) => sizes.get(String(id)) || { marka: '', size: '', open: 0 };
  const coById = new Map(companies.map(c => [String(c.id), c]));

  // 💵 নগদ: সাবেক জমা (hand-typed, else carried from the days before) + আজ জমা − আজ খরচ = হাতে নগদ
  const jomaOn = (d: string) => ledgers.reduce((s, p) => s + ((p.entries as Data[]) || []).filter(e => e.date === d && N(e.debit) > 0).reduce((t, e) => t + N(e.debit), 0), 0);
  const khOn = (d: string) => (kh[d] || []).reduce((t, x) => t + N(x.amt), 0);
  const dset = new Set<string>([...Object.keys(sabekMap), ...Object.keys(kh)]);
  for (const p of ledgers) for (const e of (p.entries as Data[]) || []) if (N(e.debit) > 0 && e.date) dset.add(String(e.date));
  let carry = 0;
  for (const d of [...dset].filter(d => d < D).sort()) { const v = sabekMap[d] != null ? N(sabekMap[d]) : carry; carry = v + jomaOn(d) - khOn(d); }
  const sabekManual = sabekMap[D] != null, sabek = sabekManual ? N(sabekMap[D]) : carry;
  const jomaToday = jomaOn(D), khToday = khOn(D);
  const cash = { sabek, sabekManual, joma: jomaToday, khoroch: khToday, net: jomaToday - khToday, hand: sabek + jomaToday - khToday };

  // 🧾 মেমো + 💰 জমা + 📒 পার্টির বাকি
  const memos: Data[] = [], joma: Data[] = [], parties: Data[] = [];
  let totalDue = 0;
  for (const p of ledgers) {
    const es = (p.entries as Data[]) || [];
    const upto = (pred: (d: string) => boolean) => N(p.opening) + es.filter(e => pred(String(e.date))).reduce((t, e) => t + N(e.credit) - N(e.debit), 0);
    const before = upto(d => d < D), after = upto(d => d <= D);
    totalDue += after;
    const today = es.filter(e => e.date === D);
    for (const e of today) {
      if (N(e.credit) > 0) memos.push({
        memoNo: e.memoNo ?? null, paperNo: e.paperNo ?? null, party: p.name, partyId: p.id, kg: N(e.kg),
        lines: ((e.items as Data[]) || []).map(x => ({ type: TYPE[String(x.t)] || String(x.t || 'মাল'), kg: N(x.kg), rate: N(x.rate), taka: Math.round(N(x.kg) * N(x.rate)) })),
        sizes: ((e.picks as Data[]) || []).map(pk => ({ ...sizeOf(pk.item), kg: N(pk.kg), rate: N(pk.rate), buyRate: N(pk.cost) })),
        labour: N(e.labour), total: N(e.credit), advance: e.memoAdv ?? null, due: e.memoDue ?? null, desc: e.desc || '',
      });
      else if (N(e.debit) > 0) joma.push({ party: p.name, partyId: p.id, taka: N(e.debit), via: e.via || '', ref: e.ref || '', desc: e.desc || '' });
    }
    if (today.length) parties.push({ party: p.name, before, sale: today.reduce((t, e) => t + N(e.credit), 0), joma: today.reduce((t, e) => t + N(e.debit), 0), after });
  }
  memos.sort((a, b) => N(a.memoNo) - N(b.memoNo));

  // 💸 খরচ
  const khoroch = (kh[D] || []).map(x => ({ desc: x.desc || '', taka: N(x.amt), misc: !!x.misc }));

  // 🚚 মাল এসেছে (with company, দর, টাকা from the linked চালান) · 📦 মাল গেছে
  const day = days.find(d => d.id === D) || null;
  const stockIn = (((day?.entries as Data[]) || [])).map(e => {
    const co = coById.get(String(e.co)), ce = co ? ((co.entries as Data[]) || []).find(x => x.id === e.ce) : null;
    const s = sizeOf(e.item), rate = ce ? N(ce.rate) : 0;
    return { car: e.car || '', company: co ? co.name : '', challan: e.vno || '', marka: s.marka, size: s.size, coil: e.coil || '', kg: N(e.kg), rate, taka: ce ? N(ce.amount) || Math.round(N(e.kg) * rate) : 0 };
  });
  const stockOut: Data[] = [];
  for (const o of ((day?.outs as Data[]) || [])) stockOut.push({ ...sizeOf(o.item), kg: N(o.kg), how: 'হাতে বের' });
  for (const p of ledgers) for (const e of (p.entries as Data[]) || []) {
    if (e.status !== 'confirmed' || (e.confirmedOn || e.date) !== D) continue;
    for (const pk of (e.picks as Data[]) || []) stockOut.push({ ...sizeOf(pk.item), kg: N(pk.kg), how: `মেমো ${e.memoNo ?? ''} · ${p.name}` });
  }

  // 📊 স্টক (same walk as the app: never below ০, a size only gives what it has)
  const ev = new Map<string, Map<string, { in: number; out: number }>>();
  const add = (id: string, d: string, k: 'in' | 'out', v: number) => {
    if (!sizes.has(id)) return;
    const m = ev.get(id) || new Map(); ev.set(id, m); const x = m.get(d) || { in: 0, out: 0 }; m.set(d, x); x[k] += v;
  };
  for (const d of days) { if (String(d.id) > D) continue;
    for (const e of (d.entries as Data[]) || []) add(String(e.item), String(d.id), 'in', N(e.kg));
    for (const o of (d.outs as Data[]) || []) add(String(o.item), String(d.id), 'out', N(o.kg)); }
  for (const p of ledgers) for (const e of (p.entries as Data[]) || []) {
    const on = String(e.confirmedOn || e.date);
    if (e.status !== 'confirmed' || on > D) continue;
    for (const pk of (e.picks as Data[]) || []) add(String(pk.item), on, 'out', N(pk.kg));
  }
  const stock = { before: 0, in: 0, out: 0, end: 0, byMarka: [] as Data[], sizes: [] as Data[] };
  const byMarka = new Map<string, number>();
  for (const [id, s] of sizes) {
    let bal = s.open, now = 0, sold = 0;
    for (const [d, v] of [...(ev.get(id) || new Map())].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (d < D) bal = Math.max(0, bal + v.in - v.out);
      else { now = v.in; sold = Math.min(v.out, Math.max(0, bal + v.in)); }
    }
    const end = bal + now - sold;
    stock.before += bal; stock.in += now; stock.out += sold; stock.end += end;
    byMarka.set(s.marka, (byMarka.get(s.marka) || 0) + end);
    stock.sizes.push({ marka: s.marka, size: s.size, kg: end });
  }
  stock.byMarka = [...byMarka].map(([marka, kg]) => ({ marka, kg }));

  // 🏭 কোম্পানি: today's চালান / রসিদ and অবশিষ্ট (আগের জের + জমা − খরচ) at the end of the day
  const companyRows: Data[] = [];
  for (const c of companies) {
    const es = (c.entries as Data[]) || [];
    const obo = (pred: (d: string) => boolean) => N(c.opening) + es.filter(e => pred(String(e.date))).reduce((t, e) => t + (e.type === 'rec' ? N(e.amount) : -N(e.amount)), 0);
    const today = es.filter(e => e.date === D);
    if (!today.length) continue;
    companyRows.push({
      company: c.name,
      challans: today.filter(e => e.type === 'inv').map(e => ({ challan: e.vno || '', car: e.car || '', item: e.item || '', size: e.size ? `${e.size} × ${e.len || ''}` : '', kg: N(e.kg), rate: N(e.rate), taka: N(e.amount) })),
      paid: today.filter(e => e.type === 'rec').map(e => ({ receipt: e.vno || '', taka: N(e.amount), note: e.note || '' })),
      before: obo(d => d < D), after: obo(d => d <= D),
    });
  }

  return {
    shop: 'কাজী রোমান এন্ড ব্রাদার্স', date: D, cash, memos, joma, khoroch, stockIn, stockOut, stock, companies: companyRows, parties, totalDue,
    // the day's records exactly as saved (for putting things back if ever needed)
    raw: {
      stockDay: day, khoroch: kh[D] || [], sabek: sabekMap[D] ?? null,
      ledgerEntries: ledgers.flatMap(p => ((p.entries as Data[]) || []).filter(e => e.date === D).map(e => ({ partyId: p.id, party: p.name, ...e }))),
      companyEntries: companies.flatMap(c => ((c.entries as Data[]) || []).filter(e => e.date === D).map(e => ({ companyId: c.id, company: c.name, ...e }))),
    },
  };
}

function htmlSummary(r: Awaited<ReturnType<typeof dayRecord>>) {
  const S = (a: Data[], k: string) => a.reduce((s, x) => s + N(x[k]), 0);
  const signed = (n: number) => (n < 0 ? '−' : '') + tk(Math.abs(n));
  const th = 'text-align:left;border:1px solid #c9d2e3;padding:6px;background:#eef2f9;color:#1B2347';
  const td = 'border:1px solid #c9d2e3;padding:6px;vertical-align:top';
  const table = (title: string, head: string[], rows: string[][], foot?: string[]) =>
    `<h3 style="margin:20px 0 6px;font-size:15.5px">${title}</h3>` + (!rows.length ? '<p style="margin:0;color:#667">— আজ কিছু নেই —</p>' :
    `<table style="border-collapse:collapse;width:100%;font-size:13px">` +
    `<tr>${head.map(h => `<th style="${th}">${h}</th>`).join('')}</tr>` +
    rows.map(x => `<tr>${x.map(c => `<td style="${td}">${c}</td>`).join('')}</tr>`).join('') +
    (foot ? `<tr>${foot.map(c => `<td style="${td};font-weight:700;background:#f6f8fc">${c}</td>`).join('')}</tr>` : '') + '</table>');
  const box = (k: string, v: string, note = '') => `<tr><td style="padding:4px 16px 4px 0">${k}</td><td style="padding:4px 0"><b>${v}</b>${note ? ` <span style="color:#667;font-size:12px">${note}</span>` : ''}</td></tr>`;
  const cars = new Set(r.stockIn.map(e => e.car).filter(Boolean));

  return `<div style="font-family:'Noto Sans Bengali',Arial,sans-serif;color:#1B2347;max-width:720px">
<h2 style="margin:0 0 4px">কাজী রোমান এন্ড ব্রাদার্স — দিনের হিসাব</h2>
<p style="margin:0 0 14px;color:#556">${bnDate(r.date)}</p>

<h3 style="margin:10px 0 6px;font-size:15.5px">💵 নগদ হিসাব</h3>
<table style="border-collapse:collapse;font-size:14px">
${box('সাবেক জমা', signed(r.cash.sabek), r.cash.sabekManual ? '(হাতে লেখা)' : '(আগের দিনের হাতে নগদ)')}
${box('＋ আজকের জমা (আমদানি)', tk(r.cash.joma))}
${box('− আজকের খরচ', tk(r.cash.khoroch))}
${box('নিট (জমা − খরচ)', signed(r.cash.net))}
${box('= হাতে নগদ (ক্যাশ)', signed(r.cash.hand))}
</table>

<h3 style="margin:16px 0 6px;font-size:15.5px">📋 এক নজরে</h3>
<table style="border-collapse:collapse;font-size:14px">
${box('🧾 মেমো (বিক্রি)', `${bn(r.memos.length)}টা · ${kgs(S(r.memos, 'kg'))} · ${tk(S(r.memos, 'total'))}`)}
${box('💰 জমা', `${bn(r.joma.length)}টা · ${tk(S(r.joma, 'taka'))}`)}
${box('💸 খরচ', `${bn(r.khoroch.length)}টা · ${tk(S(r.khoroch, 'taka'))}`)}
${box('🚚 মাল এসেছে', `${bn(cars.size)} গাড়ি · ${kgs(S(r.stockIn, 'kg'))} · ${tk(S(r.stockIn, 'taka'))}`)}
${box('📦 মাল গেছে', kgs(S(r.stockOut, 'kg')))}
${box('📊 দিনের শেষে মোট স্টক', kgs(r.stock.end))}
${box('📒 সব পার্টির মোট বাকি', signed(r.totalDue))}
</table>

${table('🧾 মেমো (মাল বিক্রি)', ['নং', 'পার্টি', 'মাল · কেজি × দর', 'লেবার', 'মোট টাকা'],
  r.memos.map(m => [bn(m.memoNo ?? '') + (m.paperNo ? `<br><small>📄${bn(m.paperNo)}</small>` : ''), esc(m.party),
    (m.lines as Data[]).map(l => `${esc(l.type)} ${kgs(l.kg)}${N(l.rate) ? ' × ' + bn(l.rate) + ' = ' + tk(l.taka) : ''}`).join('<br>') +
    ((m.sizes as Data[]).length ? `<br><small style="color:#667">${(m.sizes as Data[]).map(z => `${esc(z.marka)} ${bn(z.size)}: ${kgs(z.kg)}`).join(' · ')}</small>` : ''),
    m.labour ? tk(m.labour) : '—', tk(m.total)]),
  ['', 'মোট', kgs(S(r.memos, 'kg')), tk(S(r.memos, 'labour')), tk(S(r.memos, 'total'))])}

${table('💰 জমা (টাকা পেয়েছি)', ['পার্টি', 'কার মাধ্যমে', 'রেফারেন্স', 'টাকা'],
  r.joma.map(j => [esc(j.party), esc(j.via), esc(j.ref), tk(j.taka)]), ['মোট', '', '', tk(S(r.joma, 'taka'))])}

${table('💸 খরচ', ['বিবরণ', 'টাকা'], r.khoroch.map(k => [esc(k.desc) + (k.misc ? ' <small style="color:#667">(খুচরা)</small>' : ''), tk(k.taka)]), ['মোট', tk(S(r.khoroch, 'taka'))])}

${table('🚚 মাল এসেছে (কোন কোম্পানি থেকে, কত দরে)', ['গাড়ি', 'কোম্পানি', 'চালান', 'মাল · সাইজ', 'কেজি', 'দর', 'টাকা'],
  r.stockIn.map(e => [bn(e.car), esc(e.company || '—'), bn(e.challan), `${esc(e.marka)}<br>${bn(e.size)}${e.coil ? ` <small>কয়েল ${bn(e.coil)}</small>` : ''}`, kgs(e.kg), e.rate ? bn(e.rate) : 'দর নেই', e.taka ? tk(e.taka) : '—']),
  ['মোট', `${bn(cars.size)} গাড়ি`, '', '', kgs(S(r.stockIn, 'kg')), '', tk(S(r.stockIn, 'taka'))])}

${table('📦 মাল গেছে', ['মাল · সাইজ', 'কোথায় গেছে', 'কেজি'], r.stockOut.map(o => [`${esc(o.marka)} ${bn(o.size)}`, esc(o.how), kgs(o.kg)]), ['মোট', '', kgs(S(r.stockOut, 'kg'))])}

<h3 style="margin:20px 0 6px;font-size:15.5px">📊 স্টক</h3>
<table style="border-collapse:collapse;font-size:14px">
${box('আগের মোট', kgs(r.stock.before))}${box('＋ আজ এসেছে', kgs(r.stock.in))}${box('− আজ গেছে', kgs(r.stock.out))}${box('= মোট স্টক', kgs(r.stock.end))}
</table>
${table('মার্কা অনুযায়ী স্টক (দিনের শেষে)', ['মার্কা', 'কেজি'], r.stock.byMarka.map(m => [esc(m.marka), kgs(m.kg)]))}

${table('🏭 কোম্পানি (আজকের চালান ও টাকা দেওয়া)', ['কোম্পানি', 'আজ মাল এসেছে (খরচ)', 'আজ টাকা দিয়েছি (জমা)', 'আগের অবশিষ্ট', 'এখন অবশিষ্ট'],
  r.companies.map(c => [esc(c.company),
    (c.challans as Data[]).map(x => `চালান ${bn(x.challan)}: ${kgs(x.kg)}${x.rate ? ' × ' + bn(x.rate) : ''} = ${tk(x.taka)}`).join('<br>') || '—',
    (c.paid as Data[]).map(x => `${tk(x.taka)}${x.receipt ? ' (রসিদ ' + bn(x.receipt) + ')' : ''}`).join('<br>') || '—',
    signed(N(c.before)), signed(N(c.after))]))}

${table('📒 আজ যেসব পার্টির হিসাব বদলেছে', ['পার্টি', 'আগের বাকি', 'আজ মাল', 'আজ জমা', 'এখন বাকি'],
  r.parties.map(p => [esc(p.party), signed(N(p.before)), p.sale ? tk(p.sale) : '—', p.joma ? tk(p.joma) : '—', signed(N(p.after))]),
  ['সব পার্টির মোট বাকি', '', '', '', signed(r.totalDue)])}

<p style="margin-top:20px;font-size:12.5px;color:#556">সংযুক্ত ফাইল: <b>এই দিনের পুরো হিসাব (JSON)</b> — উপরের সব হিসাব আর এই দিনের প্রতিটা রেকর্ড যেমন সেভ আছে।</p>
</div>`;
}

// send the nightly email. `force` = the admin's "এখন পাঠান" (also sends when already sent today)
export async function sendDaily(db: Db, opts: { force?: boolean; who?: User | null; date?: string } = {}) {
  const cfg = await getCfg(db);
  if (!opts.force && !cfg.enabled) return { ok: false, skipped: 'বন্ধ আছে' };
  if (!cfg.to.length) return { ok: false, error: 'কোন ইমেইলে যাবে তা দেওয়া নেই' };
  const from = process.env.SMTP_USER || cfg.from, pass = process.env.SMTP_PASS || cfg.appPass;
  if (!from || !pass) return { ok: false, error: 'পাঠানোর Gmail আর অ্যাপ পাসওয়ার্ড দেওয়া নেই' };
  const date = opts.date || dhakaDate(60);
  if (!opts.force && cfg.lastSent === date) return { ok: false, skipped: 'আজ আগেই পাঠানো হয়েছে' };

  const full = await fullBackup(db), rec = await dayRecord(db, date, full);
  const t = nodemailer.createTransport(process.env.SMTP_HOST
    ? { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: Number(process.env.SMTP_PORT || 465) === 465, auth: { user: from, pass } }
    : { service: 'gmail', auth: { user: from, pass } });
  try {
    await t.sendMail({
      from: `"হিসাব খাতা" <${from}>`, to: cfg.to.join(', '),
      subject: `হিসাব খাতা — ${bnDate(date)} দিনের হিসাব`,
      html: htmlSummary(rec),
      // owner: only this day's file (the full backup is in 👑 অ্যাডমিন → ⬇ ব্যাকআপ)
      attachments: [{ filename: `khata-${date}.json`, content: JSON.stringify(rec, null, 2), contentType: 'application/json' }],
    });
  } catch (e) {
    const msg = (e as Error).message;
    await logAct(db, opts.who || null, { kind: 'email', action: 'ইমেইল যায়নি', label: '✉️ দিনের ইমেইল পাঠানো যায়নি', lines: [msg.slice(0, 160)] });
    return { ok: false, error: msg };
  }
  await saveCfg(db, { lastSent: date });
  await logAct(db, opts.who || null, { kind: 'email', action: 'ইমেইল', label: '✉️ দিনের হিসাব ইমেইল পাঠানো হয়েছে', lines: [bnDate(date) + ' → ' + cfg.to.join(', ')] });
  return { ok: true, date, to: cfg.to };
}
