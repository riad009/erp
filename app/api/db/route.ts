import { getMongo } from '@/lib/mongo';
import { COLLECTIONS, getDoc, setDoc, deleteDoc, listDocs, wipeAll, migrateOldLayout, LISTABLE } from '@/lib/store';

// Small doc store used by public/khata/index.html (same API it had on claude.ai):
//   collection(name).get()  → {op:'list', col}
//   doc('col/id').get/set/delete → {op:'get'|'set'|'delete', path}
// lib/store.ts maps these app paths to the MongoDB collections (stock_days, stock_sizes, parties …).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';   // the MongoDB driver needs Node, not the Edge runtime

// open /api/db in the browser to check the database connection
export async function GET() {
  try {
    const db = await getMongo();
    await migrateOldLayout(db);
    const counts = Object.fromEntries(await Promise.all(COLLECTIONS.map(async n => [n, await db.collection(n).countDocuments()])));
    return Response.json({ ok: true, database: db.databaseName, counts });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const db = await getMongo();
    await migrateOldLayout(db);
    switch (body.op) {
      case 'ping': {
        const counts = await Promise.all(COLLECTIONS.map(n => db.collection(n).countDocuments({}, { limit: 1 })));
        return Response.json({ ok: true, empty: counts.every(n => n === 0) });
      }
      case 'list': {
        if (!LISTABLE.includes(body.col)) throw new Error('bad collection');
        return Response.json({ docs: await listDocs(db, body.col) });
      }
      case 'get':
        return Response.json(await getDoc(db, body.path));
      case 'set':
        await setDoc(db, body.path, body.data || {});
        return Response.json({ ok: true });
      case 'delete':
        await deleteDoc(db, body.path);
        return Response.json({ ok: true });
      case 'import': {
        // replace everything: body.docs = [{path, data}]
        const docs: { path: string; data: Record<string, unknown> }[] = body.docs || [];
        await wipeAll(db);
        for (const d of docs) await setDoc(db, d.path, d.data || {});
        return Response.json({ ok: true, count: docs.length });
      }
      default:
        return Response.json({ error: 'bad op' }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
