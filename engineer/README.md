# ENGINE build

Static build of your WordPress export, styled to match your Local
theme screenshot (BASIC line numbers, REM tagline, bracketed nav,
sidebar with search + recent posts, dotted dividers, "RUN THIS ENTRY"
links).

## Fonts
No specific font was required, so I picked a pairing for readability
+ retro character:
- Headlines (site title, post titles): "Press Start 2P" — the classic
  8-bit arcade pixel font
- Body text / nav / sidebar: "JetBrains Mono" (bold) — a clean,
  highly readable monospace, so 93 posts of body text don't turn into
  a squinting exercise
Both load from Google Fonts via @import at the top of the CSS in
build.py. Open index.html in an actual browser (needs internet) to
see them — sandboxed previews I generate here fall back to a system
font since I don't have internet access to fetch them myself.

## Layout / responsive fixes (from your browser screenshot)
- Added the viewport meta tag — this was missing entirely, which is
  almost certainly why small screens looked wrong: without it, mobile
  browsers render the page at desktop width and zoom out rather than
  reflowing it
- Widened the outer frame from a fixed 1000px to a fluid max-width of
  1200px, so wide desktop screens waste less space in the black
  margins
- Fixed the sidebar overflowing past the purple background (a CSS
  Grid quirk — a text column won't shrink below its content's natural
  width unless told to)
- Added responsive font-size steps for the pixel-font headlines at
  820px and 480px breakpoints, since Press Start 2P is wide per
  character and needs to shrink on small screens

## Structure
- posts/<slug>.md, pages/<slug>.md — source content (edit these)
- scripts/build.py — regenerates index.html, style.css, and every
  posts/<slug>/index.html + pages/<slug>/index.html from the Markdown
- assets/img/ — where copy_media.sh drops your images (empty until
  you run it)

## To build
    python3 scripts/build.py

Re-run any time you add or edit a .md file.

## Search
No backend on GitHub Pages, so this is a client-side JS search over
post titles only (not full text).

## Known gaps
- Images/video won't show until you run copy_media.sh (from the
  migration package) — update LOCAL_UPLOADS at the top of that script
  first
- 4 posts (74-2, 78-2, 87-2, alturas-co-mail-delivery) link out to
  VideoPress per your call, rather than embedding local video
- I don't have a screenshot of an individual WordPress post page or
  the About/page template — single-post pages here reuse the same
  header/nav but skip the sidebar
- Links are relative throughout, so this works both opened directly
  in a browser AND once pushed live under EHsaTurpentine.github.io/ENGINE/
