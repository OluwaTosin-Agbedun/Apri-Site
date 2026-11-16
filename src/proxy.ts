import type { NextRequest } from "next/server"
import handleRequest from "../proxy"

// Next discovers proxy beside src/app, not in the repository root when app
// lives under src. Keep the existing tested implementation in ../proxy so
// the Stage 4 security work and this branch share the same request boundary.
export default function proxy(request: NextRequest) {
  return handleRequest(request)
}

// Next must statically read this literal; it cannot follow a re-export.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|opengraph-image).*)"],
}
