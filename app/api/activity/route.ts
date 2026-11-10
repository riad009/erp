import { getMongo } from '@/lib/mongo';
import { currentUser, can, type User } from '@/lib/auth';
import { setDoc, deleteDoc, getDoc } from '@/lib/store';
import { logAct, describe, type Act } from '@/lib/activity';

// the activity list: {op:'list'} · {op:'undo', id} · {op:'delete', id}
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Data = Record<string, unknown>;
const ids = (d: Data | null | undefined, k: string) => ((d?.[k] as Data[]) || []).map(x => String(x.id));

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
      if (body.kind === 'data') q.kind = { $in: ['data', 'undo', 'import'] };
      else if (body.kind === 'other') q.kind = { $nin: ['data', 'undo', 'import'] };
      if (body.date) { const s = new Date(body.date + 'T00:00:00+06:00').getTime(); q.ts = { $gte: s, $lt: s + 864e5 }; }
      if (body.before) q.ts = { ...(q.ts as object || {}), $lt: Number(body.before) };
      const rows = await acts.find(q, { projection: { before: 0 } }).sort({ ts: -1 }).limit(60).toArray();
      const users = await db.collection<User>('users').find({}, { projection: { name: 1 } }).toArray();
      return Response.json({ rows: rows.map(r => ({ ...r, canUndo: (r.kind === 'data' || r.kind === 'undo') && !r.undone })), users: users.map(u => ({ id: u._id, name: u.name })), more: rows.length === 60 });
    }

    if (!can(me, 'undo')) return Response.json({ error: 'অনুমতি নেই' }, { status: 403 });
    const a = await acts.findOne({ _id: String(body.id || '') });
    if (!a) return Response.json({ error: 'পাওয়া যায়নি' }, { status: 404 });

    if (body.op === 'delete') {
      await acts.deleteOne({ _id: a._id });
      return Response.json({ ok: true });
    }

    if (body.op === 'undo') {
      if ((a.kind !== 'data' && a.kind !== 'undo') || !a.path) return Response.json({ error: 'এটা ফেরানো যায় না' }, { status: 400 });
      if (a.undone) return Response.json({ error: 'আগেই ফেরানো হয়েছে' }, { status: 400 });
      // later changes on the same record would be undone too → ask first
      const laterQ = { path: a.path, ts: { $gt: a.ts }, kind: { $in: ['data', 'undo'] }, undone: { $exists: false } } as const;
      const later = await acts.countDocuments(laterQ);
      if (later && !body.confirm) return Response.json({ needConfirm: later });
      const cur = await getDoc(db, a.path), now = cur.exists ? cur.data : null;
      const back = a.existed ? (a.before || {}) : null;
      if (back) await setDoc(db, a.path, back); else await deleteDoc(db, a.path);
      // entries that disappear with this undo: the app must not offer to "upload" them again from its old copy
      const gone = [...ids(now, 'entries').filter(x => !ids(back, 'entries').includes(x)), ...(!back && now?.id ? [String(now.id)] : [])];
      const d = describe(a.path, now, back);
      const mark = { $set: { undone: { ts: Date.now(), uname: me.name } } };
      await acts.updateMany(laterQ, mark);
      await acts.updateOne({ _id: a._id }, mark);
      await logAct(db, me, { kind: 'undo', action: 'ফেরানো', label: '↶ ফেরানো — ' + a.label, lines: d.lines, path: a.path, before: now, existed: cur.exists });
      return Response.json({ ok: true, gone, later });
    }
    return Response.json({ error: 'bad op' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
