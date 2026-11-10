import { getMongo } from '@/lib/mongo';
import { login, currentUser, signToken, readToken, cookieHeader, clearCookie, toMe, hashPass, checkPass, seedAdmin, type User } from '@/lib/auth';
import { logAct } from '@/lib/activity';

// GET → who is logged in · POST {op:'login'|'logout'|'password'}
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const db = await getMongo();
    await seedAdmin(db);
    const u = await currentUser(db, req);
    if (!u) return Response.json({ error: 'login' }, { status: 401 });
    // a fresh login (cookie + a copy the page keeps, see 'resume') on every visit → it never runs out while used
    const tok = signToken(u);
    return Response.json({ ...toMe(u), token: tok }, { headers: { 'set-cookie': cookieHeader(tok) } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

// slow down password guessing: after 8 wrong tries for one email+IP, wait 10 minutes
const fails = new Map<string, { n: number; t: number }>();
const locked = (key: string) => { const r = fails.get(key); if (r && Date.now() - r.t > 10 * 60e3) fails.delete(key); return (fails.get(key)?.n || 0) >= 8; };
const failed = (key: string) => { const r = fails.get(key); fails.set(key, { n: (r?.n || 0) + 1, t: r?.t || Date.now() }); };

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const db = await getMongo();
    if (body.op === 'login') {
      const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
      const key = String(body.email || '').trim().toLowerCase() + '|' + ip;
      if (locked(key)) return Response.json({ error: 'অনেকবার ভুল হয়েছে — ১০ মিনিট পরে চেষ্টা করুন' }, { status: 429 });
      const u = await login(db, body.email, body.pass);
      if (!u) { failed(key); return Response.json({ error: 'ইমেইল বা পাসওয়ার্ড ভুল' }, { status: 401 }); }
      fails.delete(key);
      await logAct(db, u, { kind: 'login', action: 'লগইন', label: '🔑 লগইন করেছেন', lines: [u.email] });
      const tok = signToken(u);
      return Response.json({ ok: true, me: toMe(u), token: tok }, { headers: { 'set-cookie': cookieHeader(tok) } });
    }
    // the phone's browser lost the cookie (some in-app browsers do): log in again from the copy the page kept
    if (body.op === 'resume') {
      const t = readToken(String(body.token || ''));
      const u = t && await db.collection<User>('users').findOne({ _id: t.u });
      if (!t || !u || !u.active || u.ver !== t.v) return Response.json({ error: 'login' }, { status: 401 });
      const tok = signToken(u);
      return Response.json({ ok: true, token: tok }, { headers: { 'set-cookie': cookieHeader(tok) } });
    }
    const u = await currentUser(db, req);
    if (body.op === 'logout') {
      if (u) await logAct(db, u, { kind: 'logout', action: 'লগআউট', label: '🚪 বের হয়েছেন', lines: [] });
      return Response.json({ ok: true }, { headers: { 'set-cookie': clearCookie() } });
    }
    if (!u) return Response.json({ error: 'login' }, { status: 401 });
    if (body.op === 'password') {
      if (!checkPass(String(body.old || ''), u.pass)) return Response.json({ error: 'পুরনো পাসওয়ার্ড ভুল' }, { status: 400 });
      const np = String(body.pass || '');
      if (np.length < 4) return Response.json({ error: 'নতুন পাসওয়ার্ড অন্তত ৪ অক্ষর' }, { status: 400 });
      const ver = (u.ver || 1) + 1;
      await db.collection<User>('users').updateOne({ _id: u._id }, { $set: { pass: hashPass(np), ver } });
      await logAct(db, u, { kind: 'user', action: 'পাসওয়ার্ড বদল', label: '🔒 নিজের পাসওয়ার্ড বদলেছেন', lines: [] });
      return Response.json({ ok: true }, { headers: { 'set-cookie': cookieHeader(signToken({ ...u, ver })) } });
    }
    return Response.json({ error: 'bad op' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
