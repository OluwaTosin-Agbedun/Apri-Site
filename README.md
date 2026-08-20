# apri.athenacentre.org

One-page access site for **Athena Political & Regulatory Intelligence (APRI)**.
Static, no build step, no dependencies. `index.html` is the whole site.

---

## 1. Before you publish — swap three links

Search `index.html` for `PAPERMARK`. There are three:

| Marker | What it is | Current state |
|---|---|---|
| `data-papermark="library"` | Primary "Access Subscriber Library" button | Anchors to `#documents`. Correct on the **Pro** tier — Pro has no data rooms or multi-file links. Point it at a real data-room URL only after upgrading. |
| `data-papermark="note-monthly"` | August 2026 Monthly Intelligence Note | `href="#"` — replace |
| `data-papermark="note-update-001"` | Athena Intelligence Update 001-2026 | `href="#"` — replace |

Also decide on:

- The **"Not yet a subscriber?"** line in the documents section — marked `OPTIONAL`. Delete the block if the page should serve existing subscribers only.
- The **`/privacy`** footer link — currently a dead path. Either publish a privacy page or remove the link before launch.

---

## 2. Access note copy must match your Papermark tier

The access note as written promises email **verification** and **watermarking**. On the **Pro** tier neither exists. Pro provides: email *capture*, password protection, expiry dates, and download on/off.

**If staying on Pro**, replace the `.access-note` paragraph with:

> Access is restricted to authorised recipients. You may be asked to provide your email address and an access code before viewing documents. Documents are view-only and access is logged.

Then configure each Papermark link as: password **on** (share the password only with authorised recipients), email capture **on**, downloads **off**, expiry **set**.

**If upgrading**, the original copy becomes accurate at:

- **Business (€59/mo)** — email verification, allow/block specified users, screenshot protection, custom domain. Covers everything except "watermarked".
- **Data Rooms (€99/mo)** — adds dynamic watermark and a real subscriber library. Delivers the copy exactly as briefed.

---

## 3. Deploy — GitHub → Vercel

### a. Push to GitHub

Confirm the exact org slug first — `athencentrepl` looks like a typo for `athenacentrepl`.

```bash
cd apri-site
git init -b main
git add .
git commit -m "APRI microsite: initial launch"
git remote add origin git@github.com:<ORG>/apri-site.git
git push -u origin main
```

The repo can stay **private** — Vercel deploys private repos on every plan.

### b. Import into Vercel

`vercel.com/new` → select the repo → then:

| Setting | Value |
|---|---|
| Framework Preset | **Other** |
| Root Directory | `./` |
| Build Command | *leave empty* |
| Output Directory | *leave empty* |
| Install Command | *leave empty* |

There is no build step — it is one static HTML file. Deploy.

### c. Attach the domain

**Project → Settings → Domains → Add** `apri.athenacentre.org`.

Vercel then shows the record to create at whoever hosts `athenacentre.org` DNS:

```
Type: CNAME    Name: apri    Value: cname.vercel-dns.com    TTL: default
```

Add it, return to Vercel, wait for the domain to verify. SSL provisions automatically — no action needed. Whoever set up `aeo.athenacentre.org` holds the DNS access you need here.

### Notes

- `vercel.json` sets security headers — HSTS, `nosniff`, `X-Frame-Options: SAMEORIGIN` (stops the page being framed by a third party), a strict referrer policy, and a `Permissions-Policy` disabling APIs this page has no use for. Sensible baseline for a page that fronts confidential material.
- `CNAME` and `.nojekyll` are **GitHub Pages** artefacts and do nothing on Vercel. Harmless — delete them if you want the repo tidy, or keep them so Pages stays available as a fallback host.
- **Plan check:** Vercel's Hobby (free) plan is licensed for non-commercial use only. APRI is a paid subscriber product, so a **Pro** seat ($20/mo) is the correct plan. Not a launch blocker, but worth settling rather than discovering later.

---

## 4. Launch checklist

- [ ] Both documents uploaded to Papermark and share links generated
- [ ] Link settings configured (password / email / downloads / expiry per section 2)
- [ ] Access note copy matches the tier actually in use
- [ ] Three `PAPERMARK` placeholders replaced
- [ ] `OPTIONAL` enquire block kept or deleted
- [ ] `/privacy` published or link removed
- [ ] `intelligence@athenacentre.org` exists and is monitored
- [ ] DNS record live, HTTPS enforced, no certificate warning
- [ ] Gate flow tested end-to-end from a **non-Athena** address — one Gmail, one corporate domain (verification mail lands in spam more often than expected)
- [ ] Checked at 375px and 1440px
- [ ] AIBT adds its outbound link — **APRI does not link back to AIBT**

---

## 6. Future edits via Claude Code

`CLAUDE.md` in this repo is project memory — Claude Code reads it automatically on open. It
records the positioning constraints (no AIBT links, no nav bar), the design tokens, the
Papermark tier coupling, which copy is client-approved versus added during build, and the
verify-before-commit checklist.

Keep it current. If the Papermark plan changes or copy gets signed off, update `CLAUDE.md` in
the same commit — it is the reason a future session won't re-litigate decisions already made or
silently invent copy for an intelligence product.

```bash
git clone git@github.com:<ORG>/apri-site.git
cd apri-site
claude
```

---

## 5. Design notes

White background, charcoal text (`#191c20` / `#3a3f46`), muted brass accent (`#9a7d4e`) used only for hairlines, eyebrow labels, numerals and hover states. Source Serif 4 for headings and prose, Inter for labels and buttons, both with system fallbacks — if Google Fonts fails the page degrades to Georgia and the system sans without reflow damage.

No icons. No boxed cards or shadows — documents are separated by hairlines only. Section rhythm is set by one `--section` variable.

Deliberate omissions: no navigation bar (a one-page site does not need one, and a nav invites someone to add an AIBT link), and no link out to AIBT anywhere on the page.
