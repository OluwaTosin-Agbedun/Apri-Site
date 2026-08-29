import Link from "next/link"
import { requireOwner } from "@/lib/dal"
import AdminShell from "@/components/AdminShell"
import { getLevelRoomMappings, getDataRoomStats, getSyncedDocumentsForRoom } from "@/lib/dataroom-dal"
import { PUBLIC_TIERS, tierDisplayName } from "@/lib/entitlements"
import { portalCategoryLabel, type PortalCategoryKey } from "@/lib/papermark-dataroom-contract"
import DataRoomMappingForm, { MappingActions, CreatePublicationButton, LinkExistingPublication } from "./dataroom-form"

export const dynamic = "force-dynamic"
export const metadata = { title: "Data Rooms · APRI" }

export default async function DataRoomsPage() {
  const admin = await requireOwner()
  const [mappings, stats] = await Promise.all([
    getLevelRoomMappings(),
    getDataRoomStats(),
  ])

  const mapped = new Set(mappings.map((m) => m.publicTier))
  const unmappedTiers = PUBLIC_TIERS.filter((t) => !mapped.has(t.name))

  const syncedDocsPerRoom = await Promise.all(
    mappings.map(async (m) => ({
      publicTier: m.publicTier,
      documents: await getSyncedDocumentsForRoom(m.dataroomId),
    })),
  )

  const metrics = [
    { label: "Configured Levels", value: `${stats.configuredLevels} / ${stats.totalLevels}` },
    { label: "Active Links", value: stats.activeLinks },
    { label: "Expiring (30 days)", value: stats.expiringLinks },
    { label: "Sync Errors", value: stats.syncErrors },
  ]

  return (
    <AdminShell
      admin={admin}
      current="/admin/datarooms"
      title="Data Rooms"
      description="Map subscription levels to Papermark Data Rooms. Each subscriber gets a unique watermarked link into the room for their level."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {metrics.map((m) => (
          <div key={m.label} className="border border-border p-6 bg-card/30">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
              {m.label}
            </p>
            <p className="text-3xl font-serif text-foreground">{m.value}</p>
          </div>
        ))}
      </div>

      <h3 className="font-serif text-lg text-foreground mb-4">Level-to-Room Mapping</h3>
      <div className="border border-border bg-card/30 mb-8">
        {mappings.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No levels have been mapped to Data Rooms yet. Use the form below to assign one.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-black/5 text-foreground/70">
              <tr>
                <th className="font-medium p-4">Subscription Level</th>
                <th className="font-medium p-4">Data Room</th>
                <th className="font-medium p-4">Last Sync</th>
                <th className="font-medium p-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {mappings.map((m) => (
                <tr key={m.publicTier} className="hover:bg-black/5 transition-colors">
                  <td className="p-4 font-medium text-foreground">{tierDisplayName(m.publicTier)}</td>
                  <td className="p-4 text-foreground/70">{m.dataroomName || m.dataroomId}</td>
                  <td className="p-4 text-foreground/70">
                    {m.lastSyncedAt
                      ? new Date(m.lastSyncedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Never"}
                  </td>
                  <td className="p-4 text-right">
                    {m.lastSyncError ? (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200">
                        Error
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-accent/10 text-accent">
                        Active
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {unmappedTiers.length > 0 && (
        <>
          <h3 className="font-serif text-lg text-foreground mb-4">Assign a Data Room</h3>
          <div className="border border-border bg-card/30 p-6">
            <DataRoomMappingForm unmappedTiers={unmappedTiers.map((t) => t.name)} />
          </div>
        </>
      )}

      {mappings.length > 0 && (
        <div className="border border-border bg-card/30 p-6 mt-8">
          <MappingActions mappedTiers={mappings.map((m) => m.publicTier)} />
        </div>
      )}

      {syncedDocsPerRoom.map(({ publicTier, documents: docs }) =>
        docs.length > 0 && (
          <div key={publicTier} className="mt-8 pt-8 border-t border-border">
            <h3 className="font-serif text-lg text-foreground mb-4">
              Synced Documents — {tierDisplayName(publicTier)}
            </h3>
            <div className="border border-border bg-card/30 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-black/5 text-foreground/70">
                  <tr>
                    <th className="font-medium p-3">Papermark Filename</th>
                    <th className="font-medium p-3">Folder / Category</th>
                    <th className="font-medium p-3">Pages</th>
                    <th className="font-medium p-3">Editorial Status</th>
                    <th className="font-medium p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {docs.map((doc) => (
                    <tr key={doc.id} className="hover:bg-black/5 transition-colors">
                      <td className="p-3 text-foreground max-w-xs truncate" title={doc.title}>
                        {doc.title}
                      </td>
                      <td className="p-3 text-foreground/70">
                        <span className="text-xs">{doc.folderPath || "—"}</span>
                        <br />
                        <span className="text-xs text-muted-foreground">
                          {portalCategoryLabel(doc.category as PortalCategoryKey)}
                        </span>
                        {doc.category === "OTHER" && (
                          <span className="ml-2 text-[0.65rem] text-amber-600">
                            Category not recognised. Check this document&apos;s Papermark Data Room folder.
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-foreground/70">{doc.numPages ?? "—"}</td>
                      <td className="p-3">
                        {doc.editorialStatus === "complete" ? (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-accent/10 text-accent">
                            Complete
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            Needs details
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {doc.publicationId ? (
                          <Link
                            href={`/admin/documents/${doc.publicationId}`}
                            className="text-xs text-accent hover:text-accent-hover transition-colors"
                          >
                            Edit publication details
                          </Link>
                        ) : (
                          <span className="inline-flex items-center flex-wrap gap-1">
                            <CreatePublicationButton
                              documentRowId={doc.id}
                              publicTier={publicTier}
                            />
                            <LinkExistingPublication documentRowId={doc.id} />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ),
      )}

      <div className="mt-8 pt-8 border-t border-border">
        <h3 className="font-serif text-lg text-foreground mb-4">Migration Status</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="border border-border p-6 bg-card/30">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
              Subscribers with Data Room
            </p>
            <p className="text-3xl font-serif text-foreground">{stats.subscribersWithRoom}</p>
          </div>
          <div className="border border-border p-6 bg-card/30">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
              Subscribers without Data Room
            </p>
            <p className="text-3xl font-serif text-foreground">{stats.subscribersWithoutRoom}</p>
          </div>
        </div>
      </div>
    </AdminShell>
  )
}
