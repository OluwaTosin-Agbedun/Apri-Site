/**
 * Refuses a commit that would put a credential in the repository.
 *
 * Runs against what is *staged*, not the working tree: the working tree
 * legitimately holds .env.local, and scanning it would fail every commit.
 *
 *   node scripts/check-secrets.mjs            # staged changes (pre-commit)
 *   node scripts/check-secrets.mjs --all      # every tracked file
 *
 * Installed as a git hook by scripts/install-hooks.mjs. Hooks live in .git and
 * are not themselves committed, so the check lives here where it can be shared,
 * reviewed and run in CI.
 */
import { execSync } from 'node:child_process'

const ALL = process.argv.includes('--all')

/**
 * Patterns for credentials this project actually uses, plus the generic shapes.
 *
 * Deliberately specific. A rule that matches the word "password" or any long
 * base64 string fires on documentation, test fixtures and lockfile hashes, and a
 * check that cries wolf is one people learn to bypass with --no-verify.
 */
const PATTERNS = [
  { name: 'Neon/Postgres password', re: /npg_[A-Za-z0-9]{12,}/ },
  {
    name: 'Postgres connection string with credentials',
    re: /postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]{6,}@/,
  },
  { name: 'Papermark API token', re: /pm_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{20,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  {
    name: 'Assigned secret in a committed file',
    // KEY="value" where the key names a secret and the value is not empty and
    // not an obvious placeholder.
    re: /\b(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z_]*\s*[:=]\s*["'](?!$|\s|your|xxx|placeholder|changeme|<)[^"']{8,}["']/i,
  },
]

/** Files that may legitimately contain a secret-shaped string. */
const ALLOWED = [
  /^scripts\/check-secrets\.mjs$/, // the patterns themselves
  /^pnpm-lock\.yaml$/, // integrity hashes
  /^package-lock\.json$/,
]

/** Any .env file other than the placeholder example must never be committed. */
function isForbiddenEnvFile(path) {
  return /(^|\/)\.env($|\.)/.test(path) && !/\.env\.example$/.test(path)
}

function stagedFiles() {
  const out = execSync(
    ALL
      ? 'git ls-files'
      : 'git diff --cached --name-only --diff-filter=ACM',
    { encoding: 'utf8' }
  )
  return out.split('\n').map((l) => l.trim()).filter(Boolean)
}

function contentOf(path) {
  try {
    return ALL
      ? execSync(`git show HEAD:"${path}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
      : execSync(`git show :"${path}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

const files = stagedFiles()
const findings = []

for (const file of files) {
  if (isForbiddenEnvFile(file)) {
    findings.push({ file, name: 'Environment file staged for commit', line: 0 })
    continue
  }

  if (ALLOWED.some((re) => re.test(file))) continue
  // Binary and lock-like files are skipped; a credential in one would be a
  // different kind of accident and this check would only produce noise.
  if (/\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|eot|zip|gz)$/i.test(file)) continue

  const content = contentOf(file)
  if (!content) continue

  const lines = content.split('\n')
  for (const { name, re } of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        findings.push({ file, name, line: i + 1 })
        break // one finding per pattern per file is enough to stop the commit
      }
    }
  }
}

if (findings.length === 0) {
  console.log(`  No credentials found in ${files.length} file(s).`)
  process.exit(0)
}

// The matched text is never printed. Echoing a live credential into a terminal
// puts it into scrollback, shell history and any CI log that captured it.
console.error('\n  COMMIT REFUSED — possible credentials found:\n')
for (const f of findings) {
  console.error(`    ${f.file}${f.line ? `:${f.line}` : ''}  ${f.name}`)
}
console.error(
  '\n  The matched values are not shown on purpose.\n' +
    '  Move the value into .env.local (git-ignored) and reference it via process.env.\n' +
    '  If this is genuinely a false positive, add the file to ALLOWED in\n' +
    '  scripts/check-secrets.mjs with a comment saying why.\n'
)
process.exit(1)
