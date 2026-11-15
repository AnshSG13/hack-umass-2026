# Reelize

Reelize turns the Instagram reels you save into plans. You share a reel, it watches the video, finds a free time in your week, and asks if you want to do it then.

Live demo: https://140-82-6-164.sslip.io (hit "Try the demo", no sign-up)

## Inspiration

All of us have a saved folder full of recipes we were going to make "this week", workouts we were going to try and restaurants we meant to book. Saving is one tap, so we save everything. Actually doing any of it needs a time, a grocery run and someone to remind you, and that's where it dies.

We kept saying a save is an intention without a time. So the idea was simple: the moment you save something, it should get a slot in your week.

## What it does

You share a reel from Instagram (we built an iPhone Shortcut for the share menu) or paste the link into the web app. Gemini watches the video along with the caption, figures out what kind of reel it is, and pulls out what matters: the ingredients and steps for a recipe, the moves for a workout, the name and city for a restaurant.

Then it proposes something concrete. For the Budget Bytes chickpea curry in our demo, that's "Cook Wed 6:30 pm, +9 groceries", in an evening that's actually free, with a reminder to shop at noon that day. You tap once and it goes on your Apple or Google calendar. It never adds anything you didn't confirm.

There's more you can do with a saved reel:

- Ask it questions. "Can I make this ahead?" gets an answer from the video, with the second it was said. If the reel doesn't cover it, it searches the web and links the pages it used. You can also just say "search the web for…".
- Ask about everything you've saved, like "where did I want to eat?". It searches your saves by meaning and by keyword and shows the reels it found. Chats are kept so you can come back to them.
- Turn a place into a trip: day-by-day stops, prices and a forecast, with sources.
- Make something to send: an itinerary, an invite or a grocery list you can text a friend.

The home screen is your week and what's ready to do. Folders is where you browse by interest.

## How we built it

The backend is FastAPI with a separate worker, in Python. The worker downloads public reels with yt-dlp and sends the video to Gemini through the File API, which gives us back a timestamped transcript, the text on screen and typed fields like ingredients. A planner agent then uses function calling (search_saves, find_free_slot, propose_plan) to put together a proposal, and the app shows each step it takes while you wait.

One rule shaped most of the code: the model reads and suggests, and our code handles anything that has to be right. Dates, free slots, reminder times and calendar entries are all computed in Python. Entities the model pulls out are checked against the caption and transcript, and if the model times out there's a fallback that still produces a plan.

MongoDB Atlas does a lot of work here. It's the database, the job queue (leases with find_one_and_update) and the search. Search combines Atlas Vector Search over Gemini embeddings with Atlas Search keyword matching through $rankFusion, so you can find a reel by something someone said in it. Demo accounts clean themselves up with TTL indexes.

The front end is a Next.js web app meant to be added to the iPhone home screen. Everything runs on one Vultr VPS with Docker Compose and Caddy for HTTPS, and GitHub Actions redeploys it whenever we push to main.

## Challenges we ran into

We hit Gemini's free-tier limit partway through building the planner and were out of quota for several hours. Saves kept working because of a fallback we'd written early on: when the model is busy, the plan is built in code from what the video pass already found, and it gets upgraded once the model is back. We didn't expect to lean on it that hard, that soon.

Time handling bit us more than once. A plan sitting in "waiting" could still offer a slot that had already passed, and two recipes could both claim Wednesday at 6:30 and both get confirmed. Now slots are rechecked every time a plan is shown or confirmed.

At one point the curry page said 386 calories (our estimate from the ingredients) while the chat said 484 (Budget Bytes' published number). Showing two different numbers for the same dish looked broken, so now the published number wins everywhere and links to its source.

The iPhone Shortcut kept failing with "The network connection was lost". It turned out iOS was dropping HTTP/3 connections from Shortcuts, so we turned HTTP/3 off in Caddy.

Instagram doesn't always cooperate either: private reels, empty media responses, reels with no video. Those saves stay in your library with a plain message instead of failing silently.

## Accomplishments that we're proud of

On our 16 sample reels, the time from sharing a reel to getting a plan back had a median of 4.75 seconds (range 3.9 to 6.7). The Shortcut waits up to 20, so that leaves room. All 16 were classified correctly.

We wrote 20 test questions, several using words that are only spoken in the video and never written in the caption. Search returned the right reel first for 19 of them and in the top three for all 20. It's a small set, so we read it as a sanity check rather than a benchmark.

We're also glad it's live on our own server with HTTPS, and that the first-open demo walks through the whole idea using a real reel.

## What we learned

Splitting the work so the model proposes and code commits made the app easier to trust and easier to debug. Watching the video matters a lot: captions usually leave out the amounts and the reps, and the video has them. When the planner was taking a few seconds, showing its steps ("Checking your week") made the wait feel fine.

## What's next

- Push notifications for reminders and check-ins ("did you make the curry?")
- Planning with friends from one shared invite
- TikTok and YouTube Shorts
- Learning which nights you actually cook and which weekends you're free

## Built with

gemini, google-search-grounding, mongodb-atlas, atlas-vector-search, atlas-search, python, fastapi, next.js, typescript, react, tailwind, docker, caddy, vultr, github-actions, yt-dlp, ios-shortcuts, open-meteo
