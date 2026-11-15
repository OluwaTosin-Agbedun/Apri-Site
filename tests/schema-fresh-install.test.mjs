/**
 * A new database is built by `pnpm db:migrate` (scripts/migrate.mjs), which
 * applies db/schema.sql statement by statement. These tests check that the
 * statement splitter reads SQL the way psql does, and that every statement in
 * db/schema.sql applies to an empty PostgreSQL (PGlite) in order -- so a fresh
 * install does not stop part-way, for example on a `do $$ ... $$` block that a
 * naive split on ";" would cut into pieces.
 *
 * In-memory database only: nothing here reads DATABASE_URL.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { splitSqlStatements, stripSqlComments } from "../scripts/lib/sql-statements.mjs"

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

describe("the SQL statement splitter", () => {
  it("ends a statement only at a semicolon outside comments, quotes and dollar-quoted bodies", () => {
    const sql = [
      "select 1;",
      "-- a comment; with a semicolon",
      "select $$a;b$$;",
      "select $fn$ x; $$ y; $fn$;",
      "select 'it''s; fine';",
      "/* outer; /* nested; */ still comment; */ select \"odd;name\" from t;",
      "do $$ begin if true then perform 1; end if; end $$;",
      "select $1",
    ].join("\n")
    assert.deepEqual(splitSqlStatements(sql).map((s) => stripSqlComments(s).trim()), [
      "select 1",
      "select $$a;b$$",
      "select $fn$ x; $$ y; $fn$",
      "select 'it''s; fine'",
      "/* outer; /* nested; */ still comment; */ select \"odd;name\" from t",
      "do $$ begin if true then perform 1; end if; end $$",
      "select $1",
    ])
  })

  it("drops comment-only fragments and refuses an unterminated dollar quote", () => {
    assert.deepEqual(splitSqlStatements("-- only a comment\n;\n  ;"), [])
    assert.throws(() => splitSqlStatements("do $$ begin"), /Unterminated dollar-quoted string/)
  })

  it("splits every migration file without error", async () => {
    const { readdirSync } = await import("node:fs")
    for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((f) => f.endsWith(".sql"))) {
      assert.ok(splitSqlStatements(read(`db/migrations/${file}`)).length > 0, file)
    }
  })

  it("is what scripts/migrate.mjs uses, rather than a naive split on every semicolon", () => {
    const migrate = read("scripts/migrate.mjs")
    assert.match(migrate, /import \{ splitSqlStatements, stripSqlComments \} from '\.\/lib\/sql-statements\.mjs'/)
    assert.match(migrate, /const statements = splitSqlStatements\(schema\)/)
    assert.doesNotMatch(migrate, /\.split\(';'\)/)
  })
})

describe("a fresh install from db/schema.sql", () => {
  it("applies every statement, in order, to an empty database", async () => {
    const db = new PGlite()
    try {
      const statements = splitSqlStatements(read("db/schema.sql"))
      assert.ok(statements.length > 100, "the schema is read as many statements")
      let applied = 0
      for (const statement of statements) {
        const code = stripSqlComments(statement).replace(/\s+/g, " ").trim()
        // pgcrypto is not bundled with PGlite; gen_random_uuid() is built into
        // PostgreSQL 13+, so the schema does not depend on it. Nothing else may fail.
        if (/^create extension if not exists pgcrypto$/.test(code)) continue
        try {
          await db.exec(statement)
          applied++
        } catch (error) {
          assert.fail(`db/schema.sql statement ${applied + 1} failed: "${code.slice(0, 100)}": ${error.message}`)
        }
      }
      const tables = (await db.query(`select table_name from information_schema.tables where table_schema = 'public'`)).rows.map((r) => r.table_name)
      for (const table of ["admins", "documents", "subscribers", "review_publication_editions", "auth_tokens", "link_findings"]) {
        assert.ok(tables.includes(table), `${table} exists after a fresh install`)
      }
      // Applying the schema a second time is safe (every statement is "if not exists" or guarded).
      for (const statement of statements) {
        const code = stripSqlComments(statement).replace(/\s+/g, " ").trim()
        if (/^create extension if not exists pgcrypto$/.test(code)) continue
        await db.exec(statement)
      }
    } finally {
      await db.close()
    }
  })
})
