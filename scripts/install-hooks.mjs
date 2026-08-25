/**
 * Installs the pre-commit secret check.
 *
 * Git hooks live in .git/hooks, which is not part of the repository, so a hook
 * cannot simply be committed -- every clone has to install it. Run once after
 * cloning:
 *
 *   node scripts/install-hooks.mjs
 */
import { writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim()
const hooksDir = join(gitDir, 'hooks')
mkdirSync(hooksDir, { recursive: true })

const hookPath = join(hooksDir, 'pre-commit')

const hook = `#!/bin/sh
# Installed by scripts/install-hooks.mjs — do not edit here; edit the script.
#
# Refuses a commit that would put a credential in the repository. Bypassing this
# with --no-verify is possible and sometimes correct, but it should be a decision
# rather than a habit.
node scripts/check-secrets.mjs || exit 1
`

if (existsSync(hookPath)) {
  console.log('  A pre-commit hook already exists; leaving it alone.')
  console.log('  Add this line to it if it is not there:\n')
  console.log('    node scripts/check-secrets.mjs || exit 1\n')
  process.exit(0)
}

writeFileSync(hookPath, hook, { mode: 0o755 })
try {
  chmodSync(hookPath, 0o755)
} catch {
  // Windows ignores the mode; git for Windows runs the hook regardless.
}

console.log(`  Installed ${hookPath}`)
console.log('  Every commit will now be checked for credentials.')
