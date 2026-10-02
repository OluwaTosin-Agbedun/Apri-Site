# Subscriber sign-in: staying signed in on the browser you use

## The incident

Subscribers who had signed in were asked for an email again when they came back through
**Access Subscriber Library**.

### Root cause (shared by every plan and both library paths)

The session cookie was created in **whichever browser opened the emailed link**. It was not
created in the browser that asked for the email.

- On a phone, the mail app usually opens links in its own built-in browser. Gmail and Outlook
  both do this, and that browser keeps its cookies apart from Safari or Chrome.
- On a computer, the mail client may open the system's default browser instead of the one the
  subscriber reads APRI in.

So the browser the subscriber returned in never held a session. Each visit asked for an email,
and each new link signed in the mail app's browser again.

### Evidence

From the live database, read-only:

- 11 sign-in emails were requested by subscribers who had signed in before.
- 8 of those 11 were requested while one of that subscriber's sessions had been used in the
  previous hour.
- The sign-in page sends any browser holding a valid session straight to the library. So each
  request came from a browser with no session, even though another of the subscriber's browsers
  had one.
- The same subscribers returned many times over several days without an email on the browser
  that did hold the cookie.

The cookie itself was correct. In a production build:

- The `/portal/verify` 307 carries `Set-Cookie: apri_subscriber=…; Path=/; Max-Age=7776000;
  Secure; HttpOnly; SameSite=lax`.
- A later request sends that cookie and is accepted.
- The session survives closing and reopening the browser.

A second, latent problem: the link was spent on a plain GET. A mail security scanner that
follows links could therefore use up a subscriber's link before the subscriber clicked it.

## The fix

1. **A code in every sign-in email.** Each sign-in email carries the link and an 8-digit code.
   Typed on the sign-in page, the code signs in **the browser it is typed into**.
2. **The link signs in at once only in the browser that asked for it.** That browser holds a
   15-minute marker cookie, and only its hash travels with the link. Opened anywhere else (an
   email app's browser, another device or a scanner), the link spends nothing. It shows
   **Continue on this browser**, and points the subscriber to the code for the browser they
   normally use.
3. **Sessions recorded on the server.** The table is `subscriber_sessions`.
   - **Sign out** ends that browser's session, even if a copy of the cookie survives.
   - Admin → subscriber → **Sign out of all browsers** ends every session, including cookies
     issued before this release.
4. **Renewal with use.** The 90-day cookie is renewed at most once a day while the subscriber
   keeps using the portal. A session lasts at most a year before a fresh sign-in.
5. **Accurate, recoverable errors.** If a session cannot be opened after a link or code was
   spent, the link is put back and the subscriber is told to try the same link again.
6. **Every protected request still checks** the session record, the subscriber's status and
   their term. Suspension, an ended term, sign-out and revocation take effect on the next
   request.

The following are not changed:

- the library;
- personal document links;
- entitlement checks;
- onboarding emails (they now also carry the code);
- account levels.

There is no IP or device identity and no local-storage token. The session is a `Secure`,
`HttpOnly` cookie only.

### Code tries are limited

- Each code stops working after 5 wrong tries.
- Each address gets 10 wrong codes per day.
- Each network address gets 20 wrong codes per 15 minutes.
- Only a keyed hash of each code is stored, so a database read cannot be turned into a working
  code.

## Deploying

1. Deploy the code. Until the migration is applied, sign-in behaves exactly as before: link
   only, no code, sessions not recorded.
2. Apply `db/migrations/20261007_subscriber_sign_in_sessions.sql`. It is additive and safe to
   re-run.
3. Check it with these queries:

   ```sql
   select column_name from information_schema.columns
    where table_name = 'auth_tokens' and column_name in ('code_hash','code_attempts','binding_hash');
   select to_regclass('public.subscriber_sessions');
   select column_name from information_schema.columns
    where table_name = 'subscribers' and column_name = 'sessions_revoked_at';
   ```

   Rollback: `db/rollback/20261007_subscriber_sign_in_sessions.rollback.sql`.

Existing signed-in browsers stay signed in, because their cookies are honoured until they expire.

## Live acceptance test (deployed site, controlled test subscribers only)

Use test subscriber records that you control, never a real subscriber's mailbox. Cover one
existing and one newly activated subscriber on each plan in use: Individual, Professional,
Political Monitor, Executive Intelligence and Board Intelligence. Board Intelligence has no
Data Room mapped, so it covers the older library path.

1. In the browser you normally use, open `/portal/sign-in`, enter the address, and request
   the email.
2. Pick the step that matches where you opened the email:
   - **Same browser** (for example Gmail on the web): click **Open my library**. The library
     opens.
   - **Phone mail app:** tap the link. The mail app's browser shows **Continue on this
     browser**. Instead, type the 8-digit code on the sign-in page in your normal browser. The
     library opens there.
3. Go to the homepage and click **Access Subscriber Library**. Check that the library opens
   with no email.
4. Close the browser completely, reopen it and repeat step 3. Again there should be no email.
5. Open a private window and click **Access Subscriber Library**. The sign-in page shows,
   which is correct.
6. Click **Sign out**, then **Access Subscriber Library**. The sign-in page shows.
7. In Admin, end a test subscriber's term, or suspend them, while they are signed in. Their
   next visit shows the ended or suspended notice and no documents.
8. In the browser's developer tools (Network tab), check two things:
   - the response that signs in carries `Set-Cookie: apri_subscriber` (`Secure`, `HttpOnly`);
   - the next `/portal` request sends it.
