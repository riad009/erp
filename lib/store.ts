import type { Db, Document } from 'mongodb';

// The app (public/khata/index.html) still talks in its old paths — days/<id>, ledgers/<id>,
// settings/cats … — but in MongoDB every kind of data has its own clearly named collection,
// one record per item, fields stored directly (no `data` wrapper):
//
//   app path            MongoDB
//   days/<date>         stock_days     (one per day: মাল আসছে / যাচ্ছে)
//   settings/cats       stock_markas   (one per মার্কা) + stock_sizes (one per size: height, width, open_kg …)
//   ledgers/<id>        parties        (one per party, with its memos / payments)
//   companies/<id>      companies      (one per company, with চালান / রসিদ)
//   khoroch/<date>      expenses       (one per day)
//   amdani/sabek        cash_opening   (one per day: সাবেক জমা)
//   settings/rates      settings       _id "sale_rates"
//   settings/labour     settings       _id "labour_rate"

export const COLLECTIONS = ['stock_markas', 'stock_sizes', 'stock_days', 'parties', 'companies', 'expenses', 'cash_opening', 'settings'];

type Data = Record<string, unknown>;
type Row = Document & { _id: string };

// plain one-record-per-item collections
const SIMPLE: Record<string, string> = { days: 'stock_days', ledgers: 'parties', companies: 'companies', khoroch: 'expenses' };
const SETTING: Record<string, string> = { rates: 'sale_rates', labour: 'labour_rate' };
export const LISTABLE = Object.keys(SIMPLE);

const strip = ({ _id, ...rest }: Row): Data => rest;
const toRow = (id: string, data: Data): Row => { const { _id, ...rest } = data; void _id; return { _id: id, ...rest }; };

function split(path: unknown): [string, string] {
  const [col, id, ...rest] = String(path || '').split('/');
  if (!col || !id || rest.length) throw new Error('bad path: ' + path);
  return [col, id];
}

// size field names: app ↔ MongoDB
const SIZE_FIELDS: [string, string][] = [['h', 'height'], ['w', 'width'], ['open', 'open_kg'], ['cost', 'buy_rate'], ['z', 'is_z']];
const sizeOut = (it: Data, markaId: string, position: number): Row => {
  const r: Row = { _id: String(it.id), marka_id: markaId, position };
  for (const [k, v] of Object.entries(it)) if (k !== 'id') r[SIZE_FIELDS.find(f => f[0] === k)?.[1] ?? k] = v;
  return r;
};
const sizeIn = (r: Row): Data => {
  const it: Data = { id: r._id };
  for (const [k, v] of Object.entries(r)) if (!['_id', 'marka_id', 'position'].includes(k)) it[SIZE_FIELDS.find(f => f[1] === k)?.[0] ?? k] = v;
  return it;
};

// replace a whole collection's contents with `rows` (upsert each, then drop the ones not listed)
async function replaceAll(db: Db, name: string, rows: Row[]) {
  const c = db.collection<Row>(name);
  if (rows.length) await c.bulkWrite(rows.map(r => ({ replaceOne: { filter: { _id: r._id }, replacement: r, upsert: true } })));
  await c.deleteMany({ _id: { $nin: rows.map(r => r._id) } });
}

export async function getDoc(db: Db, path: unknown): Promise<{ exists: boolean; data: Data | null }> {
  const [col, id] = split(path);
  if (SIMPLE[col]) {
    const r = await db.collection<Row>(SIMPLE[col]).findOne({ _id: id });
    return { exists: !!r, data: r ? strip(r) : null };
  }
  if (col === 'settings' && id === 'cats') {
    const markas = await db.collection<Row>('stock_markas').find().sort({ position: 1 }).toArray();
    if (!markas.length) return { exists: false, data: null };
    const sizes = await db.collection<Row>('stock_sizes').find().sort({ position: 1 }).toArray();
    const list = markas.map(m => {
      const { _id, position, ...rest } = m; void position;
      return { id: _id, ...rest, items: sizes.filter(s => s.marka_id === _id).map(sizeIn) };
    });
    return { exists: true, data: { list } };
  }
  if (col === 'settings' && SETTING[id]) {
    const r = await db.collection<Row>('settings').findOne({ _id: SETTING[id] });
    return { exists: !!r, data: r ? strip(r) : null };
  }
  if (col === 'amdani' && id === 'sabek') {
    const rows = await db.collection<Row>('cash_opening').find().toArray();
    return rows.length ? { exists: true, data: { map: Object.fromEntries(rows.map(r => [r._id, r.amount])) } } : { exists: false, data: null };
  }
  throw new Error('unknown path: ' + path);
}

export async function setDoc(db: Db, path: unknown, data: Data) {
  const [col, id] = split(path);
  if (SIMPLE[col]) { await db.collection<Row>(SIMPLE[col]).replaceOne({ _id: id }, toRow(id, data), { upsert: true }); return; }
  if (col === 'settings' && id === 'cats') {
    const list = (Array.isArray(data.list) ? data.list : []) as Data[];
    const markas: Row[] = [], sizes: Row[] = [];
    list.forEach((m, i) => {
      const { id: mid, items, ...rest } = m;
      markas.push({ _id: String(mid), position: i, ...rest });
      ((items as Data[]) || []).forEach((it, j) => sizes.push(sizeOut(it, String(mid), j)));
    });
    await replaceAll(db, 'stock_markas', markas);
    await replaceAll(db, 'stock_sizes', sizes);
    return;
  }
  if (col === 'settings' && SETTING[id]) { await db.collection<Row>('settings').replaceOne({ _id: SETTING[id] }, toRow(SETTING[id], data), { upsert: true }); return; }
  if (col === 'amdani' && id === 'sabek') {
    const map = (data.map || {}) as Data;
    await replaceAll(db, 'cash_opening', Object.entries(map).map(([date, amount]) => ({ _id: date, amount })));
    return;
  }
  throw new Error('unknown path: ' + path);
}

export async function deleteDoc(db: Db, path: unknown) {
  const [col, id] = split(path);
  if (SIMPLE[col]) { await db.collection<Row>(SIMPLE[col]).deleteOne({ _id: id }); return; }
  if (col === 'settings' && id === 'cats') { await replaceAll(db, 'stock_markas', []); await replaceAll(db, 'stock_sizes', []); return; }
  if (col === 'settings' && SETTING[id]) { await db.collection<Row>('settings').deleteOne({ _id: SETTING[id] }); return; }
  if (col === 'amdani' && id === 'sabek') { await replaceAll(db, 'cash_opening', []); return; }
  throw new Error('unknown path: ' + path);
}

export async function listDocs(db: Db, col: string) {
  if (!SIMPLE[col]) throw new Error('bad collection: ' + col);
  const rows = await db.collection<Row>(SIMPLE[col]).find().toArray();
  return rows.map(r => ({ id: r._id, data: strip(r) }));
}

export async function wipeAll(db: Db) {
  for (const n of COLLECTIONS) await db.collection(n).deleteMany({});
}

// One-time move from the first layout (days, ledgers, khoroch, amdani, settings/cats … as {_id, data}).
const OLD_ONLY = ['days', 'ledgers', 'khoroch', 'amdani'];
const isOld = (r: Document) => 'data' in r && Object.keys(r).length === 2;
const g = globalThis as unknown as { __khataMigrated?: Promise<void> };

export function migrateOldLayout(db: Db) {
  if (!g.__khataMigrated) g.__khataMigrated = (async () => {
    const have = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
    for (const col of [...OLD_ONLY, 'companies', 'settings']) {
      if (!have.has(col)) continue;
      const rows = (await db.collection<Row>(col).find().toArray()).filter(isOld);
      const moved: string[] = [];
      for (const r of rows) {
        try { await setDoc(db, `${col}/${r._id}`, (r.data || {}) as Data); moved.push(r._id); }
        catch (e) { console.warn('khata migrate: skipped', col, r._id, (e as Error).message); }
      }
      if (OLD_ONLY.includes(col)) { if (moved.length === rows.length) await db.collection(col).drop(); }
      // companies is rewritten in place (same name, same _id); old settings ids (cats, rates, labour) are removed
      else if (col === 'settings' && moved.length) await db.collection<Row>(col).deleteMany({ _id: { $in: moved } });
    }
  })().catch(e => { g.__khataMigrated = undefined; throw e; });
  return g.__khataMigrated;
}
