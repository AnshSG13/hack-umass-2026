---
name: beli-inspired-ui
description: The look the project owner asked for on 2026-11-14, "aesthetic like Beli" (the restaurant ranking app). Use when designing or restyling any screen of the web app, choosing colours, type, spacing or components. A reference for the feel, not a licence to copy Beli's brand.
---

# A Beli-like look for this app

The owner wants the app to feel like Beli. This file says what that means in concrete terms, so the look doesn't have to be re-derived each time. Use it together with `frontend-design` (how to design well) and `web-design-guidelines` (the review pass). On aesthetic direction this file wins over `frontend-design`'s defaults, because the direction has been chosen.

**Borrow the principles, not the brand.** Do not use Beli's name, wordmark, logo, photos or exact brand colour in the product. Pick this app's own accent in the same family and its own wordmark.

## Where this comes from

Beli's own app screenshots on beliapp.com (feed, list filters, map), viewed on 2026-11-14, with colours sampled from the image pixels. Three design critiques from Pratt (2022, 2024, 2026) were read for the interaction side. Nothing here comes from inside the real app, so treat sizes as estimates and colours as measured from marketing images.

## The feel in one paragraph

A white page, near-black text, and one dark accent that does all the work. Photos and people's names carry the colour; the interface stays out of the way. It is dense but calm: small type, tight rows, hairline dividers, generous side margins. Nothing has a shadow or a gradient except a dark fade over photos so white text can sit on them. It reads like a well-set list, not like a dashboard.

## Colour

Measured from the screenshots:

| Role | Value | Where it appears |
|---|---|---|
| Page and sheets | `#FFFFFF` | every surface |
| Accent (dark teal) | `#254D5A` | primary button, the selected option card, the centre "+" tab, the wordmark, text links like "See all" and "Clear all" |
| Warm signal (coral) | `#D3706C` | the liked heart, the notification badge. Nothing else. |
| Search field fill | `#EDEDED` | the rounded search box |
| Chip fill | `#EBEDF3` | filter pills |
| Selected segment | `#EFF1F2` | the chosen part of a segmented control |
| Hairline | a light grey, 1 px | row dividers, option card borders |
| Score colours | green for good, yellow for middling | the number inside the score ring, and map pins |

Rules that follow from it:

- **One accent.** Filled accent means "this is the main action" or "this is selected". If two things on a screen are filled with it, one of them is wrong.
- **Colour is information.** Coral means "you liked this" or "something new". Green and yellow mean a score. Don't use any of them as decoration.
- **Greys are cool and very light.** Fills are barely off white; there is no mid-grey panel anywhere.

## Type

- **Interface:** a plain, slightly geometric sans (the app looks like the iOS system font; the website uses Proxima Nova). On the web use the system stack or one quiet sans the project already loads. No display face in the interface.
- **Wordmark only:** a lowercase, high-contrast serif in the accent colour. That single serif is the personality; keep serifs out of everything else.
- **Weight carries hierarchy, not size.** A feed line reads "**Emily** ranked **da Umberto**": the names are bold, the verb is regular, all one size. Do this instead of making things bigger.
- **Section labels** are tiny, uppercase, bold and letter-spaced ("FEATURED LISTS", "YOUR FEED"), with a quiet text link at the right end of the same line. Note that `CLAUDE.md` bans all-caps labels; if that rule stands, keep the small bold label and drop the capitals.
- **Supporting lines** (a neighbourhood, "2 minutes ago", "783 restaurants") are smaller and grey, directly under the line they explain.

## Shape and spacing

- Corners: about 8 px on cards and buttons, full pills for chips and the search field, circles for avatars, the score and the centre tab.
- Borders, not shadows. An unselected option card is white with a 1 px light border; selected, it is filled with the accent and its text turns white.
- Side margins around 16 to 20 px. Rows are separated by a hairline or by space, never by boxes.
- Touch targets stay at 44 px or more even when the type is small.

## Components worth copying in spirit

- **Score ring.** A small circle with a thin light outline and a one-decimal number inside, coloured by how good it is. It sits at the right end of a row. This is Beli's signature. The equivalent here is whatever single fact a ticket is about (the planned time, or how sure the plan is); pick one and give it the same weight and position.
- **Feed row.** Round avatar, one sentence with bold names, a grey line under it, the score ring at the right, then optional notes ("**Favorite dishes:** chicken parm") and a row of line icons (heart, comment, send).
- **Photo card rail.** A horizontal row of photo cards with a dark fade at the bottom, a bold white title and a progress line ("You've been to 3 of 10").
- **Chips.** Light pills with a small icon and a label, in a row under the search field.
- **Tab bar.** Five items, line icons with tiny labels, and a filled accent circle with a "+" in the middle for the main action. The selected tab must be clearly darker than the rest (one critique found Beli's own too subtle).
- **Filter sheet.** A grabber, a round close button, a two-column grid of option cards (icon, bold title, small grey count), a segmented control for sorting, plain rows with an icon and a chevron, and a footer with a text link on the left and the filled primary button on the right.
- **Progress as feedback.** "3 of 10", a progress bar toward unlocking something, a short celebratory line at a milestone. Small, factual, encouraging.

## What to avoid

- Gradients, glows, glass, drop shadows, coloured section backgrounds.
- More than one filled button in view, or accent-coloured decoration.
- Big headings. If a screen needs a 28 px title to feel organised, the rows aren't doing their job.
- Pastel category colours on everything. A category can have a small icon; it doesn't get its own background.
- Rows of look-alike icon buttons with no labels (a critique flagged this in Beli itself). Give the main action words.
- Pressure patterns from Beli's onboarding (forced invites, a button that looks disabled). Not part of the look worth copying.

## How this differs from what the app has now

As of 2026-11-14 the web app follows the archived mockup (`web/app/mock.css`): serif headings, pastel colours per category, a glowing centre button. Moving to this look would mean a single accent in place of the pastels, sans headings, flat borders in place of soft fills, and a plain "+" in place of the glow. The owner asked for no changes yet, so treat this as the brief for when they say go, and confirm the accent colour and the wordmark with them first.

## Checking the result

Take screenshots at 390 x 844 with `webapp-testing` and compare them against the points above, then run `web-design-guidelines` on the changed files. Ask of each screen: is there exactly one filled accent element, is every colour telling the reader something, and could the type be one size smaller and still be clear?
