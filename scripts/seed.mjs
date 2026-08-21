/**
 * Loads the four APRI publications from the chancellor's brief.
 *
 * Idempotent: upserts on `slug`, so running it twice does not duplicate rows,
 * and it never clears editorial text an administrator has since changed except
 * for the fields listed in the update clause.
 *
 * Publications are seeded as PUBLISHED because these four are the live list
 * from the brief. Anything arriving later via Papermark sync starts as a draft.
 *
 *   pnpm run db:seed
 */
import { neon } from '@neondatabase/serverless'
import 'dotenv/config'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('\n  DATABASE_URL is not set. Put your Neon string in .env.local.\n')
  process.exit(1)
}

const sql = neon(url)

const PUBLICATIONS = [
  {
    slug: 'athena-intelligence-update',
    section: 'Periodic Briefings',
    productLine: 'Periodic Focused Briefing',
    kicker: 'Athena Intelligence Update 001-2026',
    title: 'Osun 2026: What the Result Tells Us About 2027',
    strapline: '',
    description:
      'Timely focused briefings on material political, regulatory, electoral, legal, institutional or operating-risk developments requiring executive interpretation.',
    frequency: 'Periodic, issued as needed',
    audience:
      'Executives, boards, risk teams, investors, strategy teams and government relations teams',
    attribution: '',
    ctaLabel: 'Access Secure Note',
    ctaMode: 'link',
    papermarkLink: 'https://www.papermark.com/view/cmt0fr2ks003yl804ms1f56su',
    sortOrder: 10,
  },
  {
    slug: 'nigeria-political-regulatory-environment',
    section: 'Monthly Intelligence',
    productLine: 'Monthly Intelligence Note',
    kicker: 'Monthly Intelligence Note · August 2026',
    title: 'Nigeria Political & Regulatory Environment',
    strapline: '',
    description:
      'A confidential monthly note on Nigeria’s political, regulatory and political economy operating environment, with sector exposure, forward-looking assessments, forecast tracking and executive actions.',
    frequency: 'Monthly',
    audience:
      'CEOs, boards, strategy teams, risk officers, government relations teams, investors and regulated businesses',
    attribution: '',
    ctaLabel: 'Access Secure Note',
    ctaMode: 'link',
    papermarkLink: 'https://www.papermark.com/view/cmt0fpp1x00dkjn042ua17kcx',
    sortOrder: 20,
  },
  {
    slug: 'nigeria-political-regulatory-outlook',
    section: 'Quarterly Outlook',
    productLine: 'Quarterly Intelligence Brief',
    kicker: 'Quarterly Intelligence Brief · Q3 2026',
    title: 'Nigeria Political & Regulatory Outlook',
    strapline: '',
    description:
      'A 90–180 day outlook on Nigeria’s political, regulatory and political economy environment for boards, senior executives, investors and regulated businesses.',
    frequency: 'Quarterly',
    audience:
      'Boards, board risk committees, CEOs, investment committees, strategy teams, investors and regulated businesses',
    attribution: '',
    // Per the brief this one is by request, so it needs no secure link.
    ctaLabel: 'Request Access',
    ctaMode: 'request',
    papermarkLink: '',
    sortOrder: 30,
  },
  {
    slug: 'political-landscape-monitor',
    section: 'Election & Democratic Governance Monitor',
    productLine: 'AEO Monthly Strategic Assessment',
    kicker: 'Issue No. 1 · July 2026',
    title: 'Political Landscape Monitor',
    strapline: 'Monitoring Nigeria’s Democratic and Electoral Landscape',
    description:
      'A monthly Athena Election Observatory assessment of Nigeria’s democratic, electoral and political landscape, included in APRI subscriber access.',
    frequency: 'Monthly',
    audience:
      'APRI subscribers, democratic governance stakeholders, election observers, diplomats, policy actors, civil society, media and political-risk teams',
    attribution:
      'An Athena Election Observatory publication included in APRI subscriber access.',
    ctaLabel: 'Access Secure Monitor',
    ctaMode: 'link',
    // No link supplied yet. Left empty on purpose rather than guessed: a wrong
    // URL would send subscribers somewhere real but wrong.
    papermarkLink: '',
    sortOrder: 40,
  },
]

let inserted = 0
let updated = 0

for (const p of PUBLICATIONS) {
  // Publishable only if it has a destination. The one with no link yet is
  // seeded as a draft so the public page never shows a dead button.
  const publishable = p.ctaMode === 'request' || Boolean(p.papermarkLink)
  const status = publishable ? 'published' : 'draft'

  const result = await sql`
    insert into documents (
      slug, section_label, kicker, title, strapline, product_line, description,
      frequency, audience, attribution, cta_label, cta_mode, papermark_link,
      sort_order, status, is_published, published_at
    ) values (
      ${p.slug}, ${p.section}, ${p.kicker}, ${p.title}, ${p.strapline},
      ${p.productLine}, ${p.description}, ${p.frequency}, ${p.audience},
      ${p.attribution}, ${p.ctaLabel}, ${p.ctaMode}, ${p.papermarkLink},
      ${p.sortOrder}, ${status}, ${publishable}, ${publishable ? new Date().toISOString() : null}
    )
    on conflict (slug) do update set
      section_label = excluded.section_label,
      kicker        = excluded.kicker,
      title         = excluded.title,
      strapline     = excluded.strapline,
      product_line  = excluded.product_line,
      description   = excluded.description,
      frequency     = excluded.frequency,
      audience      = excluded.audience,
      attribution   = excluded.attribution,
      cta_label     = excluded.cta_label,
      cta_mode      = excluded.cta_mode,
      sort_order    = excluded.sort_order,
      updated_at    = now()
    returning (xmax = 0) as was_inserted
  `

  if (result[0]?.was_inserted) inserted++
  else updated++

  const flag = publishable ? 'published' : 'draft (no secure link yet)'
  console.log(`  ${p.title} — ${flag}`)
}

console.log(`\n${inserted} inserted, ${updated} updated.`)
console.log(
  'Note: Political Landscape Monitor is a draft until its Papermark link is supplied.'
)
