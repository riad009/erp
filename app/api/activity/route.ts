import { getMongo } from '@/lib/mongo';
import { currentUser, can, type User } from '@/lib/auth';
import { setDoc, deleteDoc, getDoc } from '@/lib/store';
import { type Act } from '@/lib/activity';
import { applyChange, goneIds } from '@/lib/undo';
import { restore } from '@/lib/wipe';

// the activity list: {op:'list'} · {op:'toggle', id} (মুছুন / ফেরান) · {op:'restore', id} (a 🗑 সব মুছে ফেলা line)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Data = Record<string, unknown>;
// a memo line reads "＋ মেমো নং …", a জমা line "＋ জমা ৳…" (lib/activity.ts entryText)
const CATS: Record<string, Record<string, unknown>> = {
  memo: { path: /^ledgers\//, lines: /মেমো/ },
  joma: { path: /^ledgers\//, lines: /জমা ৳/ },
  stock: { path: /^(days\/|settings\/cats$)/ },
  khoroch: { path: /^khoroch\// },
};

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const db = await getMongo();
    const me = await currentUser(db, req);
    if (!me) return Response.json({ error: 'login' }, { status: 401 });
    if (!can(me, 'activity')) return Response.json({ error: 'অনুমতি নেই' }, { status: 403 });
    const acts = db.collection<Act>('activity');

    if (body.op === 'list') {
      const q: Record<string, unknown> = {};
      if (body.user) q.uid = String(body.user);
      q.kind = { $ne: 'undo' };   // old "↶ ফেরানো" bookkeeping lines are not shown any more (the card itself turns red / green)
      if (body.kind === 'data') q.kind = { $in: ['data', 'import', 'wipe'] };
      else if (body.kind === 'other') q.kind = { $nin: ['data', 'undo', 'import', 'wipe'] };
      // owner's filters: only memos / stock মাল / টাকা জমা / খরচ (changes and their ফেরানো)
      else if (CATS[body.kind]) Object.assign(q, { kind: 'data' }, CATS[body.kind]);
      if (body.date) { const s = new Date(body.date + 'T00:00:00+06:00').getTime(); q.ts = { $gte: s, $lt: s + 864e5 }; }
      if (body.before) q.ts = { ...(q.ts as object || {}), $lt: Number(body.before) };
      const rows = await acts.find(q, { projection: { before: 0, after: 0, snapshot: 0, redoDoc: 0 } }).sort({ ts: -1 }).limit(60).toArray();
      const users = await db.collection<User>('users').find({}, { projection: { name: 1 } }).toArray();
      return Response.json({
        rows: rows.map(r => ({ ...r,
          state: r.state || (r.undone ? 'off' : ''),                        // '' = as saved · off = মুছে ফেলা (red) · on = আবার ফেরানো (green)
          canToggle: r.kind === 'data' && !!r.path && r.path !== '*',
          canRestore: r.kind === 'wipe' && !!r.restorable && !r.undone && r.state !== 'on' })),
        users: users.map(u => ({ id: u._id, name: u.name })), more: rows.length === 60 });
    }

    if (!can(me, 'undo')) return Response.json({ error: 'অনুমতি নেই' }, { status: 403 });
    const a = await acts.findOne({ _id: String(body.id || '') });
    if (!a) return Response.json({ error: 'পাওয়া যায়নি' }, { status: 404 });

    // 🗑 সব মুছে ফেলা line: ফেরান brings the deleted data back (once)
    if (body.op === 'restore' && a.kind === 'wipe') {
      if (a.undone || a.state === 'on') return Response.json({ error: 'আগেই ফেরানো হয়েছে' }, { status: 400 });
      if (!a.snapshot) return Response.json({ error: 'এটা ফেরানো যায় না — ব্যাকআপ ফাইল দিয়ে ফেরত আনুন' }, { status: 400 });
      await restore(db, a.snapshot as Parameters<typeof restore>[1]);
      const t = Date.now();
      await acts.updateOne({ _id: a._id }, { $set: { state: 'on', tts: t }, $push: { toggles: { ts: t, uname: me.name, to: 'on' } } });
      return Response.json({ ok: true, state: 'on', paths: ['*'], gone: [] });
    }

    // মুছুন (take this change out → 'off', red) / ফেরান (put it back → 'on', green), as often as needed
    if (body.op === 'toggle') {
      if (a.kind !== 'data' || !a.path || a.path === '*') return Response.json({ error: 'এটা বদলানো যায় না' }, { status: 400 });
      const flip = async (r: Act) => {
        const off = r.state === 'off' || (!r.state && !!r.undone);
        const to = off ? 'on' : 'off';
        const cur = await getDoc(db, r.path!), now = cur.exists ? cur.data : null;
        const before = r.existed ? (r.before || {}) : null, hasAfter = 'after' in r;
        let next: Data | null; const set: Data = {};
        if (hasAfter) next = to === 'off' ? applyChange(now, r.after ?? null, before) : applyChange(now, before, r.after ?? null);
        else if (to === 'off') { next = before; set.redoDoc = now; }     // older lines (saved before মুছুন/ফেরান): whole record
        else {
          let back = r.redoDoc as Data | null | undefined;
          if (back === undefined && r.undone?.by) back = ((await acts.findOne({ _id: r.undone.by }))?.before as Data | null) ?? undefined;
          if (back === undefined) throw new Error('এটা আর ফেরানো যায় না');
          next = back;
        }
        if (next) await setDoc(db, r.path!, next); else await deleteDoc(db, r.path!);
        const t = Date.now();
        await acts.updateOne({ _id: r._id }, { $set: { ...set, state: to, tts: t }, $unset: { undone: '' }, $push: { toggles: { ts: t, uname: me.name, to } } });
        return { path: r.path!, gone: goneIds(now, next), to };
      };
      const first = await flip(a);
      const paths = [first.path], gone = [...first.gone];
      // a গাড়ি and its company চালান are saved together → they go out / come back together
      if (/^(days|companies)\//.test(a.path)) {
        const wasOff = first.to === 'on';
        const mates = await acts.find({ _id: { $ne: a._id }, kind: 'data', uid: a.uid, ...(a.cid ? { cid: a.cid } : {}),
          ts: { $gte: a.ts - 5000, $lte: a.ts + 5000 }, path: { $regex: /^(days|companies)\// } }).toArray();
        for (const m of mates) {
          const mOff = m.state === 'off' || (!m.state && !!m.undone);
          if (mOff !== wasOff) continue;
          const r = await flip(m); paths.push(r.path); gone.push(...r.gone);
        }
      }
      return Response.json({ ok: true, state: first.to, paths, gone });
    }
    return Response.json({ error: 'bad op' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
