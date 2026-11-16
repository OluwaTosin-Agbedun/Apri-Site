/** Test process only. No runtime application code imports this module. */
const endpoint = new URL(
  process.env.APRI_TEST_DB_ENDPOINT ?? "http://invalid.invalid",
)
if (
  endpoint.hostname !== "127.0.0.1" ||
  !process.env.DATABASE_URL?.includes("@isolated-test-database.invalid/")
)
  throw new Error("Browser checks require the isolated test database")
const original = globalThis.fetch
globalThis.fetch = async (input, options) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  )
  // Neon's default replaces the first hostname label with "api".
  if (
    [
      "isolated-test-database.invalid",
      "api.isolated-test-database.invalid",
      "api.invalid",
    ].includes(url.hostname)
  )
    return original(endpoint, options)
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    return original(input, options)
  // Approved test runs cannot send email, fetch PDFs, call Papermark or
  // retrieve real subscriber data, even if a page starts background work.
  throw new Error("External provider access is disabled in browser checks")
}
