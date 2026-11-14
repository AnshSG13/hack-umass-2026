# Reel Brain mockups

A clickable, phone-sized mockup of the **Home** dashboard and the **Reel page** (recipe card). It is the visual reference for `SPEC.md` sections 18 and 19.

## Open it

It is one static page with no build step.

```
cd mockups
python3 -m http.server 8080
```

Then open `http://localhost:8080`. On a laptop it shows inside a phone frame; in a narrow window or on a phone it fills the screen. Opening `index.html` directly from disk also works.

## What you can click

**Home**
- The first reel in "Recently saved" is processed live, then turns into a finished card and the save counts go up.
- Tap **Weeknight Pad Thai** to open the Reel page.
- **Add** opens the "Add a reel" sheet. Saving a pasted link starts a second live reel; pasting again says it's already saved.
- Hold the glowing button to see the listening state.

**Reel page**
- The servings stepper rescales every ingredient amount.
- Ingredients tick off when tapped.
- The category pill opens the "File under" sheet and moves the reel.
- "What's said in the video" expands the transcript.

Everything else shows a short "not in this mockup yet" message.

## Notes

- All names, reels, counts and the recipe are sample content.
- Photos are public-domain (CC0) images from rawpixel and StockSnap, found through Openverse. They stand in for reel thumbnails.
- Fonts load from Google Fonts: Hedvig Letters Serif and Figtree.
- The mockup is plain HTML, CSS and JavaScript. The real app is built in Next.js (see `SPEC.md`); copy the look and measurements, not the code structure.
