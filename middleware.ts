import { NextResponse, type NextRequest } from "next/server";
import {
  INVITE_COOKIE_NAME,
  inviteCookieToken,
  isGatedPath,
} from "@/lib/invite/gate";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isGatedPath(pathname)) return NextResponse.next();

  const cookie = request.cookies.get(INVITE_COOKIE_NAME)?.value;
  if (cookie && cookie === (await inviteCookieToken())) {
    return NextResponse.next();
  }

  // API calls get a clean 401 rather than an HTML redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "invite_required" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/invite";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals; the precise allowlist (health,
  // cron, invite screen + API, static files) lives in isGatedPath().
  matcher: ["/((?!_next/static|_next/image).*)"],
};
