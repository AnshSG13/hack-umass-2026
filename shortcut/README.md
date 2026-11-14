# The iOS Shortcut

The Shortcut is how a reel gets from Instagram into Realize. It sends only the reel's link, shows the plan as a menu, and writes the calendar event and reminders on the phone itself. It is built by hand in the Shortcuts app; these are the steps.

Nothing is added to Calendar or Reminders unless you pick an option from the menu.

## What you need

- The site's address (`BASE`), for example `https://realize.example.com`. For local testing, run `cloudflared tunnel --url http://localhost:3000` and use the tunnel address.
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
