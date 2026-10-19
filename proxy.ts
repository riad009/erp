import { NextResponse, type NextRequest } from 'next/server';

// Simple password for the whole site (business data!). Set APP_PASSWORD on Vercel.
// The browser asks once: any user name + this password.
export function proxy(req: NextRequest) {
  const pass = process.env.APP_PASSWORD;
  if (!pass) {
    // no password set: allow on your own computer, block the online API
    if (process.env.NODE_ENV === 'production' && req.nextUrl.pathname.startsWith('/api/'))
      return Response.json({ error: 'APP_PASSWORD is not set' }, { status: 503 });
    return NextResponse.next();
  }
  const auth = req.headers.get('authorization') || '';
  const [scheme, b64] = auth.split(' ');
  if (scheme === 'Basic' && b64) {
    const given = atob(b64).split(':').slice(1).join(':');
    if (given === pass) return NextResponse.next();
  }
  return new Response('পাসওয়ার্ড লাগবে', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="khata", charset="UTF-8"' },
  });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
