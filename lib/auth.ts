import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Db } from 'mongodb';

// Login: users live in the `users` collection. The browser keeps a signed cookie
// (user id + version + expiry); every API call re-checks the user in the database,
// so a disabled user or a changed password ends old logins at once.

export const COOKIE = 'khata_s';
const DAYS = 365;   // stay logged in (owner: "never ask again and again"); renewed on every visit

// every tab the owner can switch on / off per user (+ the activity list and its undo)
export const FEATURES: [string, string][] = [
  ['stock', 'স্টক'], ['amdani', 'দৈনিক'], ['memo', 'মেমো'], ['ledger', 'খতিয়ান'], ['baki', 'বাকি লিস্ট'],
  ['company', 'কোম্পানি'], ['labour', 'লেবার'], ['dash', 'ড্যাশবোর্ড'], ['settings', 'সেটিং'],
  ['activity', 'অ্যাক্টিভিটি দেখা'], ['undo', 'অ্যাক্টিভিটি ফেরানো / মোছা'],
];
const FEATURE_IDS = FEATURES.map(f => f[0]);

export type User = { _id: string; email: string; name: string; pass: string; role: 'admin' | 'user'; perms: string[]; active: boolean; ver: number; created: number };
export type Me = { id: string; email: string; name: string; role: 'admin' | 'user'; perms: string[] };

// AUTH_SECRET if set on Vercel, else derived from MONGO_URI (already a secret there)
function secret() {
  const s = process.env.AUTH_SECRET || process.env.MONGO_URI;
  if (!s) throw new Error('AUTH_SECRET / MONGO_URI is not set');
  return createHash('sha256').update('khata-auth:' + s).digest();
}

export function hashPass(p: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(p, salt, 32).toString('hex');
}
function checkPass(p: string, stored: string) {
  const [salt, h] = String(stored || '').split(':');
  if (!salt || !h) return false;
  const a = scryptSync(p, salt, 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export function signToken(u: User) {
  const body = b64(JSON.stringify({ u: u._id, v: u.ver, e: Date.now() + DAYS * 864e5 }));
  return body + '.' + b64(createHmac('sha256', secret()).update(body).digest());
}
export function readToken(tok: string | undefined): { u: string; v: number; e: number } | null {
  if (!tok) return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const want = createHmac('sha256', secret()).update(body).digest(), got = Buffer.from(sig, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString());
    return t && t.e > Date.now() ? t : null;
  } catch { return null; }
}
export const cookieHeader = (tok: string) => `${COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

const cookieOf = (req: Request) => (req.headers.get('cookie') || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);

// the first super admin (the owner's choice); change the password in the app afterwards
const SEED = { email: 'admin@gmail.com', pass: '1234', name: 'সুপার অ্যাডমিন' };
const g = globalThis as unknown as { __khataSeed?: Promise<void> };
export function seedAdmin(db: Db) {
  if (!g.__khataSeed) g.__khataSeed = (async () => {
    const users = db.collection<User>('users');
    if (await users.countDocuments({}, { limit: 1 })) return;
    await users.insertOne({ _id: 'admin', email: SEED.email, name: SEED.name, pass: hashPass(SEED.pass), role: 'admin', perms: FEATURE_IDS, active: true, ver: 1, created: Date.now() });
  })().catch(e => { g.__khataSeed = undefined; throw e; });
  return g.__khataSeed;
}

export const toMe = (u: User): Me => ({ id: u._id, email: u.email, name: u.name, role: u.role, perms: u.role === 'admin' ? FEATURE_IDS : (u.perms || []).filter(p => FEATURE_IDS.includes(p)) });

export async function login(db: Db, email: string, pass: string): Promise<User | null> {
  await seedAdmin(db);
  const u = await db.collection<User>('users').findOne({ email: String(email || '').trim().toLowerCase() });
  if (!u || !u.active || !checkPass(String(pass || ''), u.pass)) return null;
  return u;
}

// the logged-in user of this request, or null
export async function currentUser(db: Db, req: Request): Promise<User | null> {
  const t = readToken(cookieOf(req));
  if (!t) return null;
  const u = await db.collection<User>('users').findOne({ _id: t.u });
  return u && u.active && u.ver === t.v ? u : null;
}

export const can = (u: User, perm: string) => u.role === 'admin' || (u.perms || []).includes(perm);
export const cleanPerms = (p: unknown) => (Array.isArray(p) ? p : []).map(String).filter(x => FEATURE_IDS.includes(x));
export { checkPass };
