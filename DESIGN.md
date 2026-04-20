# Design System — 도매가

## Product Context
- **What this is:** Korean consumer transparency web app. Paste a Korean shopping URL (MVP: Naver Smartstore), see the matched Chinese wholesale (1688) prices on a shareable permalink.
- **Who it's for:** Regular Korean shoppers in the pre-checkout moment — "마진을 알고 결정하세요" before hitting pay.
- **Space/industry:** Consumer transparency. Sits next to Zillow (real estate), Yuka (food/cosmetics), HIBP (data breach) in the pattern of "paste input → authoritative data → shareable result." Explicitly NOT price comparison (Danawa/Enuri/Naver Shopping).
- **Project type:** Consumer web app — landing (`/`) + result permalink (`/p/{id}`). Mobile-first. Share-first DNA (permalinks travel in 단톡방 / SNS).

## Aesthetic Direction
- **Direction:** Editorial Data Composure
- **Decoration level:** Minimal — typography and data carry the design; no ornament.
- **Mood:** "The data desk of a Korean newspaper, reporting on the price you're about to pay." Composed authority with just enough warmth. Not alarming, not cute, not commerce.
- **Reference sites:** HIBP (serious data, single-input UX), Yuka (consumer transparency + state pills), Zillow (data-transparency-disrupts-market). Anti-reference: Danawa, Enuri, Naver Shopping — dense commerce chrome we deliberately avoid.

## Typography
- **Display/Hero (Korean):** Noto Serif KR (700) — magazine front page, gravitas. Used for hero headlines, state pivots, brand mark.
- **Display/Hero (Latin + numbers):** Fraunces (500, variable opsz) — display serif with tabular-nums and stylistic alternates. Used for the hero 도매가 number.
- **Body + UI:** Pretendard Variable (400/500/600) — Korean sans standard, clean geometric. All body, UI labels, buttons, caps labels.
- **Data/Tables:** Geist Mono (500, tabular-nums) — match list prices, similarity scores, timestamps, permalinks.
- **Code:** JetBrains Mono (if needed; not UI-visible in MVP).
- **Loading:** Google Fonts for Noto Serif KR, Fraunces, Geist Mono. Pretendard via `cdn.jsdelivr.net/gh/orioncactus/pretendard` variable web subset (preferred — faster than Google for Korean).
- **Scale:**
  - `text-2xs`: 10px · micro labels (OG timestamps)
  - `text-xs`: 11px · caps labels, state pills
  - `text-sm`: 13px · captions, match-row titles
  - `text-base`: 15px · body
  - `text-lg`: 18px · section leads
  - `text-xl`: 22px · brand wordmark
  - `text-2xl`: 28px · section titles
  - `text-3xl`: 36px · landing head
  - `text-4xl`: 56px · result hero number (mobile)
  - `text-display`: 72px · OG card hero number

## Color
- **Approach:** Restrained + semantic. One accent color. State colors are used ONLY for matching states.
- **Background (light):** `#f5f1e8` — warm paper. NOT pure white. This is the single most important color decision.
- **Background (dark):** `#0f1113` — near-black with a warm tilt.
- **Text primary:** `#1a1a1a` (light) / `#efece4` (dark).
- **Text muted:** `#5a5a5a` (light) / `#8a8a8a` (dark).
- **Rule / divider:** `#d9d3c3` (light) / `#262626` (dark).
- **Accent:** `#0b5568` deep teal (light) / `#57a9c0` (dark). Used ONLY on state pill background and one highlighted data label. Not for CTAs.
- **CTA treatment:** Primary button is `bg: #1a1a1a, text: #f5f1e8`. No teal on buttons.
- **Semantic (matching states — 3 states):**
  - `confident_match` → `#1f6b3a` forest (light) / `#5fa477` (dark)
  - `likely_domestic` → `#8a6a2f` amber/ochre (light) / `#c2a461` (dark)
  - `unknown` → `#5a5a5a` slate (light) / `#888` (dark)
- **Dark mode strategy:** Full re-themed palette (not just inverted). Paper flips to near-black with warm tilt, accent desaturates to a lighter teal for contrast on dark bg, state colors brighten to maintain legibility. Never ship auto-inversion.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable → spacious. Deliberately more generous than Korean-market norms (Danawa/Naver are dense). The hero number on `/p/{id}` has large breathing room.
- **Scale:** `2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64) 4xl(96)`
- **Content horizontal inset (mobile):** 24px
- **Content horizontal inset (desktop):** 32px within a 1240px max-width container

## Layout
- **Approach:** Hybrid — grid-disciplined for app logic, editorial asymmetric for hero moments.
- **Grid:** 4-col on mobile (<640), 8-col on tablet (640-1024), 12-col on desktop.
- **Max content width:** 1240px (docs/landing), 720px (result page content column).
- **Border radius:** Almost none. `sm:2px` for thumbnails only. No `rounded-lg`, no `rounded-full` pills (except circular avatars if ever used). Share buttons are underlined text links, not rounded pills. State "pill" is a rectangle, not a pill.
- **Landing (`/`):** Single column, URL input as hero, one-line sub, footer. Nothing else above the fold.
- **Result (`/p/{id}`):** Product header (thumbnail + Korean title + retail price), then hero 도매가 range centered in its own viewport section, then state chip, then match list as rows (NOT cards), then share + footer.
- **Match row layout:** `[thumb 40px] [title + seller] [¥ price, right-aligned, mono] [similarity, right-aligned, mono]` — grid, not cards. Thin hairline dividers.
- **No card pattern.** The product does not have "cards" as a UI primitive. Data sits on the paper background, separated by rules and whitespace.

## Motion
- **Approach:** Minimal-functional. Only transitions that aid comprehension.
- **Easing:** `enter: cubic-bezier(0, 0, 0.2, 1)` · `exit: cubic-bezier(0.4, 0, 1, 1)` · `move: cubic-bezier(0.4, 0, 0.2, 1)`
- **Duration:** `micro: 80ms · short: 200ms · medium: 320ms · long: 500ms`
- **Key transitions:**
  - Pending → result: hero 도매가 number fades in over 320ms with a tiny settle (y: +4px → 0). Everything else appears without animation.
  - Realtime match list rows: each row fades in as it arrives (80ms per row, staggered).
  - No scroll-driven animation. No parallax. No page transitions.

## Iconography
- **Use sparingly.** If needed, stroke icons at 1.25px, color inherits from text. No filled icons, no colored circles, no icon badges.
- **Recommended set:** Lucide (1.25px stroke) if icons become necessary. MVP has none.

## Imagery
- Product thumbnails render as-is (from Naver CDN or re-hosted per legal decision, W0-4 gate).
- No stock photography. No hero illustration.
- No mascot.

## OG Card (1200×630)
- Same design system applied. Paper background, brand wordmark top-left, state pill, caps label "예상 도매가 범위", hero number in Fraunces display serif, retail context in Geist Mono, permalink URL in Geist Mono bottom-left.
- Generated server-side via `@vercel/og`. Must render Korean glyphs correctly — load Noto Serif KR subset.

## Components (MVP)
- **Primary button:** `bg: #1a1a1a, text: #f5f1e8, padding: 8px 14px, font: 13/600 Pretendard, letter-spacing: 0.02em`. No rounded corners. No hover color shift; hover adds a 1px underline offset.
- **URL input:** No border box. Top + bottom `1px solid #1a1a1a` rule. Input is transparent. Submit button sits inline, right side.
- **State pill:** Rectangle, `padding: 6px 14px, font: 11/600 Pretendard caps, letter-spacing: 0.1em`. Background is state color. Text white.
- **Match row:** Described above.
- **Share button:** Text link with 4px underline offset, 1px underline thickness. Hover → color `#0b5568` accent.

## Writing Tone (UI copy)
- Informative, composed, Korean-first. Neutral declarative statements. No exclamation marks. No "호구", "저격", "대박" style words.
- Reference phrases:
  - Good: "마진을 알고 결정하세요." · "예상 도매가 범위" · "신뢰 높음"
  - Bad: "당신은 호구였을 수 있어요!" · "충격적인 원가 공개!!" · "놀라운 마진 확인 😱"
- Numbers always use tabular-nums and comma separators: `57,000원` · `¥5.20 – ¥8.60`
- Dates: `YYYYMMDD` or `YYYY.MM.DD`. No relative time ("3일 전").

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 20260420 | Editorial Data Composure aesthetic adopted | Category differentiation vs Danawa/Enuri/Naver Shopping. First-principles: newspaper data desk positioning separates transparency product from commerce. |
| 20260420 | Paper `#f5f1e8` background instead of white | Print/publication signal. Risk accepted: small segment may find it unusual. |
| 20260420 | Noto Serif KR + Fraunces for hero numbers | Serif on money number breaks Korean commerce convention. Risk accepted: authority signal worth it. |
| 20260420 | Single accent (deep teal), no red CTAs | Refuse the commerce-chrome visual vocabulary. |
| 20260420 | Match rows, not cards | Editorial asymmetric result page cements authority positioning. |
