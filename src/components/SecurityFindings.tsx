import Link from 'next/link'
import { getOpenFindings, findingLabel } from '@/lib/link-verification'
import VerifyNow from './VerifyNow'

/**
 * Open link-verification findings, at the top of the admin.
 *
 * Renders nothing when there is nothing wrong, so its presence on a page is
 * itself the signal. A finding here means a subscriber link does not permit
 * exactly one person, which is the assumption the whole stamped-copy model
 * rests on.
 *
 * The offending address is never shown -- the link and the publication are what
 * an operator needs to fix it, and displaying the address would copy it into a
 * second place it does not belong.
 */
export default async function SecurityFindings() {
  const findings = await getOpenFindings()

  if (findings.length === 0) return null

  return (
    <section className="mb-8 border-2 border-red-300 bg-red-50 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="font-serif text-lg text-red-900">
            {findings.length === 1
              ? '1 security finding'
              : `${findings.length} security findings`}
          </h2>
          <p className="text-xs text-red-800/80 mt-1 max-w-2xl leading-relaxed">
            Every subscriber link must permit exactly one address. These do not, so a
            document could open for someone it was not issued to.
          </p>
        </div>
        <VerifyNow />
      </div>

      <ul className="space-y-3">
        {findings.map((f) => (
          <li key={f.id} className="border border-red-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-red-900">
                {findingLabel(f.kind)}
              </span>
              <span className="text-xs text-red-800/70">
                since {new Date(f.firstSeenAt).toLocaleDateString('en-GB')}
              </span>
            </div>

            <p className="text-xs text-foreground/70 mt-2 leading-relaxed">{f.detail}</p>

            <p className="text-xs text-muted-foreground mt-2">
              {f.publicationCode ?? f.publicationTitle} &middot;{' '}
              {f.subscriberId ? (
                <Link
                  href={`/admin/subscribers/${f.subscriberId}`}
                  className="text-accent hover:text-accent-hover"
                >
                  {f.subscriberName}
                </Link>
              ) : (
                f.subscriberName
              )}
              {f.organisation ? ` · ${f.organisation}` : ''}
            </p>

            <p className="text-xs text-muted-foreground mt-1">
              Link <code className="text-foreground/60">{f.papermarkLinkId}</code>
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-red-800/80 leading-relaxed max-w-2xl">
        Fix each in Papermark: the link&rsquo;s allow-list should hold one address, the
        subscriber&rsquo;s own, with downloads off and email verification on. The check
        re-runs daily and clears findings that no longer apply.
      </p>
    </section>
  )
}
