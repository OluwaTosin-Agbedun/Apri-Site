# CLAUDE.md — apri.athenacentre.org

Project memory for Claude Code. Read this before editing anything in this repo.

## What this is

A one-page access site for **Athena Political & Regulatory Intelligence (APRI)**, a paid
political / regulatory / political-economy intelligence service for organisations operating in
Nigeria. It sits under **Athena Centre for Policy and Leadership** (`athenacentre.org`).

The audience is boards, CEOs, strategy teams, risk officers, government relations teams,
investors and regulated businesses. Everything on the page is read by executives deciding
whether this service is credible.

`index.html` is the entire site. There is no build step, no framework, no package manager,
no dependencies.

## Hard constraints — do not violate without explicit sign-off

1. **APRI must not link to AIBT.** AIBT (the training / admissions business) may link *in*;
   APRI never links *out* to it. This is a deliberate positioning decision, not an oversight.
   A political intelligence product that appears to live inside a course-and-admissions
   environment reads as coursework rather than research authority. There is also intentionally
   **no navigation bar** — a nav is the most likely place someone adds an AIBT link by reflex.

2. **The access note must never overstate what Papermark actually enforces.** See below. This
   is the single highest-risk copy on the page: it makes security promises to subscribers.

3. **No confidential material in this repo, ever.** No intelligence notes, no drafts, no
   subscriber lists, no Papermark passwords, no `.env`. Every document lives behind Papermark.
   The repo may be private but treat it as public.

4. **Design language is fixed:** white background, charcoal text, muted brass accent used
   sparingly, restrained typography, generous spacing. **No decorative icons. No boxed cards
   or shadows** — documents are separated by hairlines only. No course/admissions feel.

## Papermark coupling — read before touching the access note

The account is on the **Pro** tier (€24/mo). Pro provides email *capture*, password
protection, expiry dates, and download on/off. Pro does **not** provide:

| Feature | Required tier |
|---|---|
| Email **verification** | Business (€59/mo) |
| Allow/block specified users | Business |
| Screenshot protection | Business |
| Custom domain for documents | Business |
| Dynamic watermark + data rooms | Data Rooms (€99/mo) |

The access note currently in `index.html` is the **as-briefed** copy, which promises email
verification and watermarking. On Pro that is not accurate. Either upgrade the tier or use the
Pro-honest variant in `README.md` §2. **If anyone changes the Papermark plan, update this table
and re-check the access note in the same commit.**

Related: the primary "Access Subscriber Library" button anchors to `#documents` because Pro has
no data rooms or multi-file links. Point it at a real data-room URL only after a Data Rooms
upgrade.

## Copy provenance — important

Copy in `index.html` falls into two categories. Know which you are editing.

**Client-approved (from the brief — do not reword without asking):**
the H1, the hero lede, the access note, both document titles, both document meta lines
("Monthly Intelligence Note · August 2026", "Focused Briefing Note"), both document
descriptions, the five "What APRI Tracks" items, the "Designed For" sentence, the "About"
paragraph, and `intelligence@athenacentre.org`.

**Added during build, pending sign-off (safe to cut):**

- Masthead: "Athena Centre" + "Political & Regulatory Intelligence"
- Eyebrow labels: `Subscriber Access`, `Secure Documents`, `Coverage`, `Audience`, `About`
- The documents section heading: "Current releases"
- The "Not yet a subscriber? Enquire about subscriber access." line (marked `OPTIONAL` in the
  markup) — added because the brief left no route in for a prospect
- Footer: copyright line, Athena Centre link, Privacy link

**Never invent new prose for this site.** It is an intelligence product; fabricated copy is a
credibility risk. If a section looks sparse, leave it sparse — that reads as restraint. Ask
instead.

## Design tokens

All in the `:root` block of `index.html`. Change them there, never inline.

```
--ink       #191c20   headings
--body      #3a3f46   body text
--muted     #6b7178   access note, secondary
--faint     #8d939a   footer, small labels
--brass     #9a7d4e   accent: hairlines, eyebrows, numerals
--brass-dark #7c6339  link + hover
--hairline  #e4e1da   section rules
--section   clamp(4rem,8.5vw,7.5rem)   vertical rhythm — one variable drives all sections
```

Type: **Source Serif 4** for headings and prose, **Inter** for labels and buttons, both from
Google Fonts with system fallbacks (`Georgia` / system sans). These are the only external
requests the page makes. Do not add more.

## Editing rules

- Keep it a **single self-contained HTML file**. Do not split out CSS or JS, do not add a
  bundler, do not introduce a framework for a one-page static site.
- **No JavaScript** unless there is a real need. There is currently none. Keep it that way.
- **No browser storage, no analytics, no third-party scripts** without a decision — the page
  will collect executive emails through Papermark and sits under Nigeria's Data Protection Act
  2023. Adding a tracker silently is a compliance problem, not a convenience.
- The `/privacy` footer link is currently a **dead path**. Either publish that page or remove
  the link.
- Preserve the `PAPERMARK` comment markers and `data-papermark` attributes — they are how the
  three swappable links are found.

## Verify after any change

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

Check before committing:

- Renders correctly at **375px** and **1440px**, no horizontal scroll at 320px
- Both fonts load, and the page still reads well if they fail
- Every `href` resolves — no stray `#` placeholders left in a production commit
- Still no link to AIBT anywhere
- Access note still matches the live Papermark tier

## Deploy

`git push` to `main` → Vercel auto-deploys. Framework preset **Other**, no build command, no
output directory. Domain `apri.athenacentre.org` via a `CNAME` → `cname.vercel-dns.com`.

`vercel.json` carries the security headers (HSTS, nosniff, `X-Frame-Options: SAMEORIGIN`,
referrer policy, permissions policy). `CNAME` and `.nojekyll` are leftover GitHub Pages
artefacts and are inert on Vercel.

## Roadmap context

This page is deliberately a **stopgap**. The instruction was to launch a clean one-pager now and
build the full APRI portal only after there are subscribers and evidence of how they use the
product. Do not scope-creep this into a portal. Resist adding pricing tables, dashboards,
logins or article archives unless explicitly asked.
