import { defineConfig,globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
export default defineConfig([
  ...nextVitals,
  // Approved editorial copy contains ordinary apostrophes. React escapes text;
  // changing its source spelling is not an accessibility/security improvement.
  {rules:{"react/no-unescaped-entities":"off"}},
  globalIgnores([".next/**","node_modules/**","out/**","build/**","next-env.d.ts"]),
])
