# Reelize

**Saved reels, turned into plans.** Share an Instagram reel, and Reelize watches the video, finds a free time in your week and hands back a plan you confirm with one tap.

Try it: [https://140-82-6-164.sslip.io](https://140-82-6-164.sslip.io) (tap **Try the demo**, no account needed)

## Inspiration

We all have a folder of saved reels we never open again: the recipe for "this week", the workout to try, the restaurant to book, the weekend trip. Saving takes one tap. Doing takes a time, a grocery list and a reminder, and that part never happens.

A save is an intention without a time. We wanted the moment you save something to be the moment it gets a place in your week. In short, bring back intentional scrolling.

## What it does

1. **Share a reel.** From Instagram's share menu (an iPhone Shortcut), or paste the link into the web app on your Home Screen.
2. **It watches the video.** Gemini reads the caption, the speech and the text on screen, and works out what the reel is: a recipe, a workout, a place, an event, a product or a tip.
3. **It hands back a plan.** For a recipe, that's something like *Cook Wed 6:30 pm, +9 groceries*, in a free slot of your week, with a grocery reminder. One tap puts it on Apple or Google Calendar. Nothing is added without your yes.

Then each reel becomes something you can use:

- **Ask any reel a question.** "Can I make this ahead?" Answers point to the moment in the video ("said at 0:11"). When the reel doesn't say, it searches the web and shows its sources. Ask for nutrition and you get the recipe's published numbers, with a link to where they come from.
- **Ask across everything you saved.** "What can I cook this week?" or "Where did I want to eat?" Ask searches your saves by meaning and by words, and shows the reels it used. Chats are kept, so you can pick them up later.
- **Make it a trip.** A place reel becomes a day-by-day plan with stops, prices and the forecast, every fact with its source.
- **Send it.** An itinerary, an invite or a grocery list, ready to text a friend.
- **Home is for doing, Folders for browsing.** Home shows your week and what's ready; Folders sorts saves by what you're into, with a map of how they connect.

## How we built it

- **Gemini.** It watches each video through the File API and returns structured output: a transcript with timestamps, on-screen text and typed fields. A planner agent uses manual function calling (`search_saves`, `find_free_slot`, `propose_plan`) and shows every step it takes. Ask is a second agent over your saves that streams its steps. Google Search grounding answers what a reel doesn't cover, and `gemini-embedding-001` embeds every save.
- **MongoDB Atlas** is the database, the job queue and the search engine. Vector Search and Atlas Search are fused with `$rankFusion` for hybrid search. Atomic job leases use `find_one_and_update`, TTL indexes expire demo accounts, and thumbnails live in Atlas too.
- **The model proposes, code decides.** Dates, free slots, reminder times and calendar entries are computed in Python, never written by the model. Every entity Gemini returns is checked against the caption, transcript and on-screen text. When the model is slow or unavailable, a deterministic fallback still produces a plan.
- **Stack:**
  - FastAPI and a separate worker in Python 3.12
  - a Next.js App Router web app built to be added to the iPhone Home Screen
  - yt-dlp to fetch public reels
  - Open-Meteo for weather
- **Vultr.** One VPS runs the API, the worker, the web app and Caddy (automatic HTTPS) from Docker Compose. GitHub Actions redeploys it on every push to `main`.

## Challenges we ran into

- **Running out of model quota mid-build.** Our Gemini key hit its free-tier limit while we were building the planner. Instead of stalling, we built fallbacks: if the model is busy, the plan is derived in code from what the video already gave us, and it upgrades once the model answers.
- **Time is harder than it looks.** A plan waiting for an answer could still offer a time that had already passed, and two recipes could both hold "Wed 6:30 pm" and both be confirmed into it. Slots are now checked again in code every time a plan is shown or confirmed, so a taken or past time is swapped for a fresh one.
- **One number per recipe.** At one point the reel page estimated 386 kcal for a curry while the chat quoted 484 from the recipe's own site. Now published numbers win everywhere and carry their source, and an estimate is labelled as one.
- **The iPhone Shortcut.** iOS dropped HTTP/3 connections from the Shortcuts app with "The network connection was lost". Turning HTTP/3 off in Caddy fixed it.
- **Instagram itself.** Private reels, empty media responses and missing video formats all happen. Each one gets a plain failure message, and the save is never lost.
- **Restarts mid-save.** A server restart could leave a reel stuck on "reading" forever. A small sweeper in the worker now restarts anything that has gone quiet.

## Accomplishments that we're proud of

- **Speed.** On our 16 sample reels, a shared reel came back as a plan in a median of 4.75 seconds (3.9 to 6.7 s), well inside the Shortcut's 20 second wait. All 16 were typed correctly.
- **Search.** On our own 20-question test set, hybrid search put the right reel first 19 times and in the top three all 20 times. Several of those questions use words only spoken in the video, never written in the caption. The set is small, so we treat it as a smoke test, not a benchmark.
- **Honest by design.** Nothing from the web is shown without a link, and no plan lands on your calendar without your tap.
- **A first open that tells the story.** "Try the demo" walks you through the problem, saving a real reel and the plan it becomes, then the answers it can give.
- **Live from day one,** on our own server with HTTPS and deploys on every push.

## What we learned

- Let the model read and propose, and let code commit. Splitting the work that way made the app both smarter and more trustworthy.
- Video understanding is the unlock. Captions rarely carry the recipe amounts or the workout reps; the video almost always does.
- Searching the transcript, not just the caption, is what answers "that reel where she said…" questions.
- Showing the agent's steps ("Checking your week") makes waiting a few seconds feel fine.

## What's next

- Reminders and check-ins as push notifications ("Did you make the curry?")
- Plans with friends: one invite, one shared trip
- TikTok and YouTube Shorts, not just Instagram
- Learning your rhythm: which nights you actually cook, which weekends you travel

## Built with

`gemini` `google-search-grounding` `mongodb-atlas` `atlas-vector-search` `atlas-search` `python` `fastapi` `next.js` `typescript` `react` `tailwind` `docker` `caddy` `vultr` `github-actions` `yt-dlp` `ios-shortcuts` `open-meteo`
