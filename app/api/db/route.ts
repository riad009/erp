import { getMongo } from '@/lib/mongo';
import { COLLECTIONS, getDoc, setDoc, deleteDoc, listDocs, wipeAll, migrateOldLayout, LISTABLE } from '@/lib/store';
import { currentUser } from '@/lib/auth';
import { logAct, describe, actionOf, sameData, effectsOf, type Act } from '@/lib/activity';

// Small doc store used by public/khata/index.html (same API it had on claude.ai):
//   collection(name).get()  → {op:'list', col}
//   doc('col/id').get/set/delete → {op:'get'|'set'|'delete', path}
// lib/store.ts maps these app paths to the MongoDB collections (stock_days, stock_sizes, parties …).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';   // the MongoDB driver needs Node, not the Edge runtime

// open /api/db in the browser to check the database connection (when logged in)
export async function GET(req: Request) {
  try {
    const db = await getMongo();
    if (!await currentUser(db, req)) return Response.json({ error: 'login' }, { status: 401 });
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
    const me = await currentUser(db, req);
    if (!me) return Response.json({ error: 'login' }, { status: 401 });
    // every change is written to the activity list with the record as it was before (for undo)
    const track = async (path: string, after: Record<string, unknown> | null, write: () => Promise<void>) => {
      const old = await getDoc(db, path), before = old.exists ? old.data : null;
      await write();
      if (sameData(before, after) || (!before && !after)) return;
      // the app opens a blank stock day by itself every morning — not worth a line
      const empty = (d: Record<string, unknown> | null) => !!d && !((d.entries as unknown[]) || []).length && !((d.outs as unknown[]) || []).length;
      if (path.startsWith('days/') && ((!before && empty(after)) || (!after && empty(before)))) return;
      const { label, lines } = describe(path, before, after);
      // names for the "what else changed" lines
      let sizes: Map<string, string> | null = null;
      const sizeName = (id: unknown) => sizes?.get(String(id)) || 'মাল';
      if (/^(ledgers|days)\//.test(path)) {
        const cats = (await getDoc(db, 'settings/cats')).data as { list?: { name: string; items?: { id: string; h?: unknown; w?: unknown }[] }[] } | null;
        sizes = new Map((cats?.list || []).flatMap(m => (m.items || []).map(it => [String(it.id), `${m.name} ${String(it.h ?? '')} × ${String(it.w ?? '')}`.replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[+d])] as [string, string])));
      }
      const coNames = new Map<string, string>();
      if (path.startsWith('days/')) for (const c of await db.collection<{ _id: string; name?: string }>('companies').find({}, { projection: { name: 1 } }).toArray()) coNames.set(c._id, c.name || '');
      const { effects, links } = effectsOf(path, before, after, sizeName, id => coNames.get(String(id)) || 'কোম্পানি');
      await logAct(db, me, { kind: 'data', action: actionOf(before, after), label, lines, path, before, existed: old.exists, cid: req.headers.get('x-khata-client') || undefined, effects, links });
    };
    switch (body.op) {
      case 'ping': {
        const counts = await Promise.all(COLLECTIONS.map(n => db.collection(n).countDocuments({}, { limit: 1 })));
        // after 👑 ডেটা মুছুন every device drops its saved copy (db.js compares this time)
        const w = await db.collection<{ _id: string; ts?: number; part?: string }>('settings').findOne({ _id: 'wipe_marker' });
        return Response.json({ ok: true, empty: counts.every(n => n === 0), wipe: w ? { ts: w.ts, part: w.part } : null });
      }
      // live sync: which records other pages changed after `since` (the page then re-reads only those)
      case 'changes': {
        const acts = db.collection<Act>('activity');
        const g2 = globalThis as unknown as { __actIdx?: Promise<unknown> };
        if (!g2.__actIdx) g2.__actIdx = acts.createIndex({ ts: -1 }).catch(() => { g2.__actIdx = undefined; });
        await g2.__actIdx;
        const since = Number(body.since) || 0, now = Date.now();
        if (!since) return Response.json({ now, paths: [] });
        const cid = req.headers.get('x-khata-client') || '';
        const rows = await acts.find({ ts: { $gt: since - 3000 }, kind: { $in: ['data', 'undo', 'import', 'wipe'] } }, { projection: { path: 1, ts: 1, kind: 1, cid: 1 } }).sort({ ts: 1 }).limit(500).toArray();
        const mine = rows.filter(r => !(r.kind === 'data' && cid && r.cid === cid));
        return Response.json({ now, rows: mine.map(r => ({ id: r._id, path: r.kind === 'import' || r.kind === 'wipe' || r.path === '*' ? '*' : r.path, cid: r.cid || '' })) });
      }
      case 'list': {
        if (!LISTABLE.includes(body.col)) throw new Error('bad collection');
        return Response.json({ docs: await listDocs(db, body.col) });
      }
      case 'get':
        return Response.json(await getDoc(db, body.path));
      case 'set':
        await track(String(body.path), body.data || {}, () => setDoc(db, body.path, body.data || {}));
        return Response.json({ ok: true });
      case 'delete':
        await track(String(body.path), null, () => deleteDoc(db, body.path));
        return Response.json({ ok: true });
      case 'import': {
        if (me.role !== 'admin') return Response.json({ error: 'শুধু সুপার অ্যাডমিন' }, { status: 403 });
        // replace everything: body.docs = [{path, data}]
        const docs: { path: string; data: Record<string, unknown> }[] = body.docs || [];
        await wipeAll(db);
        for (const d of docs) await setDoc(db, d.path, d.data || {});
        await logAct(db, me, { kind: 'import', action: 'পুরো ডেটা বসানো', label: '📥 ব্যাকআপ থেকে ডেটা বসানো', lines: [String(docs.length).replace(/[0-9]/g, d => '০১২৩৪৫৬৭৮৯'[+d]) + 'টা রেকর্ড'] });
        return Response.json({ ok: true, count: docs.length });
      }
      default:
        return Response.json({ error: 'bad op' }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
