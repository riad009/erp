import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE, readToken } from '@/lib/auth';

// Login guard: no valid login cookie → pages go to /login, API calls get 401.
// (Each API route also checks the user in the database.)
export function proxy(req: NextRequest) {
  if (readToken(req.cookies.get(COOKIE)?.value)) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith('/api/')) return Response.json({ error: 'login' }, { status: 401 });
  const to = new URL('/login', req.url);
  if (pathname !== '/') to.searchParams.set('next', pathname + search);
  return NextResponse.redirect(to);
}

export const config = {
  // everything except the login page, login API, the nightly email call and Next's own files
  matcher: ['/((?!login|api/auth|api/cron|_next/|favicon\\.ico).*)'],
};
