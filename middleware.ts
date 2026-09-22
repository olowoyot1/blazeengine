import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/** First line of defence: unauthenticated requests never reach a page. (Roles are enforced server-side per page/action.) */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const withPath = (res: NextResponse) => { res.headers.set('x-invoke-path', pathname); return res; };
  if (pathname === '/login' || pathname.startsWith('/api/auth')) return withPath(NextResponse.next());
  const token = req.cookies.get('lb_session')?.value;
  const raw = process.env.AUTH_SECRET;
  const secret = new TextEncoder().encode(raw && raw.length >= 32 ? raw : 'dev-only-secret-change-me-dev-only-secret');
  if (token) {
    try {
      await jwtVerify(token, secret);
      const headers = new Headers(req.headers); headers.set('x-invoke-path', pathname);
      return NextResponse.next({ request: { headers } });
    } catch { /* fall through */ }
  }
  if (req.method !== 'GET') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = req.nextUrl.clone(); url.pathname = '/login'; url.search = '';
  return NextResponse.redirect(url);
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
