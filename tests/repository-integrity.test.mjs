/**
 * The repository must clone and check out with plain Git. Git LFS is not
 * used: four font pointers committed without their objects (commit d004268)
 * once made every clone, CI run and the upstream sync fail with
 * "404 Object does not exist on the server". These checks stop an LFS rule
 * or a pointer file from coming back.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const POINTER = "version https://git-lfs.github.com/spec/v1"

// Every file Git tracks, read from the index so untracked build output and
// node_modules are never scanned.
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)

function startsWithPointer(path) {
  let stat
  try {
    stat = statSync(new URL(`../${path}`, import.meta.url))
  } catch {
    return false // listed in the index but deleted in this working tree
  }
  // An LFS pointer is a small text file; nothing large can be one.
  if (!stat.isFile() || stat.size > 1024) return false
  const fd = openSync(new URL(`../${path}`, import.meta.url), "r")
  try {
    const head = Buffer.alloc(POINTER.length)
    readSync(fd, head, 0, POINTER.length, 0)
    return head.toString("utf8") === POINTER
  } finally {
    closeSync(fd)
  }
}

describe("repository integrity", () => {
  it("routes no file type into Git LFS", () => {
    const rules = readFileSync(new URL("../.gitattributes", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("#") && /filter=lfs/.test(line))
    assert.deepEqual(rules, [], "an LFS rule in .gitattributes turns the next binary commit into a pointer")
  })

  it("tracks no Git LFS pointer file", () => {
    const pointers = tracked.filter(startsWithPointer)
    assert.deepEqual(
      pointers,
      [],
      "commit the real file instead: an LFS pointer whose object is missing breaks every clone",
    )
  })

  it("has no local font the layout depends on that is missing from the repository", () => {
    const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8")
    for (const [, path] of layout.matchAll(/path:\s*['"]\.\/([^'"]+)['"]/g)) {
      assert.ok(tracked.includes(`src/app/${path}`), `src/app/${path} is committed`)
      assert.ok(!startsWithPointer(`src/app/${path}`), `src/app/${path} is a real font, not a pointer`)
    }
  })
})
