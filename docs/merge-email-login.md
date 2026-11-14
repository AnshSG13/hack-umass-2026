# Merging `feature/email-login` into `realize-build`

Email and password accounts. People sign up and sign in with an email and password instead of
keeping a random key, and every account only ever sees its own saves, plans and searches.

The branch is based on the latest `realize-build` (up to `3e677d2 icon: a serif r with a butter
full stop on teal`), so it merges cleanly as long as nothing new has landed since. It is one commit.

## 1. Merge it

**On GitHub (easiest):** open
https://github.com/AnshSG13/hack-umass-2026/compare/realize-build...feature/email-login,
click **Create pull request**, then **Merge pull request**.

**Or on the command line:**

```
git checkout realize-build
git pull origin realize-build
git merge --no-ff origin/feature/email-login
git push origin realize-build
```

If `realize-build` got new commits after this branch was made and the merge stops on a conflict,
the likely spots are the ones this branch touches in shared files:

- `web/app/(app)/settings/page.tsx`: keep both. The "Account" section (signed in as, Sign out)
  goes first, then the "Your name" section, then the rest.
- `web/lib/types.ts`: `Me` needs `email: string | null` next to `name`. Don't keep `name` twice.
- `BUILD_LOG.md`: keep both entries.

After resolving: `cd web && npx tsc --noEmit && npx eslint app components lib`, then commit.

## 2. After merging (one time)

```
cd server
.venv\Scripts\Activate.ps1     (macOS/Linux: source .venv/bin/activate)
python -m scripts.create_indexes
```

This adds a unique index on `users.email` and the new `sessions` collection's indexes (one
expires sessions after 30 days). Existing data is untouched.

Nothing else changes: no new dependencies (passwords use Python's built-in `hashlib.scrypt`),
no new `.env` values, and the Docker setup is the same.

## 3. What changed

**Server**
- `server/realize/api/routers/auth.py` (new): `POST /api/auth/signup`, `/api/auth/login`,
  `/api/auth/logout`, and `/api/auth/credentials` (gives an old key-only account an email and
  password).
- `server/realize/accounts.py`: password hashing, sessions (`rs_...` tokens, stored as sha256),
  and `find_by_key` now accepts a session token as well as an API key. Every existing route and
  its `user_id` filter is unchanged, because the session resolves to the same user document.
- `db.py` (`sessions()`), `models.py` (request bodies), `ratelimit.py` (login limits per IP and
  per email), `core.py` (`/api/me` returns `email`), `create_indexes.py`.

**Web**
- New pages `/signup` and `/login` (`web/components/auth-form.tsx`). Sign up goes to `/setup`,
  sign in goes to `/home`.
- Landing: "Use it for real" goes to `/signup`, plus a "Sign in" link.
- Setup: no more keyless "Create my account". Email accounts see a QR code that opens `/login` on
  the phone, and no key.
- Settings: "Account" section with "Signed in as" and Sign out (ends the session on the server).
  Key-only accounts get an "Add an email and password" form. The Shortcut key is still made here
  and shown once.

**Still works as before:** API keys and the Shortcut (`Authorization: Bearer rl_...`),
`POST /api/users`, demo sessions, the judge user.

## 4. How it was tested

- A script against Atlas, 17 of 17: signup, duplicate email, bad email and short password
  refused, login with a case-changed email, wrong password, logout ends only that session, a
  key account adds credentials and its key still works, login rate limit.
- In the browser at 390x844 on this branch, with Gemini live: user A signs up and saves the
  tiramisu reel (planned, video watched, re-embedded), and a search for "mascarpone", which is only
  spoken in the video, finds it. User B signs up and sees 0 saves, and "mascarpone" finds
  nothing. B saves the chicken au poivre reel. A signs back in and sees only A's save, and
  "poivre" finds nothing.
- Against the running API, 11 of 11: each user gets 404 opening or deleting the other's save
  by id, lists and search return only their own, and a request with no token or a forged
  token gets 401.
- `pytest` (70), `tsc` and `eslint` pass.

Not tested yet: the iPhone Home Screen app on the deployed server.

## 5. Try it yourself

Run the API, worker and web app as in the README, open http://localhost:3000, then click
**Use it for real** and sign up. Open a private window and sign up with a second email to check
the two accounts don't see each other's saves.

Once merged and checked, this file can be deleted.
