/**
 * Lets an operator script use the application's own server modules -- the
 * same access policy and reconciliation the site runs -- instead of a copy of
 * their rules. Node 24 runs the TypeScript directly; this resolves the "@/"
 * alias and extensionless imports, and stands in for Next's "server-only"
 * marker, which only guards against bundling into the browser.
 */
import { registerHooks } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"

const SRC = fileURLToPath(new URL("../../src/", import.meta.url))

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (/^next\/[a-z-]+$/.test(specifier)) return next(`${specifier}.js`, context)
    let base = null
    if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2))
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.includes("/src/")) {
      base = join(dirname(fileURLToPath(context.parentURL)), specifier)
    }
    if (base && !/\.[cm]?[jt]sx?$/.test(base)) {
      for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
    return next(specifier, context)
  },
})

/** Imports one module from src/, e.g. loadApp("lib/access-report.ts"). */
export function loadApp(path) {
  return import(pathToFileURL(join(SRC, path)).href)
}

/** Refuses to run without a database, and says which one is being used without printing its credentials. */
export function requireDatabase() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("Set DATABASE_URL. For a preview, use a read-only credential.")
    process.exit(2)
  }
  try {
    const host = new URL(url).hostname
    console.error(`Database host: ${host}`)
  } catch {
    console.error("DATABASE_URL is not a valid URL.")
    process.exit(2)
  }
}

export function flag(name) {
  return process.argv.includes(`--${name}`)
}

export function option(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}
