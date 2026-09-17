import AdminShell from "@/components/AdminShell"
import { requireOwner } from "@/lib/dal"
import { getSql } from "@/lib/db"
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const admin = await requireOwner(),
    q = await searchParams
  const search = (q.search || "").slice(0, 120),
    status = (q.status || "").slice(0, 40),
    type = (q.type || "").slice(0, 40),
    source = (q.source || "").slice(0, 30)
  const sql = getSql()
  const rows =
    (await sql`select * from review_prospects where (${search}='' or full_name ilike ${`%${search}%`} or email ilike ${`%${search}%`} or coalesce(organisation,'') ilike ${`%${search}%`}) and (${status}='' or status=${status}) and (${type}='' or user_type=${type}) and (${source}='' or attributed_source=${source}) order by created_at desc limit 250`) as Record<string, string | null>[]
  const counts =
    (await sql`select status,count(distinct id)::int count from review_prospects group by status`) as {
      status: string
      count: number
    }[]
  const sourceCounts =
    (await sql`select attributed_source source,count(distinct id)::int requests,count(distinct id) filter(where verified_at is not null)::int verified,count(distinct id) filter(where access_sent_at is not null)::int access_sent from review_prospects group by attributed_source order by requests desc`) as {
      source: string
      requests: number
      verified: number
      access_sent: number
    }[]
  const planCounts =
    (await sql`select r.plan,count(distinct r.prospect_id)::int requests,count(distinct r.prospect_id) filter(where r.activated_at is not null)::int activated from review_subscription_requests r group by r.plan order by r.plan`) as {
      plan: string
      requests: number
      activated: number
    }[]
  return (
    <AdminShell
      admin={admin}
      current="/admin/review-requests"
      title="Review requests"
      description="Verified prospects, conversion pipeline and source reporting."
    >
      <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {counts.map((c) => (
          <div className="border border-border p-3" key={c.status}>
            <p className="text-xs text-muted-foreground">{c.status}</p>
            <p className="font-serif text-2xl">{c.count}</p>
          </div>
        ))}
      </div>
      <form className="grid md:grid-cols-4 gap-3 mb-6">
        <input
          className="border border-border px-3 py-2"
          name="search"
          placeholder="Name, email or organisation"
          defaultValue={search}
        />
        <select
          name="status"
          className="border border-border px-3 py-2"
          defaultValue={status}
        >
          <option value="">All statuses</option>
          {counts.map((c) => (
            <option key={c.status}>{c.status}</option>
          ))}
        </select>
        <select
          name="type"
          className="border border-border px-3 py-2"
          defaultValue={type}
        >
          <option value="">All user types</option>
          {[
            "Individual professional",
            "Small professional team",
            "Corporate or institutional",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          name="source"
          className="border border-border px-3 py-2"
          defaultValue={source}
        >
          <option value="">All sources</option>
          {[
            "WhatsApp",
            "Google",
            "Facebook",
            "X",
            "LinkedIn",
            "Referral",
            "Direct traffic",
            "Other",
          ].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button className="btn-secondary">Filter</button>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="p-3">Prospect</th>
              <th>Status</th>
              <th>Type / source</th>
              <th>Requested</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="p-3">
                  <a
                    className="font-medium underline"
                    href={`/admin/review-requests/${r.id}`}
                  >
                    {r.full_name}
                  </a>
                  <br />
                  <span className="text-muted-foreground">
                    {r.email}
                    {r.organisation ? ` · ${r.organisation}` : ""}
                  </span>
                </td>
                <td>{r.status}</td>
                <td>
                  {r.user_type}
                  <br />
                  <span className="text-muted-foreground">
                    {r.attributed_source}
                  </span>
                </td>
                <td>
                  {r.requested_at
                    ? new Date(r.requested_at).toLocaleString("en-NG", {
                        timeZone: "Africa/Lagos",
                      })
                    : "Unavailable"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="mt-10 grid lg:grid-cols-2 gap-6">
        <div className="border border-border p-5">
          <h3 className="font-serif text-xl mb-4">Conversions by source</h3>
          {sourceCounts.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Source</th>
                  <th>Requests</th>
                  <th>Verified</th>
                  <th>Access sent</th>
                </tr>
              </thead>
              <tbody>
                {sourceCounts.map((x) => (
                  <tr key={x.source}>
                    <td>{x.source}</td>
                    <td className="text-center">{x.requests}</td>
                    <td className="text-center">{x.verified}</td>
                    <td className="text-center">{x.access_sent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">
              Unavailable until review data is collected.
            </p>
          )}
        </div>
        <div className="border border-border p-5">
          <h3 className="font-serif text-xl mb-4">Conversions by plan</h3>
          {planCounts.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Plan</th>
                  <th>Requests</th>
                  <th>Activated</th>
                </tr>
              </thead>
              <tbody>
                {planCounts.map((x) => (
                  <tr key={x.plan}>
                    <td>{x.plan}</td>
                    <td className="text-center">{x.requests}</td>
                    <td className="text-center">{x.activated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">
              Unavailable until subscription requests are received.
            </p>
          )}
        </div>
      </section>
    </AdminShell>
  )
}
