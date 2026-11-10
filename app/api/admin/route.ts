import { randomBytes } from 'node:crypto';
import { getMongo } from '@/lib/mongo';
import { currentUser, hashPass, cleanPerms, FEATURES, type User } from '@/lib/auth';
import { logAct } from '@/lib/activity';
import { getCfg, saveCfg, sendDaily } from '@/lib/report';

// super admin only: users + their permissions, the nightly email
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const label = (perms: string[]) => perms.map(p => FEATURES.find(f => f[0] === p)?.[1] || p).join(', ') || 'কিছুই না';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const db = await getMongo();
    const me = await currentUser(db, req);
    if (!me) return Response.json({ error: 'login' }, { status: 401 });
    if (me.role !== 'admin') return Response.json({ error: 'শুধু সুপার অ্যাডমিন' }, { status: 403 });
    const users = db.collection<User>('users');

    switch (body.op) {
      case 'users': {
        const list = await users.find({}, { projection: { pass: 0 } }).sort({ created: 1 }).toArray();
        return Response.json({ users: list.map(u => ({ id: u._id, email: u.email, name: u.name, role: u.role, perms: u.perms || [], active: u.active, created: u.created })), features: FEATURES });
      }
      case 'saveUser': {
        const u = body.user || {};
        const email = String(u.email || '').trim().toLowerCase(), name = String(u.name || '').trim(), pass = String(u.pass || '');
        if (!EMAIL.test(email)) return Response.json({ error: 'ইমেইল ঠিক নেই' }, { status: 400 });
        if (!name) return Response.json({ error: 'নাম দিন' }, { status: 400 });
        const clash = await users.findOne({ email, _id: { $ne: String(u.id || '') } });
        if (clash) return Response.json({ error: 'এই ইমেইলে আগেই ইউজার আছে' }, { status: 400 });
        const perms = cleanPerms(u.perms);
        if (!u.id) {
          if (pass.length < 4) return Response.json({ error: 'পাসওয়ার্ড অন্তত ৪ অক্ষর' }, { status: 400 });
          const nu: User = { _id: 'u' + randomBytes(6).toString('hex'), email, name, pass: hashPass(pass), role: 'user', perms, active: true, ver: 1, created: Date.now() };
          await users.insertOne(nu);
          await logAct(db, me, { kind: 'user', action: 'নতুন ইউজার', label: '👤 ইউজার তৈরি: ' + name, lines: [email, 'দেখতে পারবে: ' + label(perms)] });
          return Response.json({ ok: true, id: nu._id });
        }
        const old = await users.findOne({ _id: String(u.id) });
        if (!old) return Response.json({ error: 'ইউজার নেই' }, { status: 404 });
        const isSelf = old._id === me._id;
        const set: Partial<User> = { email, name };
        if (old.role !== 'admin') { set.perms = perms; set.active = u.active !== false; }
        const lines: string[] = [];
        if (old.email !== email) lines.push(`ইমেইল: ${old.email} → ${email}`);
        if (old.name !== name) lines.push(`নাম: ${old.name} → ${name}`);
        if (set.perms && JSON.stringify(old.perms || []) !== JSON.stringify(perms)) lines.push('দেখতে পারবে: ' + label(perms));
        if (set.active !== undefined && set.active !== old.active) lines.push(set.active ? 'চালু করা হয়েছে' : 'বন্ধ করা হয়েছে');
        // new password or switched off → that user's open logins end
        if (pass) {
          if (pass.length < 4) return Response.json({ error: 'পাসওয়ার্ড অন্তত ৪ অক্ষর' }, { status: 400 });
          set.pass = hashPass(pass); lines.push('পাসওয়ার্ড বদলানো হয়েছে');
        }
        if (pass || set.active === false) set.ver = (old.ver || 1) + 1;
        await users.updateOne({ _id: old._id }, { $set: set });
        if (lines.length) await logAct(db, me, { kind: 'user', action: 'ইউজার বদল', label: '👤 ইউজার: ' + name, lines });
        return Response.json({ ok: true, relogin: isSelf && !!pass });
      }
      case 'deleteUser': {
        const old = await users.findOne({ _id: String(body.id || '') });
        if (!old) return Response.json({ error: 'ইউজার নেই' }, { status: 404 });
        if (old.role === 'admin') return Response.json({ error: 'সুপার অ্যাডমিন মোছা যাবে না' }, { status: 400 });
        await users.deleteOne({ _id: old._id });
        await logAct(db, me, { kind: 'user', action: 'ইউজার মোছা', label: '👤 ইউজার মুছে ফেলা: ' + old.name, lines: [old.email] });
        return Response.json({ ok: true });
      }
      case 'email': {
        const c = await getCfg(db);
        return Response.json({ enabled: c.enabled, to: c.to, from: c.from, hasPass: !!c.appPass, lastSent: c.lastSent || null, envSmtp: !!(process.env.SMTP_USER && process.env.SMTP_PASS) });
      }
      case 'saveEmail': {
        const to = (Array.isArray(body.to) ? body.to : []).map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean);
        const bad = to.find((x: string) => !EMAIL.test(x));
        if (bad) return Response.json({ error: 'ইমেইল ঠিক নেই: ' + bad }, { status: 400 });
        const from = String(body.from || '').trim().toLowerCase();
        if (from && !EMAIL.test(from)) return Response.json({ error: 'পাঠানোর ইমেইল ঠিক নেই' }, { status: 400 });
        const c: Record<string, unknown> = { enabled: !!body.enabled, to, from };
        if (body.appPass) c.appPass = String(body.appPass).replace(/\s+/g, '');
        await saveCfg(db, c);
        await logAct(db, me, { kind: 'email', action: 'ইমেইল সেটিং', label: '✉️ দিনের ইমেইল সেটিং', lines: [(body.enabled ? 'চালু' : 'বন্ধ') + ' · ' + (to.join(', ') || 'কোনো ইমেইল নেই')] });
        return Response.json({ ok: true });
      }
      case 'sendNow':
        return Response.json(await sendDaily(db, { force: true, who: me }));
      default:
        return Response.json({ error: 'bad op' }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
