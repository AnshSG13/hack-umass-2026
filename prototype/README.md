# Share-from-Instagram prototype

A local test app with no dependencies, no Expo and no build step. Reels shared from Instagram show up in a web app you open in the phone's browser.

```
node server.js          # or: PORT=4000 node server.js
```

Open `http://localhost:3000` on the computer, or one of the printed `http://<LAN-IP>:3000` addresses from a phone on the same Wi-Fi.

| How you share | Path | Setup |
| --- | --- | --- |
| iPhone: Instagram → Share to… → Shortcut | `POST /share` `{url, token}` | Build the Shortcut (steps are in the page under "Set up sharing") |
| Android: Instagram → Share via… → Brain | `GET /share-target` (Web Share Target) | Open the page over HTTPS (`npx ngrok http 3000`), then Chrome ⋮ → Install app |
| Anywhere: Copy link → paste | `POST /share` | None |

## iPhone Shortcut setup (tested, works)

1. **Shortcuts** app → **+** → add the action **Get Contents of URL**.
2. Tap **ⓘ** → turn on **Show in Share Sheet**. At the top, set "Receive **URLs** and **Text** from Share Sheet".
3. In Get Contents of URL:

   ```
   URL            http://<YOUR-LAN-IP>:3000/share
   Method         POST
   Headers        (none)
   Request Body   JSON
      url    (Text) → [Shortcut Input]   ← pick the blue variable, don't type it
      token  (Text) → me
   ```
4. Optional: add **Show Notification** "Saved!". Name the shortcut **Save to Brain**.
5. In Instagram, open a reel → **Share** → **Share to…** (or **More**) → **Save to Brain**. Tap **Allow** the first time iOS asks to connect.
6. The terminal prints `Saved reel: https://www.instagram.com/reel/... (shortcut, token=me)` and the reel appears in the page within 3 seconds.

**Troubleshooting**
- `Rejected share ... {"url":""}`: the Shortcut ran without input. Run it from Instagram's share menu, not ▶ in Shortcuts, and check that `url` is set to the Shortcut Input variable.
- Can't connect: put the phone on the same Wi-Fi and allow Node.js through Windows Firewall on Private networks. Or run `npx ngrok http 3000` and use the https URL.

Other routes: `GET /reels[?token=]`, `DELETE /reels/:id`, `GET /config`.

Data is kept in memory and resets on restart. `status` steps through queued → downloading → processing → ready on a timer as a stand-in for the real worker. The server only receives the reel link; fetching the video is the worker's job.
