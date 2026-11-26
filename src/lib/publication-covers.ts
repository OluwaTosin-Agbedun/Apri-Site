import "server-only"
import { getSql } from "./db"
import { COVER_SETTING_PREFIX, coverKey, readStoredCover, type CoverKind, type PublicationCover, type StoredPublicationCover } from "./publication-cover"

/** Existing settings storage; no schema migration or access-policy change. */
export async function loadPublicationCovers(): Promise<{ ready: boolean; covers: Map<string, StoredPublicationCover> }> {
  try {
    const rows = await getSql()`select key, value from app_settings where key like ${`${COVER_SETTING_PREFIX}%`}` as { key: string; value: string }[]
    const covers = new Map<string, StoredPublicationCover>()
    for (const row of rows) {
      const [kind, id] = row.key.slice(COVER_SETTING_PREFIX.length).split(":")
      if (coverKey(kind, id) !== row.key) continue
      const cover = readStoredCover(row.value, kind as CoverKind, id)
      if (cover) covers.set(row.key, cover)
    }
    return { ready: true, covers }
  } catch { return { ready: false, covers: new Map() } }
}

/** Return only public image fields; staff identity and edit revisions stay in Admin. */
export async function getPublicationCovers(): Promise<Map<string, PublicationCover | null>> {
  const { covers } = await loadPublicationCovers()
  return new Map([...covers].map(([key, value]) => [key, value.image]))
}
