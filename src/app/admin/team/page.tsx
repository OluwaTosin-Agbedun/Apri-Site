import { requireOwner } from "@/lib/dal"
import { getTeamImages } from "@/lib/team-images"
import { TEAM_MEMBERS } from "@/data/team"
import AdminShell from "@/components/AdminShell"
import { removeTeamImage, saveTeamImage } from "@/app/actions/team-images"
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
          to enable uploads and URL copying. Validated HTTPS image links can
          still be stored directly.
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
                <form action={saveTeamImage} className="space-y-4">
                  <input type="hidden" name="memberKey" value={m.key} />
                  <label className="block text-sm">
                    Upload JPEG, PNG or WebP (maximum 5 MB)
                    <input
                      name="file"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="block mt-2"
                    />
                  </label>
                  <label className="block text-sm">
                    Or paste an HTTPS image URL
                    <input
                      name="imageUrl"
                      type="url"
                      placeholder="https://…"
                      className="mt-2 w-full border border-border px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm">
                    Accessible alt text
                    <input
                      name="altText"
                      defaultValue={image?.altText || `Portrait of ${m.name}`}
                      required
                      maxLength={200}
                      className="mt-2 w-full border border-border px-3 py-2"
                    />
                  </label>
                  <button className="btn-primary">Save or replace image</button>
                </form>
                {image && (
                  <form action={removeTeamImage} className="mt-3">
                    <input type="hidden" name="memberKey" value={m.key} />
                    <button className="text-sm underline text-red-700">
                      Remove image
                    </button>
                  </form>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </AdminShell>
  )
}
