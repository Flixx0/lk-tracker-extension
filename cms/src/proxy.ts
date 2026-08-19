import { NextRequest, NextResponse } from "next/server";
import { authEnabled, isValidSession, SESSION_COOKIE } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";
  const isAuthApi = pathname === "/api/auth";
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const ok = await isValidSession(token);

  if (ok && isLogin) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (!ok && !isLogin && !isAuthApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
