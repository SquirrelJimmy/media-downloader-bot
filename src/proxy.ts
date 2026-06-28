import { NextResponse, type NextRequest } from "next/server";
import {
  consoleSessionCookieName,
  isApiPath,
  isConsoleAuthConfigured,
  isProtectedRequestPath,
  verifyConsoleSession,
} from "@/auth/console-auth";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!isProtectedRequestPath(pathname)) {
    return NextResponse.next();
  }

  if (!isConsoleAuthConfigured()) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: "CONSOLE_PASSWORD is not configured" },
        { status: 503 },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("reason", "not_configured");
    return NextResponse.redirect(loginUrl);
  }

  const token = request.cookies.get(consoleSessionCookieName)?.value;
  if (await verifyConsoleSession(token)) {
    return NextResponse.next();
  }

  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
