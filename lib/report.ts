import type { Db } from 'mongodb';
import nodemailer from 'nodemailer';
import { getDoc, listDocs } from './store';
import { bnDate, logAct, type Act } from './activity';
import type { User } from './auth';

// Nightly email: the day's record + the full database (same format as backup.json → /import.html).

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

// everything that happened on `date`
export async function dayRecord(db: Db, date: string, full: Awaited<ReturnType<typeof fullBackup>>) {
  const memos: Data[] = [], joma: Data[] = [];
  for (const p of full.ledgers) for (const e of (p.entries as Data[]) || []) {
    if (e.date !== date) continue;
    const row = { party: p.name, ...e };
    if (Number(e.credit) > 0) memos.push(row); else if (Number(e.debit) > 0) joma.push(row);
  }
  const challans: Data[] = [];
  for (const c of full.companies) for (const e of (c.entries as Data[]) || []) if (e.date === date) challans.push({ company: c.name, ...e });
  const start = new Date(date + 'T00:00:00+06:00').getTime();
  const activity = (await db.collection<Act>('activity').find({ ts: { $gte: start, $lt: start + 864e5 } }, { projection: { before: 0 } }).sort({ ts: 1 }).toArray())
    .map(a => ({ time: new Date(a.ts + 6 * 3600e3).toISOString().slice(11, 16), user: a.uname, action: a.action, about: a.label, details: a.lines, undone: !!a.undone }));
  return {
    date, stock: full.days.find(d => d.id === date) || null, memos, joma, companyChallans: challans,
    khoroch: full.khoroch[date] || [], sabek: (full.sabek as Data)[date] ?? null, activity,
  };
}

function htmlSummary(rec: Awaited<ReturnType<typeof dayRecord>>) {
  const sum = (a: Data[], k: string) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const stockIn = ((rec.stock?.entries as Data[]) || []), cars = new Set(stockIn.map(e => e.car).filter(Boolean));
  const kh = rec.khoroch as Data[];
  const table = (title: string, head: string[], rows: string[][]) => !rows.length ? '' :
    `<h3 style="margin:18px 0 6px;font-size:15px">${title}</h3><table style="border-collapse:collapse;width:100%;font-size:13px">` +
    `<tr>${head.map(h => `<th style="text-align:left;border:1px solid #ccd;padding:5px;background:#eef2f9">${h}</th>`).join('')}</tr>` +
    rows.map(r => `<tr>${r.map(c => `<td style="border:1px solid #ccd;padding:5px">${c}</td>`).join('')}</tr>`).join('') + '</table>';
  return `<div style="font-family:'Noto Sans Bengali',Arial,sans-serif;color:#1B2347;max-width:680px">
<h2 style="margin:0 0 4px">কাজী রোমান এন্ড ব্রাদার্স — দিনের হিসাব</h2>
<p style="margin:0 0 12px;color:#556">${bnDate(rec.date)}</p>
<table style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:3px 14px 3px 0">🧾 মেমো</td><td><b>${bn(rec.memos.length)}টা · ${tk(sum(rec.memos, 'credit'))}</b></td></tr>
<tr><td style="padding:3px 14px 3px 0">💰 জমা</td><td><b>${bn(rec.joma.length)}টা · ${tk(sum(rec.joma, 'debit'))}</b></td></tr>
<tr><td style="padding:3px 14px 3px 0">💸 খরচ</td><td><b>${tk(sum(kh, 'amt'))}</b></td></tr>
<tr><td style="padding:3px 14px 3px 0">🚚 মাল এসেছে</td><td><b>${bn(cars.size)} গাড়ি · ${kgs(sum(stockIn, 'kg'))}</b></td></tr>
<tr><td style="padding:3px 14px 3px 0">📝 কাজ (অ্যাক্টিভিটি)</td><td><b>${bn(rec.activity.length)}টা</b></td></tr>
</table>
${table('🧾 মেমো', ['নং', 'পার্টি', 'কেজি', 'টাকা'], rec.memos.map(m => [bn(m.memoNo || ''), esc(m.party), kgs(m.kg), tk(m.credit)]))}
${table('💰 জমা', ['পার্টি', 'কার মাধ্যমে', 'টাকা'], rec.joma.map(m => [esc(m.party), esc(m.via || ''), tk(m.debit)]))}
${table('💸 খরচ', ['বিবরণ', 'টাকা'], kh.map(k => [esc(k.desc), tk(k.amt)]))}
${table('🚚 মাল এসেছে', ['গাড়ি', 'চালান', 'কেজি'], stockIn.map(e => [bn(e.car || ''), bn(e.vno || ''), kgs(e.kg)]))}
<p style="margin-top:18px;font-size:12.5px;color:#556">সংযুক্ত ফাইল: <b>আজকের হিসাব</b> (এই দিনের সব রেকর্ড) আর <b>পুরো ডেটাবেস</b> (সব দিনের রেকর্ড — দরকার হলে /import.html দিয়ে ফেরত বসানো যায়)।</p>
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
      subject: `হিসাব খাতা — ${bnDate(date)} (দিনের হিসাব + পুরো ডেটাবেস)`,
      html: htmlSummary(rec),
      attachments: [
        { filename: `khata-${date}-today.json`, content: JSON.stringify(rec, null, 2), contentType: 'application/json' },
        { filename: `khata-${date}-full-database.json`, content: JSON.stringify(full, null, 2), contentType: 'application/json' },
      ],
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
