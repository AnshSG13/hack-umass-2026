# Reelize: design

Source of truth for UI. If a skill's defaults disagree, this wins.

## 1. Idea
Every save becomes a ticket you redeem. Plan card = ticket stub: the top half is the saved reel, a perforated line, the bottom stub is the plan. Add punches the ticket. Done tears the stub off into your completed stubs. Saved, planned, done in one object. The ticket is the one bold element; everything else is quiet.

## 2. Tokens (CSS variables on :root, mapped into the Tailwind theme)
| token | value | use |
|---|---|---|
| --ink | #1B2430 | text, icons, primary borders, focus ring |
| --paper | #F3F5F7 | app background |
| --ticket | #FFFFFF | surfaces |
| --highlighter | #FFD23F | plan time mark, primary button fill (ink text on it) |
| --done | #2E8B57 | punched/done fills and icons only (4.2:1 on white, too low for body text) |
| --done-ink | #1F7A4D | done text (5.3:1 on white) |
| --muted | #5A6472 | secondary text (5.5:1 on paper, 6.0:1 on white) |
| --line | #E1E5EA | decorative hairlines, ticket border |
| --line-strong | #7D8794 | input borders, perforation (3.3:1 on paper) |
| --danger-ink | #A3352B | destructive text (6.8:1 on white) |
Measured: ink on highlighter 10.8:1. Light theme only: `color-scheme: light`, theme-color #F3F5F7. Flat: no gradients, no drop shadows on cards.

## 3. Type
Archivo through next/font/google as a variable font with `axes: ["wdth"]`.
- Stub time ("Thu 6:30 pm"): Archivo, `font-stretch: 125%` (wdth 125), weight 600, 28px/1.1, tabular numbers. Printed large, like a ticket.
- Wordmark "Reelize": wdth 125, weight 600, 20px.
- Landing headline: wdth 125, weight 600, 34px/1.1.
- Page title: weight 600, 24px. Ticket title: 600, 17px/1.3, 2-line clamp.
- Body 16px/1.5 weight 400. Small 14px. Meta 13px muted (minimum size anywhere). Inputs 16px (prevents iOS zoom).
- Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows, no monospace except inside the raw tool-call JSON viewer.

## 4. Layout
- Phone first (390 px). Side padding 16. Content max width 440, centered. 4-pt spacing grid; 24 between sections.
- Header (56 px): wordmark left, "Demo" badge after it for demo users, Settings icon button right (aria-label "Settings").
- Bottom tab bar (64 px + safe area): Home, the Ask orb in the middle, Folders. Each tab has one job: Home is for doing (the week, what's waiting, what to buy), Ask is for asking, Folders is for browsing what you saved. Active = ink label; inactive = muted. (Changed 2026-11-15 at the owner's request; before, the tabs were Home, Ask, Actions.)
- Desktop at 1100 px or wider: app column (440) plus side panel (560) titled "How it was planned", showing the selected ticket's agent trace (and the map if built). Below 1100: the trace opens in a bottom sheet.
- Radii: ticket 16, buttons 12, inputs 12, chips full. Buttons: primary 48 px high, others at least 44 px.
- Left-aligned text. The ticket's side notches are the only non-rectangular shape in the app.

## 5. The ticket (hero component; build it first)
Anatomy:
- Container: --ticket, 1px --line border, radius 16.
- Reel half (padding 16): thumbnail 72x96 radius 8 (alt = title) | type label (Lucide icon + text, 13px muted: Recipe, Event, Place, Workout, Product, Tip, Other), title, "@creator · Saved Oct 3" (13px muted). Sample saves add a "Sample" tag (1px --line-strong outline pill, 13px).
- Perforation: 20 px circles in --paper cut into the left and right edges (aria-hidden), joined by a 1.5px dashed --line-strong line (dash 6, gap 6).
- Stub (padding 16): contents by state below.

Kind icons: recipe ChefHat, event CalendarDays, place MapPin, workout Dumbbell, product ShoppingBag, tip Lightbulb, other Bookmark.

States (exact copy):
1. Printing (agent working): agent step lines (section 6). Over 12 s: "Still reading. Long reels take a moment." Still queued after 30 s: "This one will finish in the background. It'll be in Waiting on you." Live reading offline: "Live reading is offline right now. The samples still work."
2. Proposed, actionable: big time with a highlighter mark behind it (highlighter background, 0 4px padding) + secondary text ("+3 groceries", 14px muted) on the same line. Why line (14px muted): "Because you cook weeknights and Thursday's free." Confidence: CircleCheck + "Sure" or CircleDashed + "Best guess" (13px ink). Primary button full width: highlighter fill, 2px ink border, ink text, web_label ("Add to Thursday"). Under it, three 44 px text buttons: "Change", "Not now", "Just vibes".
3. Proposed, not actionable: big text "No plan needed" (wdth 125, 22px). Why line. Primary "Remind me in a week" (if offered), text button "Just save".
4. Accepted: a punch hole (20 px --paper circle, 1px --line border) at the stub's top-right; highlighter mark removed; big time stays; line "Added to Thursday" with Check icon in --done-ink. If confirmed_via is web: links "Add to Google Calendar" and "Download for Apple Calendar" (14px, underlined, ink). If confirmed_via is shortcut: "On your phone's calendar" (muted). reminders_preview as muted lines ("Reminder: Groceries, Thu 12 pm"). Overflow menu (MoreHorizontal, aria-label "More"): "Change time", "Undo".
5. Follow-up due (accepted, end passed): "Did you make it?" (recipe), "Did you do it?" (workout), "Did you go?" (place); otherwise "Did it happen?". Primary "Done", text button "Skipped it".
6. Done: the stub's top edge becomes a torn zigzag (clip-path); "Done Thu" with CircleCheck in --done-ink. In lists it shows as a mini stub (7.4).
7. Skipped: "Skipped" muted + text button "Plan again".
8. Declined (just vibes / just save): no stub or perforation; one muted line at the bottom: "In your library".
9. Failed: "Saved. Couldn't read this reel yet." + outline button "Try again" (or the SPEC section 16 message when it's permanent, with no button).
10. Waiting on you: proposed state, shown under the "Waiting on you" heading on Plans.

Compact variant (lists on Plans): one row: thumbnail 48x64, title, big time at 20px wdth 125, status text; tap opens /s/[id].

Change sheet (bottom sheet): title "Pick a time"; radio rows for up to 3 slots ("Sun 12 pm · You're free"); "Other time" with a datetime-local input; primary "Add to {long_day}"; text button "Keep it as is".
Toast (custom component, bottom, above the tab bar, opacity 120 ms, 6 s): "Added to Thursday." + "Undo" button. Others: "Marked done.", "Marked skipped.", "Undone.", "Saved", "You saved this on Oct 3."

## 6. Agent activity (two layers)
- Default layer: plain step lines, using the labels from SPEC 5.5. Each line: icon (current: dot; done: Check; failed: X) + label 15px; done lines add "· 0.4 s" (13px muted). Shown on the printing ticket and in "How it was planned" on the save detail.
- Second layer: a switch "Show tool calls" (off by default). When on, each step expands to the tool name plus args and result JSON in collapsible blocks (monospace 13px, ink on --paper, horizontal scroll). For technical judges.
- ARIA: the step list is aria-live="polite"; when a plan arrives announce "Plan ready: {label}".

## 7. Screens
### 7.1 Landing `/` (no key)
- Headline "Every save becomes a plan."
- Sub: "Share a reel from Instagram. Reelize reads it, checks your week, and asks before it adds anything."
- Hero: a real Ticket in the proposed state built from the first sample (GET /api/demo/samples); if /landing.mp4 exists, a muted looping clip (playsinline, poster) instead.
- Primary "Try the demo" → creates a demo session → /demo. Loading: "Starting the demo". Error: "The demo didn't start. Try again."
- Secondary "Use it for real" → /setup.
- Footer (13px muted): "Built at HackUMass XIV."
### 7.2 Samples `/demo` (demo users)
- Intro: "This is what happens when you share a reel from Instagram."
- Sample cards: thumbnail, creator, caption excerpt (2 lines), "Sample" tag, button "Save to Reelize" (outline, ink border). After tapping, the card becomes a ticket that prints, then proposes.
- After the first Add: links "See it in Plans", "Ask about your saves".
- Paste box: label "Paste your own reel link", button "Read it", helper "Runs live. Takes 10 to 30 seconds."
- End card (after the first Add): "Want this on your phone? Set it up in 1 minute." button "Set up on iPhone" → /setup.
- Header action: "Start over" (new demo session).
### 7.3 Setup `/setup`
- Title "Set up on iPhone".
- No key yet: primary "Create my account" → POST /api/users. Then the key box: the key in 16px, "Copy key" → "Copied", note "Keep this. It's your account. There's no password."
- Desktop: "Open this on your iPhone" + QR code (SPEC 13.2) + "Or copy the key and open this page on your phone."
- iPhone steps (numbered, one action each):
  1. "Copy your key" (Copy key).
  2. "Add the Shortcut" (button → shortcut_url). Helper: "When it asks for your key, paste it." If shortcut_url is empty: "Shortcut link isn't ready yet."
  3. "The first time, iOS asks to allow network, Calendar and Reminders. Tap Allow."
  4. "Try it: open this reel, tap Share, then Reelize." (button "Open the reel" → first_save_reel_url). Polls for a save newer than page load; then "Got your first save!" and its ticket.
- Android: "Reelize works on iPhone for now. Paste reel links here instead." + paste box.
- Demo users also see: "Judges: use the judge Shortcut, no key needed." (→ judge_shortcut_url).
### 7.4 Home `/home` (doing; `/plans` redirects here)
- Greeting, "This week, Nov 14 to Nov 20" (muted), and a full-width "Save a reel" button.
- "Just saved": the reels added in this visit, with their reading progress, until they're read.
- "Did you do it?": plans whose time has passed, as cards with Done, Skipped and Move it.
- "Your week": a strip of the next seven days (today first, dots for plans, a ring for free time). The chosen day shows its plans; a day with free time from the person's settings shows "Free to cook · Thu 6:30 pm" with up to two saves that fit and "Add to Thu" (one tap, toast with Undo). An empty day offers "See free time on {day}".
- "Waiting on you": full tickets in the proposed state; only the first has the filled button. "Ready for you" bundles, then the folded Missed group.
- "Shopping list": the ingredients of this week's planned recipes, merged, with tick boxes (kept in this browser) and "Send".
- "Started", "Done this week", then "After this week: {n} more".
- Empty account: "Nothing saved yet" + "Add a reel".
### 7.5 Folders `/library` and save detail `/s/[id]`
- Title "Folders", sub "{n} saves". Not searching: the remember card, "Recently saved" rail with Add, "Your folders" (one tile per type, opening `/t/{type}`) with "See how they connect", "Ask about your saves", then "All saves". The type chips below are replaced by the folders.
- Search field, placeholder "Search what was said or shown" (300 ms debounce). No results: "Nothing matches “{q}”. Try a word they said in the video."
- Type chips (44 px): All, Recipes, Events, Places, Workouts, Products, Tips, Other, each with a count.
- Rows: thumbnail 56x75, title, "{Type} · Saved Oct 3", plan status text ("Thu 6:30 pm", "Waiting on you", "No plan", "Done", "Reading", "Watching the video").
- Empty: "Every reel you share lands here, plan or not." + "Paste a reel link" (opens the paste sheet: field "Instagram reel link", button "Save it").
- Save detail: full ticket; then type sections: Recipe (Ingredients "2 tbsp gochujang", numbered Steps, Tips); Event (date, venue, Tickets link); Place (each place with why and tip); Workout (rows "Name · 3 × 10 · rest 60 s", cues); Product (items with price hint and where to buy); Tip (key points, takeaway). Unverified names show "Not found in the video. Double check." (13px, AlertTriangle icon).
- "What's in the video" (collapsible, closed by default): transcript lines "0:12  …" and an "On screen" list. If enrich_error: "Couldn't watch the video: {reason}. The plan uses the caption."
- "How it was planned": section 6.
- Actions: "Open on Instagram" (outline); overflow: "Plan again", "Delete". Delete sheet: "Delete this save? Its plan goes too." Buttons "Delete" (danger-ink text) and "Keep it".
- Enriching line (static Clock icon, no spinner): "Watching the video for details."
### 7.6 Ask `/ask`
- Title "Ask".
- Empty: "Ask about anything you've saved." plus up to 4 chips built from the user's data (no LLM): "Find that {most recent title} reel"; if 2 or more recipes, "Plan my dinners this week"; if any places, "Where did I want to eat?"; if any workouts, "What workouts did I save?"; fallback "What did I save this week?".
- User message: right-aligned, --ticket surface, 1px --line border, radius 12. Answer: plain text, no bubble.
- While working: step lines (section 6).
- Cards: horizontal scroll of reel cards (thumbnail, title, "Saved Oct 3", 2-line snippet); tap opens /s/[id]. Plans from propose_plans render as compact tickets with their primary button.
- Confidence none: "Nothing in your saves matches that. Closest ones:" + cards. Low: answer, then a muted line "Best match I found."
- Error: "Ask didn't answer. Try again." + "Try again".
- Composer: textarea (16px), placeholder "Ask about your saves", send icon button (aria-label "Send"), 44 px.
### 7.7 Plan page `/p/[id]?t=`
- Ticket in its accepted or follow-up state. Primary "Done", text button "Skipped it", link "Open Reelize".
- After Done: tear motion, then "Nice. Marked done." After Skipped: "Marked skipped."
- Bad token: "This link doesn't open a plan. Open Reelize to see your plans."
### 7.8 Settings `/settings`
- "Your week": cook nights (Mon to Sun toggle chips) + time; workout days + time; weekend time.
- "Fewer pings": stepper "At most {n} plans a day" (1 to 5); "No reminders between {from} and {to}"; switches per type ("Recipes", "Events", …) with helper "Off means saves of this type go to your library with no plan."
- "Time zone": select, auto-detected.
- "Your key": "Key ending {preview}", "Copy key" (from this device), "Make a new key" (confirm: "Your Shortcut stops working until you paste the new key."), "Sign out on this device" (confirm: "Copy your key first. There's no password, so without it this account is gone.").
- Demo users: banner "Demo account. It deletes itself in 24 hours."
- Every change auto-saves with the toast "Saved".

## 8. Motion (only these three; nothing else animates)
1. Print: each step line enters when its real step arrives: opacity 0→1 and y 4px→0 over 140 ms ease-out. Lines that arrive together stagger 60 ms. No fake delays. The current step's dot pulses opacity 1↔0.4 on a 1 s loop until it's done.
2. Punch: on a successful Add, the punch hole scales 0→1.15→1 over 220 ms; the highlighter mark fades out over 160 ms; the label swaps.
3. Tear: on Done, the stub rotates -4° and moves down 12 px while fading out over 320 ms (ease-in), then the ticket collapses its height over 200 ms, then the mini stub fades into "Done this week" over 160 ms.
`prefers-reduced-motion`: all three become opacity cross-fades of 120 ms or less; no pulse.
No page transitions, hover lifts, skeleton shimmer or confetti. Toast: opacity only.

## 9. States to screenshot (390x844 and 1440x900)
Landing; Samples (before save, printing, proposed, accepted); Setup (desktop QR, iPhone steps, first save received); Plans (empty, loading, with waiting + week + done); Library (empty, list, search no results); Save detail (recipe, event, place, failed, enriching, tool calls on); Ask (empty with chips, answer with cards, confidence none, propose_plans tickets); Plan page (follow-up due, done, bad token); Settings (real, demo); Change sheet; Toast with Undo.
Checklist for each: one obvious next action; every state designed; text contrast as in section 2; targets 44 px or larger; no horizontal scroll at 390; nothing decorative that does nothing (remove one accessory if in doubt); copy matches this file exactly.

## 10. Accessibility floors
- Tap targets 44x44 minimum, 48 for primary buttons.
- Never color alone: every status has text plus an icon.
- Visible focus: 2px --ink outline, 2px offset, on every interactive element (also visible on highlighter).
- Reduced motion per section 8.
- Every image has alt = title; notches and decorative shapes aria-hidden.
- Inputs have labels; errors linked with aria-describedby.
- Transcripts on every enriched save make reels usable for deaf and hard-of-hearing users.

## 11. Copy rules
Buttons say exactly what happens ("Add to Thursday" → toast "Added to Thursday."). Sentence case. No "→" or "->" on buttons. No em dashes. No "Sorry"; empty and error states give a direction. The only exclamation mark: "Got your first save!". Never show a number that wasn't measured or counted.

## 12. Avoid (generic AI-app tells)
Cream background with terracotta accent; dark background with acid accent; identical rounded cards with the same shadow; all-caps eyebrows; monospace data labels; gradient orbs; sparkle-icon spam; long chat text walls.
