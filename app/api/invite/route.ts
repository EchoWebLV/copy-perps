import { NextResponse } from "next/server";
import {
  INVITE_COOKIE_MAX_AGE_SECONDS,
  INVITE_COOKIE_NAME,
  inviteCookieToken,
  isValidInviteCode,
} from "@/lib/invite/gate";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let code = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    if (typeof body.code === "string") code = body.code;
  } catch {
    code = "";
  }

  if (!isValidInviteCode(code)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: INVITE_COOKIE_NAME,
    value: await inviteCookieToken(),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: INVITE_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
