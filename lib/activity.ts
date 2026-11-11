import type { Db } from 'mongodb';
import { randomBytes } from 'node:crypto';
import type { User } from './auth';

// Activity list (`activity` collection): who did what and when.
// Data changes keep the record as it was before (`before`) so they can be undone.

type Data = Record<string, unknown>;
export type Act = {
  _id: string; ts: number; uid: string; uname: string;
  kind: 'data' | 'login' | 'logout' | 'user' | 'email' | 'undo' | 'import' | 'wipe';
  action: string;            // নতুন | পরিবর্তন | মুছে ফেলা | …
  label: string;             // what it was about: party name, স্টক দিন …
  lines: string[];           // short details (Bangla)
  path?: string; before?: Data | null; existed?: boolean;
  cid?: string;              // which open page (browser tab) made the change — live sync skips its own
  undone?: { ts: number; uname: string; by?: string; cascade?: boolean };   // later ফেরানো (cascade = went with an earlier one)
  undoOf?: { id: string; ts: number; uname: string; label: string };          // on a ফেরানো line: the line it reverted
  snapshot?: Record<string, unknown[]>; restorable?: boolean;                // on a 🗑 সব মুছে ফেলা line
  effects?: string[]; links?: Link[];                                         // what else this change did in the app (owner's wish)
  after?: Data | null;                                                        // the record right after this save (for মুছুন / ফেরান)
  state?: '' | 'off' | 'on'; tts?: number;                                    // মুছে ফেলা (red) / আবার ফেরানো (green), when it last flipped
  toggles?: { ts: number; uname: string; to: 'off' | 'on' }[]; redoDoc?: Data | null;
};

const BD = '০১২৩৪৫৬৭৮৯';
const bn = (v: unknown) => String(v ?? '').replace(/[0-9]/g, d => BD[+d]);
const money = (n: unknown) => bn(Math.round(Number(n) || 0).toLocaleString('en-IN'));
const kg = (n: unknown) => bn((Number(n) || 0).toLocaleString('en-IN')) + ' কেজি';
const M = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
export const bnDate = (iso: string) => { const [y, m, d] = String(iso).split('-').map(Number); return m ? `${bn(d)} ${M[m - 1]} ${bn(y)}` : bn(iso); };

// one line about an entry inside a record
function entryText(col: string, e: Data): string {
  if (col === 'ledgers') {
    if (Number(e.credit) > 0) return `মেমো${e.memoNo ? ' নং ' + bn(e.memoNo) : ''} · ${e.date ? bnDate(String(e.date)) + ' · ' : ''}${e.kg ? kg(e.kg) + ' · ' : ''}৳${money(e.credit)}`;
    if (Number(e.debit) > 0) return `জমা ৳${money(e.debit)}${e.date ? ' · ' + bnDate(String(e.date)) : ''}${e.via ? ' · ' + e.via : ''}`;
    return String(e.desc || 'লাইন');
  }
  if (col === 'days') return `${e.car ? 'গাড়ি ' + bn(e.car) + ' · ' : ''}${kg(e.kg)}${e.vno ? ' · চালান ' + bn(e.vno) : ''}`;
  if (col === 'outs') return `${e.hand ? 'হাতে বের · ' : 'মাল গেছে · '}${kg(e.kg)}`;
  if (col === 'companies') return `${e.type === 'inv' ? 'চালান' : 'রসিদ'}${e.vno ? ' ' + bn(e.vno) : ''}${e.kg ? ' · ' + kg(e.kg) : ''}${Number(e.amount) ? ' · ৳' + money(e.amount) : ''}`;
  if (col === 'khoroch') return `${e.desc || 'খরচ'} · ৳${money(e.amt)}`;
  return String(e.name || e.desc || e.id || '');
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- effects: what one save also changed elsewhere (স্টক, খতিয়ানের বাকি, দৈনিকের নগদ, কোম্পানির অবশিষ্ট) + buttons to open those pages
export type Link = { t: 'party' | 'memo' | 'stock' | 'daily' | 'company'; id?: string; eid?: string; date?: string; label: string };
const N = (v: unknown) => Number(v) || 0;
const byId = (a: unknown) => new Map(((Array.isArray(a) ? a : []) as Data[]).map(x => [String(x.id), x]));
const signedTk = (n: number) => (n < 0 ? '−' : '') + '৳' + money(Math.abs(n));

export function effectsOf(path: string, before: Data | null, after: Data | null, sizeName: (id: unknown) => string, coName: (id: unknown) => string) {
  const [col, id] = path.split('/');
  const fx: string[] = [], links: Link[] = [];
  const b = before || {}, a = after || {};
  if (col === 'ledgers') {
    const name = String(a.name || b.name || '');
    const bal = (d: Data) => N(d.opening) + ((d.entries as Data[]) || []).reduce((t, e) => t + N(e.credit) - N(e.debit), 0);
    const B = byId(b.entries), A = byId(a.entries), dates = new Set<string>();
    const changed = [...new Set([...B.keys(), ...A.keys()])].filter(k => !same(B.get(k), A.get(k)));
    for (const k of changed) {
      const o = B.get(k), n = A.get(k), e = (n || o) as Data, date = String(e.date || '');
      if (N(e.credit) > 0) {   // a memo
        const oP = new Map(((o?.picks as Data[]) || []).map(p => [String(p.item), N(p.kg)]));
        const nP = new Map(((n?.picks as Data[]) || []).map(p => [String(p.item), N(p.kg)]));
        for (const it of new Set([...oP.keys(), ...nP.keys()])) {
          const d = (nP.get(it) || 0) - (oP.get(it) || 0);
          if (d) fx.push(`📦 স্টক: ${sizeName(it)} — ${d > 0 ? 'মাল গেছে −' : 'মাল ফিরে এসেছে +'}${kg(Math.abs(d))}`);
        }
        if (!oP.size && !nP.size && N(n?.kg) !== N(o?.kg)) fx.push(`📦 স্টক: মাল ${kg(Math.abs(N(n?.kg) - N(o?.kg)))} ${N(n?.kg) > N(o?.kg) ? 'গেছে' : 'ফিরে এসেছে'}`);
        if (n && N(n.labour) !== N(o?.labour)) fx.push(o ? `👷 লেবার খরচ: ৳${money(o.labour)} → ৳${money(n.labour)}` : `👷 লেবার খরচ: ৳${money(n.labour)}`);
        if (!n && N(o?.labour)) fx.push(`👷 লেবার খরচ বাদ: ৳${money(o?.labour)}`);
        fx.push(`📅 দৈনিক (${bnDate(date)}): বিক্রয়ে ${!o ? 'যোগ হয়েছে' : !n ? 'থেকে বাদ গেছে' : 'বদলেছে'} — মেমো ${bn(e.memoNo ?? '')}`);
        if (n) links.push({ t: 'memo', id, eid: k, label: `🧾 মেমো ${bn(e.memoNo ?? '')} দেখুন` });
        links.push({ t: 'stock', date: String(e.confirmedOn || date), label: '📦 স্টক দেখুন' });
      } else if (N(e.debit) > 0 || N(o?.debit) > 0) {   // a জমা
        const d = N(n?.debit) - N(o?.debit);
        if (d) fx.push(`💵 দৈনিক (${bnDate(date)}): আমদানি ${d > 0 ? '+' : '−'}৳${money(Math.abs(d))} → হাতে নগদ ${d > 0 ? 'বেড়েছে' : 'কমেছে'} ৳${money(Math.abs(d))}`);
        dates.add(date);
      }
    }
    const bb = bal(b), ab = bal(a);
    if (before && after && bb !== ab) fx.unshift(`📒 ${name}-এর খতিয়ান: বাকি ${signedTk(bb)} → ${signedTk(ab)}`);
    else if (!before && after && ab) fx.unshift(`📒 ${name}-এর খতিয়ান: বাকি ${signedTk(ab)}`);
    if (after) links.unshift({ t: 'party', id, label: `📒 ${name}-এর খতিয়ান` });
    for (const d of dates) links.push({ t: 'daily', date: d, label: `📅 দৈনিক ${bnDate(d)}` });
  }
  if (col === 'days') {
    const sum = (x: unknown) => ((x as Data[]) || []).reduce((t, e) => t + N(e.kg), 0);
    const inD = sum(a.entries) - sum(b.entries), outD = sum(a.outs) - sum(b.outs);
    const B = byId(b.entries), A = byId(a.entries);
    const per = new Map<string, number>();
    for (const e of (a.entries as Data[]) || []) per.set(String(e.item), (per.get(String(e.item)) || 0) + N(e.kg));
    for (const e of (b.entries as Data[]) || []) per.set(String(e.item), (per.get(String(e.item)) || 0) - N(e.kg));
    for (const o of (a.outs as Data[]) || []) per.set(String(o.item), (per.get(String(o.item)) || 0) - N(o.kg));
    for (const o of (b.outs as Data[]) || []) per.set(String(o.item), (per.get(String(o.item)) || 0) + N(o.kg));
    for (const [it, d] of per) if (d) fx.push(`📦 ${sizeName(it)}: ${d > 0 ? '+' : '−'}${kg(Math.abs(d))}`);
    const net = inD - outD;
    if (net) fx.unshift(`📊 সর্বমোট স্টক ${net > 0 ? 'বেড়েছে +' : 'কমেছে −'}${kg(Math.abs(net))}`);
    const cos = new Set<string>();
    for (const [k, e] of A) if (!same(B.get(k), e) && e.co) cos.add(String(e.co));
    for (const [k, e] of B) if (!A.has(k) && e.co) cos.add(String(e.co));
    for (const c of cos) { fx.push(`🏭 ${coName(c)}-এর খতিয়ানে চালান ${A.size >= B.size ? 'যোগ / বদল' : 'বাদ'} হয়েছে`); links.push({ t: 'company', id: c, label: `🏭 ${coName(c)}` }); }
    links.unshift({ t: 'stock', date: id, label: `📦 স্টক ${bnDate(id)}` });
  }
  if (col === 'companies') {
    const name = String(a.name || b.name || '');
    const obo = (d: Data) => N(d.opening) + ((d.entries as Data[]) || []).reduce((t, e) => t + (e.type === 'rec' ? N(e.amount) : -N(e.amount)), 0);
    if (obo(b) !== obo(a)) fx.push(`🏭 ${name}: অবশিষ্ট ${signedTk(obo(b))} → ${signedTk(obo(a))}${obo(a) < 0 ? ' (কোম্পানি পাবে)' : ''}`);
    const B = byId(b.entries), A = byId(a.entries);
    for (const [k, e] of A) if (!B.has(k) && e.type === 'inv' && e.fromStock) fx.push(`📦 এই চালানের মাল স্টকে যোগ হয়েছে (${bnDate(String(e.date))})`);
    if (after) links.push({ t: 'company', id, label: `🏭 ${name}` });
  }
  if (col === 'khoroch') {
    const sum = (x: unknown) => ((x as Data[]) || []).reduce((t, e) => t + N(e.amt), 0);
    const d = sum(a.items) - sum(b.items);
    if (d) fx.push(`💵 দৈনিক (${bnDate(id)}): খরচ ${d > 0 ? '+' : '−'}৳${money(Math.abs(d))} → হাতে নগদ ${d > 0 ? 'কমেছে' : 'বেড়েছে'} ৳${money(Math.abs(d))}`);
    links.push({ t: 'daily', date: id, label: `📅 দৈনিক ${bnDate(id)}` });
  }
  if (path === 'amdani/sabek') {
    const bm = (b.map || {}) as Data, am = (a.map || {}) as Data;
    for (const k of new Set([...Object.keys(bm), ...Object.keys(am)])) if (!same(bm[k], am[k])) {
      fx.push(`💵 ${bnDate(k)}-এর হাতে নগদ বদলেছে (সাবেক জমা ৳${money(bm[k])} → ৳${money(am[k])})`);
      links.push({ t: 'daily', date: k, label: `📅 দৈনিক ${bnDate(k)}` });
    }
  }
  return { effects: fx.slice(0, 14), links: links.slice(0, 6) };
}

// compare two lists of {id …}: what was added, removed, changed
function listDiff(col: string, a: unknown, b: unknown, out: string[]) {
  const A = (Array.isArray(a) ? a : []) as Data[], B = (Array.isArray(b) ? b : []) as Data[];
  const am = new Map(A.map(x => [String(x.id), x])), bm = new Map(B.map(x => [String(x.id), x]));
  for (const x of B) if (!am.has(String(x.id))) out.push('＋ ' + entryText(col, x));
  for (const x of A) if (!bm.has(String(x.id))) out.push('－ ' + entryText(col, x));
  for (const x of B) { const o = am.get(String(x.id)); if (o && !same(o, x)) out.push('✎ ' + entryText(col, x)); }
}

const FIELD: Record<string, string> = { name: 'নাম', address: 'ঠিকানা', opening: 'আগের জের', openJoma: 'পুরনো জমা', openKhoroch: 'পুরনো খরচ', phone: 'ফোন', due: 'বাকি' };

// label + detail lines for a change to one app path
export function describe(path: string, before: Data | null, after: Data | null): { label: string; lines: string[] } {
  const [col, id] = path.split('/');
  const d = (after || before || {}) as Data, lines: string[] = [];
  let label = path;
  if (col === 'ledgers') label = '📒 পার্টি: ' + (d.name || id);
  else if (col === 'companies') label = '🏭 কোম্পানি: ' + (d.name || id);
  else if (col === 'days') label = '🚚 স্টক: ' + bnDate(id);
  else if (col === 'khoroch') label = '💸 খরচ: ' + bnDate(id);
  else if (path === 'settings/cats') label = '📦 মার্কা / সাইজ';
  else if (path === 'settings/rates') label = '🏷️ বিক্রি দর';
  else if (path === 'settings/labour') label = '👷 লেবার রেট';
  else if (path === 'settings/drafts') label = '📝 খসড়া মেমো';
  else if (path === 'amdani/sabek') label = '💰 সাবেক জমা';
  else if (path === 'settings/ui') label = '🎨 মেমোর ধরন (সেটিং)';

  if (before && after) {
    if (col === 'ledgers' || col === 'companies') listDiff(col, before.entries, after.entries, lines);
    if (col === 'days') { listDiff('days', before.entries, after.entries, lines); listDiff('outs', before.outs, after.outs, lines); }
    if (col === 'khoroch') listDiff('khoroch', before.items, after.items, lines);
    for (const [k, t] of Object.entries(FIELD)) if (k in before || k in after) if (!same(before[k], after[k])) lines.push(`${t}: ${bn(before[k] ?? '—')} → ${bn(after[k] ?? '—')}`);
    if (path === 'settings/cats') {
      const cnt = (x: Data) => ((x.list || []) as Data[]).reduce((s, m) => s + ((m.items || []) as unknown[]).length, 0);
      const a = (before.list || []) as Data[], b = (after.list || []) as Data[];
      if (a.length !== b.length) lines.push(`মার্কা ${bn(a.length)} → ${bn(b.length)}`);
      if (cnt(before) !== cnt(after)) lines.push(`সাইজ ${bn(cnt(before))} → ${bn(cnt(after))}`);
      if (!lines.length) lines.push('সাইজের তথ্য বদলেছে');
    }
    if (path === 'settings/drafts') lines.push(`খসড়া ${bn(((before.list || []) as unknown[]).length)} → ${bn(((after.list || []) as unknown[]).length)}`);
    if (path === 'settings/labour') lines.push(`রেট ${bn(before.rate)} → ${bn(after.rate)}`);
    if (path === 'settings/ui') { const t = (v: unknown) => v === 'digital' ? 'ডিজিটাল' : 'কাগজ'; lines.splice(0, lines.length, `মেমো দেখানো: ${t(after.memoStyle)} · নতুন মেমো ফর্ম: ${t(after.memoForm)}`); }
    if (path === 'amdani/sabek') {
      const a = (before.map || {}) as Data, b = (after.map || {}) as Data;
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!same(a[k], b[k])) lines.push(`${bnDate(k)}: ৳${money(a[k])} → ৳${money(b[k])}`);
    }
    if (!lines.length) lines.push('তথ্য বদলেছে');
  } else if (after) {
    if (col === 'ledgers' || col === 'companies') (after.entries as Data[] || []).slice(0, 5).forEach(e => lines.push('＋ ' + entryText(col, e)));
    if (col === 'days') (after.entries as Data[] || []).slice(0, 5).forEach(e => lines.push('＋ ' + entryText('days', e)));
    if (col === 'khoroch') (after.items as Data[] || []).forEach(e => lines.push('＋ ' + entryText('khoroch', e)));
  }
  return { label, lines: lines.slice(0, 12) };
}

export const actionOf = (before: Data | null, after: Data | null) => !before ? 'নতুন' : !after ? 'মুছে ফেলা' : 'পরিবর্তন';
export const sameData = same;

export async function logAct(db: Db, who: User | null, a: Omit<Act, '_id' | 'ts' | 'uid' | 'uname'>) {
  const row: Act = { _id: Date.now().toString(36) + randomBytes(4).toString('hex'), ts: Date.now(), uid: who?._id || '-', uname: who?.name || 'সিস্টেম', ...a };
  await db.collection<Act>('activity').insertOne(row);
  return row;
}
