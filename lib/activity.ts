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
