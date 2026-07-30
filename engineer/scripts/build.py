#!/usr/bin/env python3
"""
Builds static HTML pages from the Markdown in posts/ and pages/,
using a C64/TRS-80-style template, plus an index page listing
everything in reverse-chronological order.

Run from the repo root:
    python3 scripts/build.py

Regenerates:
    /index.html
    /posts/<slug>/index.html   (one folder per post, so URLs are
                                 /posts/<slug>/ with no .html)
    /pages/<slug>/index.html
"""

import re
import sys
from pathlib import Path
from datetime import datetime
import markdown as md_lib

ROOT = Path(__file__).parent.parent
POSTS_DIR = ROOT / 'posts'
PAGES_DIR = ROOT / 'pages'

FRONT_MATTER_RE = re.compile(r'^---\n(.*?)\n---\n(.*)$', re.DOTALL)


def parse_front_matter(text: str) -> tuple[dict, str]:
    m = FRONT_MATTER_RE.match(text)
    if not m:
        return {}, text
    raw_fm, body = m.group(1), m.group(2)
    fm = {}
    for line in raw_fm.splitlines():
        line = line.rstrip()
        if not line or ':' not in line:
            continue
        key, _, val = line.partition(':')
        key = key.strip()
        val = val.strip()
        if val.startswith('[') and val.endswith(']'):
            items = [v.strip().strip('"') for v in val[1:-1].split(',') if v.strip()]
            fm[key] = items
        elif val.startswith('"') and val.endswith('"'):
            fm[key] = val[1:-1]
        elif val in ('true', 'false'):
            fm[key] = (val == 'true')
        else:
            fm[key] = val
    return fm, body


PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} :: THE INDIFFERENCE ENGINEER.</title>
<link rel="stylesheet" href="{css_path}style.css">
</head>
<body>
<div class="crt">
<div class="screen">
{header}
<main class="single">
<h2 class="entry-title">{title}</h2>
{meta_line}
<div class="content">
{body}
</div>
</main>
</div>
</div>
</body>
</html>
"""

INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>THE INDIFFERENCE ENGINEER.</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="crt">
<div class="screen">
{header}
<div class="layout">
<main class="entries">
{entries_html}
</main>
<aside class="sidebar">
<h3>Search</h3>
<form class="search-form" onsubmit="return false;">
<input type="text" id="search-box" placeholder="">
<button type="button" onclick="runSearch()">SEARCH</button>
</form>
<div id="search-results"></div>
<h3>RECENT POSTS</h3>
<ul class="recent-list">
{recent_html}
</ul>
</aside>
</div>
</div>
</div>
<script>
const SEARCH_INDEX = {search_index_json};
function runSearch() {{
  const q = document.getElementById('search-box').value.trim().toLowerCase();
  const results = document.getElementById('search-results');
  results.innerHTML = '';
  if (!q) return;
  const matches = SEARCH_INDEX.filter(e => e.title.toLowerCase().includes(q));
  if (matches.length === 0) {{
    results.innerHTML = '<p class="no-results">NO MATCH FOUND.</p>';
    return;
  }}
  const ul = document.createElement('ul');
  ul.className = 'recent-list';
  matches.forEach(e => {{
    const li = document.createElement('li');
    li.innerHTML = '<a href="' + e.href + '">' + e.title + '</a>';
    ul.appendChild(li);
  }});
  results.appendChild(ul);
}}
</script>
</body>
</html>
"""

HEADER_TEMPLATE = """<header class="site-header">
<a class="site-title" href="{home_href}">THE INDIFFERENCE ENGINEER.</a>
<p class="tagline"><span class="rem">REM</span> POST TENEBRAS LUX ESTO UMBRAS FINDENS.</p>
<nav class="topnav">
{nav_links}
</nav>
<hr class="double">
</header>"""


def make_header(prefix: str) -> str:
    """prefix is '' for root-level pages (index.html) or '../../' for
    pages nested two levels deep (posts/<slug>/, pages/<slug>/)."""
    nav_items = [
        ('BLOG', 'pages/blog/'),
        ('INDF_ENG', ''),
        ('POINTS', 'pages/points-of-interest/'),
        ('LUDES', 'pages/ludes/'),
        ('ABOUT', 'pages/about/'),
    ]
    nav_links = '\n'.join(f'<a href="{prefix}{href}">[{label}]</a>' for label, href in nav_items)
    home_href = prefix if prefix else '.'
    return HEADER_TEMPLATE.format(nav_links=nav_links, home_href=home_href)

CSS = """
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=JetBrains+Mono:wght@400;700&display=swap');

:root {
  --bg: #40318d;
  --fg: #cbc2ff;
  --dim: #9a8fe0;
  --bright: #ffffff;
  --accent: #ffe066;
  --border: #cbc2ff;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  background: #000;
}

body {
  padding: 1.5rem 1rem;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-weight: 700;
  color: var(--fg);
}

.pixel {
  font-family: 'Press Start 2P', 'Courier New', monospace;
  font-weight: 400;
}

.crt {
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  background: #000;
  padding: 8px;
  border-radius: 4px;
}

.screen {
  background: var(--bg);
  color: var(--fg);
  padding: 2.5rem;
  overflow-wrap: break-word;
  word-break: break-word;
}

@media (max-width: 700px) {
  body { padding: 0.5rem; }
  .crt { padding: 5px; }
  .screen { padding: 1.25rem; }
}

/* ---- header ---- */
.site-title {
  display: block;
  font-family: 'Press Start 2P', 'Courier New', monospace;
  font-size: 1.5rem;
  line-height: 1.6;
  color: var(--bright);
  text-decoration: none;
  letter-spacing: 0.02em;
  margin-bottom: 1rem;
  text-shadow: 2px 2px 0 rgba(0,0,0,0.35);
}

.tagline {
  color: var(--dim);
  margin: 0 0 1.5rem;
  font-size: 0.9rem;
}
.tagline .rem { color: #8a7fce; }

.topnav a {
  color: var(--fg);
  text-decoration: none;
  font-weight: 700;
  margin-right: 1.5rem;
  font-size: 0.95rem;
}
.topnav a:hover { color: var(--bright); }

hr.double {
  border: none;
  border-top: 3px double var(--fg);
  margin: 1.5rem 0 2rem;
}

/* ---- layout ---- */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 2.5rem;
}
.entries, .sidebar {
  min-width: 0;
}
@media (max-width: 820px) {
  .layout { grid-template-columns: 1fr; }
}

/* ---- entries (index) ---- */
.entry {
  margin-bottom: 2rem;
}

.entry-head {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 0.25rem;
}

.line-no {
  color: var(--dim);
  font-size: 1.4rem;
}

.entry h2 {
  margin: 0;
  font-family: 'Press Start 2P', 'Courier New', monospace;
  font-size: 1.05rem;
  line-height: 1.6;
  color: var(--fg);
}
.entry h2 a { color: inherit; text-decoration: none; }
.entry h2 a:hover { color: var(--bright); }

.entry-date {
  color: var(--dim);
  margin: 0 0 0.75rem;
}

.excerpt { margin: 0 0 0.75rem; line-height: 1.5; }

.run-link {
  color: var(--fg);
  text-decoration: underline;
}
.run-link:hover { color: var(--bright); }

.divider {
  border: none;
  border-top: 2px dotted var(--dim);
  margin: 2rem 0;
}

/* ---- sidebar ---- */
.sidebar h3 {
  font-family: 'Press Start 2P', 'Courier New', monospace;
  font-size: 0.8rem;
  color: var(--fg);
  text-transform: uppercase;
  margin: 2rem 0 1rem;
  line-height: 1.5;
}
.sidebar h3:first-child { margin-top: 0; }

.search-form {
  display: flex;
  gap: 0;
}
.search-form input {
  flex: 1;
  border: none;
  padding: 0.6rem;
  font-family: inherit;
  font-weight: 700;
}
.search-form button {
  border: none;
  background: var(--dim);
  color: #000;
  font-family: inherit;
  font-weight: 700;
  padding: 0 1rem;
  cursor: pointer;
}
.search-form button:hover { background: var(--fg); }

.no-results { color: var(--dim); }

.recent-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.recent-list li { margin-bottom: 0.6rem; }
.recent-list a {
  color: var(--bright);
  text-decoration: underline;
}
.recent-list a:hover { color: var(--accent); }

/* ---- single post/page ---- */
.single { max-width: 640px; }
.entry-title {
  font-family: 'Press Start 2P', 'Courier New', monospace;
  font-size: 1.3rem;
  line-height: 1.6;
  margin-bottom: 0.5rem;
}
.meta { color: var(--dim); margin-bottom: 1.5rem; }

.content img, .content video {
  max-width: 100%;
  display: block;
  margin: 1rem 0;
  border: 2px solid var(--fg);
}
.content a { color: var(--accent); }

/* ---- responsive type ---- */
@media (max-width: 820px) {
  .site-title { font-size: 1.15rem; }
  .entry h2 { font-size: 0.9rem; }
  .entry-title { font-size: 1.05rem; }
}
@media (max-width: 480px) {
  .site-title { font-size: 0.95rem; }
  .tagline { font-size: 0.75rem; }
  .entry h2 { font-size: 0.8rem; }
  .entry-title { font-size: 0.9rem; }
  .topnav a { font-size: 0.8rem; margin-right: 1rem; }
  .entry-head { flex-wrap: wrap; }
  .line-no { font-size: 1.1rem; }
}
"""


def strip_html(html: str) -> str:
    return re.sub(r'<[^>]+>', ' ', html)


def make_excerpt(body_html: str, word_limit: int = 30) -> str:
    text = re.sub(r'\s+', ' ', strip_html(body_html)).strip()
    words = text.split(' ')
    if len(words) <= word_limit:
        return text
    return ' '.join(words[:word_limit]) + '\u2026'


def build_one(md_path: Path, out_root: Path, css_path: str, home_path: str, header: str):
    text = md_path.read_text(encoding='utf-8')
    fm, body_md = parse_front_matter(text)
    title = fm.get('title', md_path.stem)
    body_html = md_lib.markdown(body_md, extensions=['extra'])

    meta_bits = []
    if fm.get('date'):
        meta_bits.append(fm['date'])
    if fm.get('categories'):
        meta_bits.append(' / '.join(fm['categories']))
    if fm.get('tags'):
        meta_bits.append(' '.join(f'#{t}' for t in fm['tags']))
    meta_line = f'<p class="meta">{" &middot; ".join(meta_bits)}</p>' if meta_bits else ''

    html = PAGE_TEMPLATE.format(
        title=title, body=body_html, meta_line=meta_line,
        css_path=css_path, header=header,
    )

    slug = fm.get('slug', md_path.stem)
    out_dir = out_root / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / 'index.html').write_text(html, encoding='utf-8')
    return {
        'slug': slug,
        'title': title,
        'date': fm.get('date', ''),
        'draft': fm.get('draft', False),
        'excerpt': make_excerpt(body_html),
    }


def main():
    (ROOT / 'style.css').write_text(CSS, encoding='utf-8')

    header_root = make_header(prefix='')
    header_nested = make_header(prefix='../../')

    page_entries = []
    for md_path in sorted(PAGES_DIR.glob('*.md')):
        entry = build_one(md_path, PAGES_DIR, css_path='../../', home_path='../../', header=header_nested)
        page_entries.append(entry)

    post_entries = []
    draft_count = 0
    for md_path in sorted(POSTS_DIR.glob('*.md')):
        entry = build_one(md_path, POSTS_DIR, css_path='../../', home_path='../../', header=header_nested)
        if entry['draft']:
            draft_count += 1
        else:
            post_entries.append(entry)

    post_entries.sort(key=lambda e: e['date'], reverse=True)

    entries_html_parts = []
    for i, e in enumerate(post_entries):
        line_no = (i + 1) * 10
        entries_html_parts.append(f'''<article class="entry">
<div class="entry-head"><span class="line-no">{line_no}</span> <h2><a href="posts/{e['slug']}/">{e['title']}</a></h2></div>
<p class="entry-date">{e['date']}</p>
<p class="excerpt">{e['excerpt']}</p>
<a class="run-link" href="posts/{e['slug']}/">&gt; RUN THIS ENTRY</a>
</article>
<hr class="divider">''')
    entries_html = '\n'.join(entries_html_parts)

    recent = post_entries[:8]
    recent_html = '\n'.join(
        f'<li><a href="posts/{e["slug"]}/">{e["title"]}</a></li>' for e in recent
    )

    search_index = [
        {'title': e['title'], 'href': f'posts/{e["slug"]}/'} for e in post_entries
    ]
    import json as _json
    search_index_json = _json.dumps(search_index)

    index_html = INDEX_TEMPLATE.format(
        header=header_root, entries_html=entries_html, recent_html=recent_html,
        search_index_json=search_index_json,
    )
    (ROOT / 'index.html').write_text(index_html, encoding='utf-8')

    print(f"Built {len(page_entries)} pages, {len(post_entries)} posts (published), "
          f"{draft_count} skipped drafts")
    print(f"Wrote {ROOT / 'index.html'} and {ROOT / 'style.css'}")


if __name__ == '__main__':
    main()
