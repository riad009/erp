import type { Db, Document } from 'mongodb';
import { logAct } from './activity';
import type { User } from './auth';

// 👑 অ্যাডমিন → ডেটা মুছুন. User accounts (and the email / app settings) are never touched.
// Everything removed is kept inside the activity line (`snapshot`) so ↶ ফেরান can bring it back.

type Row = Document & { _id: string };
export const PARTS: Record<string, { label: string; what: string }> = {
  stock:    { label: '🚚 স্টক', what: 'সব দিনের মাল আসা / মাল যাওয়া, আর প্রতিটা সাইজের শুরুর কেজি ০ (মার্কা ও সাইজের নাম থাকবে)' },
  ledger:   { label: '📒 খতিয়ান', what: 'সব পার্টি, তাদের মেমো আর জমা, খসড়া মেমো' },
  company:  { label: '🏭 কোম্পানি', what: 'সব কোম্পানি, তাদের চালান আর রসিদ' },
  daily:    { label: '💸 দৈনিক খরচ', what: 'সব দিনের খরচ আর সাবেক জমা' },
  activity: { label: '📝 অ্যাক্টিভিটি', what: 'অ্যাক্টিভিটি লিস্টের সব লাইন' },
  all:      { label: '🗑 সব ডেটা', what: 'উপরের সবকিছু + মার্কা ও সাইজ, বিক্রি দর, লেবার রেট — শুধু ইউজার অ্যাকাউন্ট থাকবে' },
};

// which records each part removes: [collection, filter]
const SETTINGS_DATA = ['sale_rates', 'labour_rate', 'memo_drafts'];
const TARGETS: Record<string, [string, Document][]> = {
  stock:    [['stock_days', {}]],
  ledger:   [['parties', {}], ['settings', { _id: 'memo_drafts' }]],
  company:  [['companies', {}]],
  daily:    [['expenses', {}], ['cash_opening', {}]],
  activity: [['activity', {}]],
  all:      [['stock_days', {}], ['stock_markas', {}], ['stock_sizes', {}], ['parties', {}], ['companies', {}], ['expenses', {}],
             ['cash_opening', {}], ['settings', { _id: { $in: SETTINGS_DATA } }], ['activity', {}]],
};

const BD = '০১২৩৪৫৬৭৮৯';
const bn = (n: number) => String(n).replace(/[0-9]/g, d => BD[+d]);
const NAMES: Record<string, string> = { stock_days: 'স্টকের দিন', stock_markas: 'মার্কা', stock_sizes: 'সাইজ', parties: 'পার্টি',
  companies: 'কোম্পানি', expenses: 'খরচের দিন', cash_opening: 'সাবেক জমা', settings: 'সেটিং', activity: 'অ্যাক্টিভিটি লাইন' };

export async function counts(db: Db) {
  const out: Record<string, number> = {};
  for (const [part, list] of Object.entries(TARGETS)) {
    let n = 0;
    for (const [col, f] of list) if (col !== 'settings') n += await db.collection<Row>(col).countDocuments(f);
    out[part] = n;
  }
  return out;
}

const SNAP_MAX = 12 * 1024 * 1024;   // a MongoDB record holds 16 MB

export async function wipe(db: Db, part: string, me: User) {
  const list = TARGETS[part];
  if (!list) throw new Error('bad part');
  const snapshot: Record<string, Row[]> = {}, lines: string[] = [];
  for (const [col, f] of list) {
    const rows = await db.collection<Row>(col).find(f).toArray();
    snapshot[col] = (snapshot[col] || []).concat(rows);
  }
  // স্টক: the sizes stay, only their শুরুর কেজি becomes ০ (kept in the snapshot to undo)
  if (part === 'stock') snapshot.stock_sizes = await db.collection<Row>('stock_sizes').find().toArray();
  const big = JSON.stringify(snapshot).length > SNAP_MAX;

  for (const [col, f] of list) {
    const r = await db.collection<Row>(col).deleteMany(f);
    if (r.deletedCount && col !== 'settings') lines.push(`${NAMES[col] || col}: ${bn(r.deletedCount)}টা মুছে ফেলা হয়েছে`);
  }
  if (part === 'stock') {
    await db.collection<Row>('stock_sizes').updateMany({}, { $set: { open_kg: 0 } });
    lines.push('সাইজের শুরুর কেজি: সব ০');
  }
  // every phone / computer drops its saved copy of this part (see db.js)
  await db.collection<Row>('settings').replaceOne({ _id: 'wipe_marker' }, { _id: 'wipe_marker', ts: Date.now(), part }, { upsert: true });
  if (big) lines.push('⚠️ ডেটা অনেক বড় — এই মোছা ফেরানো যাবে না (ব্যাকআপ ফাইল দিয়ে ফেরত আনুন)');
  await logAct(db, me, { kind: 'wipe', action: 'সব মুছে ফেলা', label: `🗑 ${PARTS[part].label.replace(/^\S+\s/, '')} — পুরোটা মুছে ফেলা হয়েছে`,
    lines: lines.length ? lines : ['কিছু ছিল না'], path: '*', restorable: !big, ...(big ? {} : { snapshot }) });
  return { ok: true, lines };
}

// ↶ ফেরান on a wipe line: everything comes back (records made after the delete stay too)
export async function restore(db: Db, snapshot: Record<string, Row[]>) {
  for (const [col, rows] of Object.entries(snapshot || {})) {
    if (!rows.length) continue;
    await db.collection<Row>(col).bulkWrite(rows.map(r => ({ replaceOne: { filter: { _id: r._id }, replacement: r, upsert: true } })));
  }
}
