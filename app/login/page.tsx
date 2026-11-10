'use client';
import { useState } from 'react';

// লগইন: ইমেইল + পাসওয়ার্ড → /api/auth → back to the app (or the page that was asked for)
export default function Login() {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'login', email, pass }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'লগইন হয়নি');
      const next = new URLSearchParams(location.search).get('next') || '';
      location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/khata/index.html';
    } catch (x) {
      setErr((x as Error).message === 'Failed to fetch' ? 'ইন্টারনেট দেখুন' : (x as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="lg">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700;800&family=Tiro+Bangla&display=swap" rel="stylesheet" />
      <style>{`
        .lg{min-height:100dvh;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;background:linear-gradient(160deg,#EEF3FB 0%,#F7F9FC 55%,#EAF4EE 100%);font-family:"Noto Sans Bengali","Hind Siliguri",system-ui,sans-serif;color:#1B2347}
        .lg *{box-sizing:border-box}
        .card{width:100%;max-width:400px;background:#fff;border:1px solid #DCE3EE;border-radius:18px;padding:28px 24px 24px;box-shadow:0 18px 50px -24px rgba(31,74,168,.35)}
        .brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}
        .logo{width:46px;height:46px;border-radius:12px;background:#1F4AA8;color:#fff;display:grid;place-items:center;font-size:24px;flex:none}
        .brand b{display:block;font-family:"Tiro Bangla",serif;font-size:19px;line-height:1.3}
        .brand small{color:#66728A;font-size:13px}
        h1{font-size:20px;margin:0 0 4px}
        .sub{margin:0 0 18px;color:#66728A;font-size:14px}
        label{display:block;font-size:13.5px;font-weight:700;margin:12px 0 6px}
        .in{position:relative}
        input{width:100%;padding:12px 14px;font-size:16px;border:1.5px solid #CFD8E6;border-radius:11px;background:#FAFBFD;color:#1B2347;font-family:inherit;outline:none}
        input:focus{border-color:#1F4AA8;background:#fff;box-shadow:0 0 0 3px rgba(31,74,168,.12)}
        .eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:none;font-size:13px;font-weight:700;color:#1F4AA8;padding:8px;cursor:pointer;font-family:inherit}
        .go{width:100%;margin-top:20px;padding:13px;border:0;border-radius:11px;background:#1F4AA8;color:#fff;font-size:16.5px;font-weight:800;font-family:inherit;cursor:pointer}
        .go:disabled{opacity:.6;cursor:wait}
        .err{margin:14px 0 0;padding:10px 12px;border-radius:10px;background:#FFF1F3;border:1px solid #F3B8C2;color:#A0182E;font-size:14px;font-weight:700}
        .foot{margin:16px 0 0;text-align:center;color:#8A94A8;font-size:12.5px}
      `}</style>
      <form className="card" onSubmit={submit}>
        <div className="brand">
          <div className="logo" aria-hidden="true">📒</div>
          <div><b>কাজী রোমান এন্ড ব্রাদার্স</b><small>হিসাব খাতা</small></div>
        </div>
        <h1>লগইন করুন</h1>
        <p className="sub">আপনার ইমেইল আর পাসওয়ার্ড দিন</p>
        <label htmlFor="em">ইমেইল</label>
        <input id="em" type="email" autoComplete="username" inputMode="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="name@gmail.com" autoFocus />
        <label htmlFor="pw">পাসওয়ার্ড</label>
        <div className="in">
          <input id="pw" type={show ? 'text' : 'password'} autoComplete="current-password" required value={pass} onChange={e => setPass(e.target.value)} style={{ paddingRight: 70 }} />
          <button type="button" className="eye" onClick={() => setShow(!show)}>{show ? 'লুকান' : 'দেখুন'}</button>
        </div>
        {err && <p className="err" role="alert">⚠️ {err}</p>}
        <button className="go" disabled={busy}>{busy ? 'ঢুকছে…' : 'লগইন'}</button>
        <p className="foot">পাসওয়ার্ড ভুলে গেলে সুপার অ্যাডমিনকে বলুন</p>
      </form>
    </main>
  );
}
