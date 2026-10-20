import { getMongo } from '@/lib/mongo';

// Small doc store used by public/khata/index.html (same API it had on claude.ai):
//   collection(name).get()  → {op:'list', col}
//   doc('col/id').get/set/delete → {op:'get'|'set'|'delete', path}
// Each app collection is one Mongo collection; a doc is stored as {_id: id, data}.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';   // the MongoDB driver needs Node, not the Edge runtime

const COLS = ['days', 'ledgers', 'companies', 'khoroch', 'settings', 'amdani'];

function split(path: unknown): [string, string] {
  const [col, id, ...rest] = String(path || '').split('/');
  if (!COLS.includes(col) || !id || rest.length) throw new Error('bad path: ' + path);
  return [col, id];
}

type Doc = { _id: string; data: unknown };

// open /api/db in the browser to check the database connection
export async function GET() {
  try {
    const db = await getMongo();
    const counts = Object.fromEntries(await Promise.all(COLS.map(async n => [n, await db.collection(n).estimatedDocumentCount()])));
    return Response.json({ ok: true, database: db.databaseName, counts });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const db = await getMongo();
    const c = (name: string) => db.collection<Doc>(name);
    switch (body.op) {
      case 'ping': {
        const counts = await Promise.all(COLS.map(n => c(n).estimatedDocumentCount()));
        return Response.json({ ok: true, empty: counts.every(n => n === 0) });
      }
      case 'list': {
        if (!COLS.includes(body.col)) throw new Error('bad collection');
        const docs = await c(body.col).find().toArray();
        return Response.json({ docs: docs.map(d => ({ id: d._id, data: d.data })) });
      }
      case 'get': {
        const [col, id] = split(body.path);
        const d = await c(col).findOne({ _id: id });
        return Response.json({ exists: !!d, data: d ? d.data : null });
      }
      case 'set': {
        const [col, id] = split(body.path);
        await c(col).replaceOne({ _id: id }, { data: body.data }, { upsert: true });
        return Response.json({ ok: true });
      }
      case 'delete': {
        const [col, id] = split(body.path);
        await c(col).deleteOne({ _id: id });
        return Response.json({ ok: true });
      }
      case 'import': {
        // replace everything: body.docs = [{path, data}]
        const docs: { path: string; data: unknown }[] = body.docs || [];
        const by: Record<string, Doc[]> = {};
        for (const d of docs) { const [col, id] = split(d.path); (by[col] ||= []).push({ _id: id, data: d.data }); }
        for (const n of COLS) {
          await c(n).deleteMany({});
          if (by[n]?.length) await c(n).insertMany(by[n]);
        }
        return Response.json({ ok: true, count: docs.length });
      }
      default:
        return Response.json({ error: 'bad op' }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
