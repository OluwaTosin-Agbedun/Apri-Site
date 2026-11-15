/**
 * Splits a SQL script into the statements PostgreSQL would run, the way psql
 * does: a semicolon ends a statement only outside comments, quoted strings,
 * quoted identifiers and dollar-quoted bodies ($$ ... $$ or $tag$ ... $tag$).
 *
 * Used by scripts/migrate.mjs (applying db/schema.sql to a database) and by
 * the test database, so both read db/schema.sql the same way. A naive split on
 * every ";" breaks a `do $$ ... $$` block or a function body into pieces.
 *
 * Returns each statement's text (comments kept, surrounding blank space
 * trimmed), without the terminating semicolon. Comment-only fragments are
 * dropped. Pure: no I/O.
 */
export function splitSqlStatements(text) {
  const statements = []
  let start = 0
  let i = 0
  const n = text.length

  const push = (end) => {
    const statement = text.slice(start, end).trim()
    if (stripSqlComments(statement).trim()) statements.push(statement)
  }

  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '-' && next === '-') {
      const eol = text.indexOf('\n', i)
      i = eol === -1 ? n : eol + 1
    } else if (c === '/' && next === '*') {
      // PostgreSQL block comments nest.
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') { depth++; i += 2 }
        else if (text[i] === '*' && text[i + 1] === '/') { depth--; i += 2 }
        else i++
      }
    } else if (c === "'" || c === '"') {
      // '' (or "") inside the quotes is an escaped quote, not the end.
      i++
      while (i < n) {
        if (text[i] === c && text[i + 1] === c) i += 2
        else if (text[i] === c) { i++; break }
        else i++
      }
    } else if (c === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(text.slice(i, i + 64))
      if (tag) {
        const close = text.indexOf(tag[0], i + tag[0].length)
        if (close === -1) throw new Error(`Unterminated dollar-quoted string starting with ${tag[0]}`)
        i = close + tag[0].length
      } else {
        i++ // a positional parameter such as $1
      }
    } else if (c === ';') {
      push(i)
      i++
      start = i
    } else {
      i++
    }
  }
  push(n)
  return statements
}

/** The statement without -- line comments, for labels and emptiness checks. */
export function stripSqlComments(statement) {
  return statement.replace(/--.*$/gm, '')
}
