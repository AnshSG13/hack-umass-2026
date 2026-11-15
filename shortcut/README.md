# The iOS Shortcut

The Shortcut is optional. Realize is a web app: you can save any reel by copying its link and pasting it on the Save tab (see the main README). The Shortcut adds a one-step path from Instagram's share sheet, which a web app on iOS can't offer by itself.

**On the live site, use `https://reelize.boston` wherever these steps say your address** (so the save-only URL is `https://reelize.boston/api/save`), and a key from that site's `/setup`. The main README's "Use it on your iPhone" section has the steps for the live site. The laptop addresses below (`http://<YOUR-LAN-IP>:3200`, `http://10.0.0.11:3100`) are for local testing only.

## Build the key-saving Shortcut on a Mac (the one for the stand)

This is the version visitors get from `/setup`'s **Add the Shortcut** button. Nobody types or pastes a key, and reels save in the background without opening Safari:

- The button copies the visitor's key and opens the Shortcut's iCloud link.
- The first time a reel is shared to it, the Shortcut reads the key from the clipboard (iOS asks once, "Allow paste") and keeps it in `realize-key.txt` in the Shortcuts folder.
- If the clipboard had changed by then, or the key later stops working (the server answers `"key_ok": "no"`), the Shortcut opens `/connect?url=<reel>`. That page saves the reel and has a **Connect the Shortcut** button, which runs the Shortcut once with a fresh key.

iOS only imports Shortcut files signed on a Mac, so the file is made here and signed there. It only needs building once. Afterwards everyone uses its iCloud link.

**On the Mac:**

1. Get this branch and make the file. `python3` comes with the Xcode command line tools; macOS offers to install them the first time.
   ```
   git fetch origin
   git checkout feature/shortcut-key
   python3 shortcut/build_shortcut.py --base https://reelize.boston
   ```
   It writes `shortcut/Realize.shortcut`. A copy built for https://reelize.boston is already committed, so you can skip the python step if the address is the same.
2. Sign it. The output file's name becomes the Shortcut's name, and it must be **Realize**, because `/connect` runs it by that name.
   ```
   mkdir -p ~/Desktop/signed
   shortcuts sign --mode anyone --input shortcut/Realize.shortcut --output ~/Desktop/signed/Realize.shortcut
   ```
   `shortcuts` is built into macOS 12 and later. Sign in to iCloud on the Mac first if it asks.
3. AirDrop `~/Desktop/signed/Realize.shortcut` to the iPhone and tap **Add Shortcut**. If an older Shortcut named Realize is already there, choose **Replace**. Alternatively, open it on the Mac in the Shortcuts app.
4. On the iPhone, open the Shortcut and check two things:
   - In **Get Contents of URL**, there is exactly one header, `Authorization`.
   - Under ⓘ, **Show in Share Sheet** is on.
5. Test it:
   1. In Safari, open `https://reelize.boston/setup` signed in, and tap **Add the Shortcut**. This copies your key. Close the iCloud page.
   2. In Instagram, tap **Share** on a reel, then **Share to…**, then **Realize**.
   3. Tap **Allow** for paste and for files.
   4. A notification says "Saved. Still reading it...".
6. Share it: open the Shortcut, tap **Share**, then **Copy iCloud Link**.
7. On the server, set these in `/opt/realize/.env`, then redeploy (`python deploy/vultr.py deploy` from the hosting checkout, which uploads its `.env`):
   ```
   QUICK_SHORTCUT_URL=<that link>
   QUICK_SHORTCUT_KEYED=true
   ```
   The button then copies the key before it opens the link. With `QUICK_SHORTCUT_KEYED=false`, the button opens the link without copying a key, which is right for the one-action Open URLs Shortcut below.

The file format isn't documented by Apple. The script follows the format other Shortcut tools write, and it hasn't been imported on a phone yet. If an action comes in blank or broken, fix that one action on the phone; step by step it is:

| # | Action | Settings |
|---|---|---|
| 1 | Text | Shortcut Input |
| 2 | If | Text begins with `rl_`: Save File (Text, Ask Where to Save off, path `realize-key.txt`, Overwrite on), Show Notification "Connected", Stop This Shortcut. End If |
| 3 | Get File | `realize-key.txt`, Error If Not Found off |
| 4 | If | File does not have any value: Get Clipboard; If Clipboard begins with `rl_`, Save File (Clipboard, same settings); Otherwise URL Encode Shortcut Input, Open URLs `https://reelize.boston/connect?url=` + URL Encoded Text, Stop This Shortcut. End If. End If |
| 5 | Get File | `realize-key.txt`, Error If Not Found off |
| 6 | Get Text from Input | File |
| 7 | Get Contents of URL | `https://reelize.boston/api/save`, POST, one header `Authorization` = `Bearer ` + Text, JSON body `input` = Shortcut Input, `source` = `shortcut`, `wait` (Number) = `0` |
| 8 | Get Dictionary Value | `key_ok` in Contents of URL |
| 9 | If | Dictionary Value is `no`: URL Encode Shortcut Input, Open URLs `https://reelize.boston/connect?url=` + URL Encoded Text. Otherwise: Get Dictionary Value `message` in Contents of URL, Show Notification with it. End If |

## The other versions

There are three more versions. Start with the first: it is the one from the original prototype (`prototype/README.md`), which was tested on a real iPhone over plain http on Wi-Fi, with the address and body changed for Realize.

## Save only (one action, the prototype's Shortcut)

It posts the reel's link and you are done. The plan waits in the app under Waiting on you.

1. **Shortcuts** app, **+**, add the action **Get Contents of URL**.
2. Tap **ⓘ**, turn on **Show in Share Sheet**. At the top, set "Receive **URLs** and **Text** from Share Sheet".
3. In Get Contents of URL:

   ```
   URL            http://<YOUR-LAN-IP>:3200/api/save
   Method         POST
   Headers
      Authorization   Bearer <your key>
   Request Body   JSON
      input   (Text)   → [Shortcut Input]   ← pick the blue variable, don't type it
      source  (Text)   → shortcut
      wait    (Number) → 0
   ```
4. Optional: add **Get Dictionary Value** for `message`, then **Show Notification** with it. It says "Saved. Still reading it. Your plan will be waiting in Realize."
5. Name the Shortcut **Realize**.
6. In Instagram, open a reel, **Share**, **Share to…** (or **More**), **Realize**. Tap **Allow** the first time iOS asks to connect.

The server reads this request loosely, because it is typed on a phone: field names and `shortcut` in any letter case (the iOS keyboard writes `Input`, `Source`, `Shortcut`), `wait` as text, the body left on Form instead of JSON, and the key with or without the word `Bearer` all work. A wrong key or a missing link still gets an error message, and the API logs one "save attempt" line per try saying which of the two was wrong.

If the Shortcut seems to do nothing, add **Show Result** with **Contents of URL** as its last action to see the server's answer.

**Local testing: point the Shortcut at the API, not at the web server.** Seen on 2026-11-14 with a real iPhone (iOS Shortcuts, `BackgroundShortcutRunner`): the Shortcut's POST to the Next.js server (`:3100/api/save`, which proxies `/api` to the API) came back empty and never reached the API, while Safari on the same phone used that port normally and the same request sent from the laptop went through. The cause is not known. Sent straight to the API it worked first time: the reel was saved, planned in a second and read in 47 seconds. So for local testing give the Shortcut a way straight to the API. Either run the small pass-through, `python -m scripts.phone_door` from `server/`, and use `http://<YOUR-LAN-IP>:3200/api/save` (it also prints every request it gets, which shows what the Shortcut really sends); or start the API with `--host 0.0.0.0` and use `http://<YOUR-LAN-IP>:8000/api/save`. A deployed site is not affected: Caddy sends `/api/*` straight to the API.

What changed from the prototype: the path is `/api/save` instead of `/share`, the body field is `input` instead of `url`, and the key goes in the `Authorization` header instead of a `token` field. Your key is on the app's `/setup` page ("Copy key"). Leave `wait` out and the Shortcut waits up to 20 seconds and gets the plan back (`prompt` and `menu`), which is what the full version below builds on.

Checked on 2026-11-14 with the same request sent by curl to the laptop's Wi-Fi address: HTTP 200 in 0.2 s with the message above, and the plan was there 5 seconds later. Not yet run from a real iPhone against Realize.

## Open in the app (one action)

It opens the web app's Save page with the reel's link. It needs no key, and the plan shows up as a ticket in the app. The same steps, with your own address filled in and a copy button, are on the app's setup page under "Save straight from Instagram's Share menu".

1. In the Shortcuts app, tap **+**.
2. Add the action **Open URLs**. In its URL field type your site's address followed by `/save?url=`, for example `http://10.0.0.11:3100/save?url=`.
3. With the cursor right after the `=`, tap **Shortcut Input** in the row above the keyboard, so the reel's link follows the `=`.
4. Tap the ⓘ button, turn on **Show in Share Sheet**, and name the Shortcut **Realize**. Under Share Sheet Types, **URLs** is enough.
5. In Instagram, open a reel, tap **Share**, open the iOS share sheet and tap **Realize**. Safari opens the app and the reel is saved.

It uses the account that is signed in to Realize in Safari, so create your account in Safari first (`/setup`). If the laptop's address changes, edit the address in step 2.

Checked on 2026-11-14 in a browser by opening `/save?url=` followed by a raw Instagram link with its `?igsh=...&utm_source=...` tail: the reel saved and its ticket appeared. Not yet run from a real iPhone.

## The full version (menu, Calendar and Reminders)

It sends only the reel's link, shows the plan as a menu, and writes the calendar event and reminders on the phone itself. It is built by hand in the Shortcuts app; these are the steps.

Nothing is added to Calendar or Reminders unless you pick an option from the menu.

## What you need

- The site's address (`BASE`), for example `https://realize.example.com`. For local testing on the same Wi-Fi, use the laptop's address and the production web server's port, for example `http://10.0.0.11:3100` (see "Run it locally" in the main README). If the Shortcut refuses a plain http address, use a tunnel (`cloudflared tunnel --url http://localhost:3100`) and its https address.
- Your key (`rl_...`). Get it at `BASE/setup`, or from `python -m scripts.create_user`.

## Build it

Shortcut details (the ⓘ button): name **Realize**, turn on **Show in Share Sheet**, and under Share Sheet Types keep only **URLs** and **Text**.

Add these actions in order:

1. **Text**: `https://<your domain>`, then **Set Variable** `BASE`.
2. **Text**: `<your key>`, then **Set Variable** `KEY`.
   In the Setup tab, add an Import Question on this Text action: "Paste your Realize key".
3. **If** `Shortcut Input` *has any value*: **Set Variable** `INPUT` to `Shortcut Input`.
   **Otherwise**: **Get Clipboard**, then **Set Variable** `INPUT`. **End If**.
4. **Get Contents of URL**
   - URL: `BASE/api/save`
   - Method: POST
   - Headers: `Authorization` = `Bearer KEY`
   - Request Body: JSON, with `input` (Text) = `INPUT` and `source` (Text) = `shortcut`
   - Then **Set Variable** `RESP`.
5. **Get Dictionary Value** `ask` from `RESP`. **If** it *is* `yes`:
   1. **Get Dictionary Value** `prompt` from `RESP`, then **Set Variable** `PROMPT`.
   2. **Get Dictionary Value** `menu` from `RESP`, then **Choose from List** with Prompt = `PROMPT`, then **Set Variable** `CHOICE`.
   3. **Get Dictionary Value** `save_id` from `RESP`, then **Set Variable** `SAVE_ID`.
   4. **Get Contents of URL**: `BASE/api/saves/SAVE_ID/confirm`, POST, the same `Authorization` header, JSON body with `choice` (Text) = `CHOICE` and `source` (Text) = `shortcut`. Then **Set Variable** `CONF`.
   5. **Get Dictionary Value** `has_event` from `CONF`. **If** it *is* `yes`:
      - **Get Dates from Input** on `event_start_text`, then **Set Variable** `START`.
      - **Get Dates from Input** on `event_end_text`, then **Set Variable** `END`.
      - **Add New Event**: Title `event_title`, Start `START`, End `END`, Location `event_location`, Notes `event_notes`.
      - **End If**.
   6. **Get Dictionary Value** `reminders` from `CONF`, then **Repeat with Each**:
      - **Get Dates from Input** on Repeat Item's `due_text`.
      - **Add New Reminder**: Title = Repeat Item's `title`, alert at that date, Notes = Repeat Item's `notes`, URL = Repeat Item's `url` if the field is offered.
      - **End Repeat**.
   7. **Show Notification**: `CONF` `message`.

   **Otherwise**: **Show Notification**: `RESP` `message`. **End If**.

For each variable in a URL, header or JSON field, pick the blue variable token. Don't type its name.

## Use it

In Instagram, open a reel, tap **Share**, scroll the action list and tap **Realize**. (Edit Actions lets you pin it as a favorite.) The first time, iOS asks to allow the network connection, Calendar and Reminders. Tap Allow.

You wait up to 20 seconds, then a menu appears, for example:

```
Gochujang butter squash. Dinner Thursday?
  Cook Thu 6:30 pm + 3 groceries
  Cook Mon 6:30 pm + 3 groceries
  Not now
  Just vibes
```

If reading takes longer than the wait, you get "Saved. Still reading it. Your plan will be waiting in Realize." and the ticket is in the app under Waiting on you.

## The judge version

Duplicate the Shortcut, put the judge key in step 2, remove the Import Question, and share its iCloud link. Put that link in `JUDGE_SHORTCUT_URL`. Make the judge key with `python -m scripts.create_user --judge --label judge` (run from `server/`).

Put the normal Shortcut's iCloud link in `SHORTCUT_URL`.

## Test without a phone

`server/scripts/simulate_shortcut.py` sends the same two requests and prints what the Shortcut would show and add:

```
cd server
python -m scripts.simulate_shortcut --url https://www.instagram.com/reel/DfYi19kRNT0/ --base http://localhost:3000 --choose 1
```

It exits nonzero if any field the Shortcut reads is missing.

## The fields the Shortcut reads

Both endpoints always answer HTTP 200, including for a bad key, a rate limit or a link that isn't from Instagram, so the Shortcut can always show `message`.

| step | field | example |
|---|---|---|
| save | `ask` | `yes` or `no` |
| save | `prompt` | `Gochujang butter squash. Dinner Thursday?` |
| save | `menu` | list of labels, as above |
| save | `save_id` | `6af8...` |
| save | `message` | shown when `ask` is `no` |
| confirm | `has_event` | `yes` or `no` |
| confirm | `event_title`, `event_location`, `event_notes` | flat text fields, so no nested dictionaries are needed |
| confirm | `event_start_text`, `event_end_text` | `Nov 19, 2026 at 6:30 PM` (the user's timezone, US English) |
| confirm | `reminders` | list of `{title, due_text, notes, url}` |
| confirm | `message` | `Added to Thursday.` |

## Troubleshooting

These first two come from the original prototype's testing on a real iPhone (`prototype/README.md`).

- **"That wasn't an Instagram post link."** The Shortcut ran with no input. Run it from Instagram's share menu, not with the play button in Shortcuts, and check that `input` is set to the `INPUT` variable token.
- **Can't connect.** The phone has to reach `BASE`. On a laptop, use a tunnel (`cloudflared tunnel --url http://localhost:3000`) and put its https address in step 1 and in `PUBLIC_BASE_URL`.
- **"Your Realize key doesn't work."** Paste the key again in step 2. Making a new key in Settings stops the old one.
- **The event lands at the wrong time.** If Get Dates misreads `event_start_text`, use `event_start_iso` and `event_end_iso` instead (and `due_iso` for reminders). They carry the timezone offset.
- **A second share of the same reel** answers "You saved this on Nov 14. Plan: Thu 6:30 pm." and adds nothing.
- **Undoing a plan in the app** doesn't remove what the Shortcut already added. The app says so: "If it's on your phone's calendar, delete it there too."
