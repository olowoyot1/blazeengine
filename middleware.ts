import { NextResponse, type NextRequest } from 'next/server';

/** First line of defence: unauthenticated requests never reach a page. (Roles are enforced server-side per page/action.) */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const withPath = (res: NextResponse) => { res.headers.set('x-invoke-path', pathname); return res; };
  const isPublic = pathname === '/login' || pathname === '/api/auth' || pathname.startsWith('/api/auth/')
    // Server-to-server integration: authenticated by its own bearer secret, never carries a session cookie.
    || pathname === '/api/integrations/lbl';
  if (isPublic) return withPath(NextResponse.next());
  const token = req.cookies.get('lb_session')?.value;
  // Do not verify JWTs in middleware. Next.js middleware runs on the Edge runtime,
  // while the full session verification (including JWT validation and database
  // re-checks) happens in the Node.js server layer in lib/auth.ts. Keeping the
  // middleware cookie-presence check avoids bundling Node-sensitive jose paths into
  // Edge while preserving server-side authentication enforcement.
  if (token) {
    const headers = new Headers(req.headers); headers.set('x-invoke-path', pathname);
    return NextResponse.next({ request: { headers } });
  }
  if (req.method !== 'GET') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = req.nextUrl.clone(); url.pathname = '/login'; url.search = '';
  return NextResponse.redirect(url);
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
