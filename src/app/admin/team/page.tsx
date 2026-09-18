import { requireOwner } from "@/lib/dal"
import { getTeamImages } from "@/lib/team-images"
import { TEAM_MEMBERS } from "@/data/team"
import AdminShell from "@/components/AdminShell"
import TeamImageForm from "./team-image-form"
export default async function Page() {
  const admin = await requireOwner(),
    images = await getTeamImages(),
    blob = Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  return (
    <AdminShell
      admin={admin}
      current="/admin/team"
      title="Team headshots"
      description="Owner-managed portraits for the public team page."
    >
      {!blob && (
        <div className="mb-6 border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Blob upload is unavailable.</strong> Add BLOB_READ_WRITE_TOKEN
          to enable uploads. Validated HTTPS image links can still be stored
          directly.
        </div>
      )}
      <div className="space-y-6">
        {TEAM_MEMBERS.map((m) => {
          const image = images.get(m.key)
          return (
            <article
              key={m.key}
              className="border border-border p-6 grid md:grid-cols-[160px_1fr] gap-6"
            >
              {image ? (
                <img
                  src={image.imageUrl}
                  alt={image.altText}
                  className="aspect-[4/5] w-full object-cover"
                />
              ) : (
                <div
                  className="aspect-[4/5] bg-foreground/5 grid place-items-center font-serif text-3xl"
                  aria-hidden
                >
                  {m.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((v) => v[0])
                    .join("")}
                </div>
              )}
              <div>
                <h3 className="font-serif text-xl mb-4">{m.name}</h3>
                <TeamImageForm
                  memberKey={m.key}
                  memberName={m.name}
                  currentAlt={image?.altText}
                  hasImage={Boolean(image)}
                />
              </div>
            </article>
          )
        })}
      </div>
    </AdminShell>
  )
}
