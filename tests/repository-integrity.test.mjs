/**
 * The repository must clone and check out with plain Git. Git LFS is not
 * used: four font pointers committed without their objects (commit d004268)
 * made every LFS-enabled clone, including the downstream sync, fail with
 * "404 Object does not exist on the server". These checks stop an LFS rule
 * or a pointer file from coming back.
 *
 * Everything is read from Git's index, not the working tree: an LFS smudge
 * filter can replace a committed pointer on disk with the real file, which
 * would hide it from a check that reads the disk.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { posix } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const POINTER = "version https://git-lfs.github.com/spec/v1"
// An LFS pointer is a small text file; nothing larger can be one.
const POINTER_MAX_BYTES = 1024

function git(args, input) {
  try {
    return execFileSync("git", args, { cwd: ROOT, input, maxBuffer: 256 * 1024 * 1024 })
  } catch (error) {
    throw new Error(`These checks need a Git checkout; "git ${args.join(" ")}" failed: ${error.message}`)
  }
}

// Every tracked blob with its object id, from the index. Submodules (mode
// 160000) are commits, not blobs, and are skipped.
const entries = git(["ls-files", "-s", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .map((line) => {
    const tab = line.indexOf("\t")
    const [mode, oid] = line.slice(0, tab).split(" ")
    return { mode, oid, path: line.slice(tab + 1) }
  })
  .filter((e) => e.mode !== "160000")
const byPath = new Map(entries.map((e) => [e.path, e]))

/** The contents of the given blobs, read in one batch from Git's object store. */
function readBlobs(oids) {
  const unique = [...new Set(oids)]
  const out = new Map()
  if (unique.length === 0) return out
  const buf = git(["cat-file", "--batch"], unique.join("\n") + "\n")
  let at = 0
  while (at < buf.length) {
    const eol = buf.indexOf(0x0a, at)
    const [oid, , size] = buf.subarray(at, eol).toString("utf8").split(" ")
    const start = eol + 1
    out.set(oid, buf.subarray(start, start + Number(size)))
    at = start + Number(size) + 1
  }
  return out
}

/** Tracked paths whose committed content is an LFS pointer. */
function pointerPaths() {
  const sizes = git(["cat-file", "--batch-check=%(objectname) %(objectsize)"], entries.map((e) => e.oid).join("\n") + "\n")
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" "))
  const small = new Set(sizes.filter(([, size]) => Number(size) <= POINTER_MAX_BYTES).map(([oid]) => oid))
  const blobs = readBlobs([...small])
  return entries
    .filter((e) => small.has(e.oid) && blobs.get(e.oid)?.subarray(0, POINTER.length).toString("utf8") === POINTER)
    .map((e) => e.path)
}

describe("repository integrity", () => {
  it("routes no file type into Git LFS, in any .gitattributes", () => {
    const attributeFiles = entries.filter((e) => posix.basename(e.path) === ".gitattributes")
    assert.ok(attributeFiles.some((e) => e.path === ".gitattributes"), "the root .gitattributes is tracked")
    const blobs = readBlobs(attributeFiles.map((e) => e.oid))
    const rules = attributeFiles.flatMap((e) =>
      blobs
        .get(e.oid)
        .toString("utf8")
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("#") && /filter=lfs/.test(line))
        .map((line) => `${e.path}: ${line.trim()}`),
    )
    assert.deepEqual(rules, [], "an LFS rule turns the next binary commit into a pointer")
    assert.ok(!byPath.has(".lfsconfig"), "no .lfsconfig is tracked")
  })

  it("tracks no Git LFS pointer file", () => {
    assert.deepEqual(
      pointerPaths(),
      [],
      "commit the real file instead: an LFS pointer whose object is missing breaks every LFS-enabled clone",
    )
  })

  it("commits every local font the app declares, as a real file", () => {
    const pointers = new Set(pointerPaths())
    const sources = entries.filter((e) => /^src\/.*\.(ts|tsx|css)$/.test(e.path))
    const blobs = readBlobs(sources.map((e) => e.oid))
    const fontRef = /(?:src|path)\s*:\s*['"](\.{1,2}\/[^'"]+\.(?:woff2?|ttf|otf|eot))['"]|url\(\s*['"]?(\.{1,2}\/[^'")]+\.(?:woff2?|ttf|otf|eot))/g
    for (const source of sources) {
      for (const match of blobs.get(source.oid).toString("utf8").matchAll(fontRef)) {
        const font = posix.normalize(posix.join(posix.dirname(source.path), match[1] ?? match[2]))
        assert.ok(byPath.has(font), `${font}, declared in ${source.path}, is committed`)
        assert.ok(!pointers.has(font), `${font} is a real font, not an LFS pointer`)
      }
    }
  })
})
