# Khata App — notes for Claude (read this first)

Bangla bookkeeping app for **কাজী রোমান এন্ড ব্রাদার্স** (steel coil / sheet trader, Dhaka).
Tabs: স্টক · দৈনিক · মেমো · খতিয়ান · বাকি লিস্ট · কোম্পানি · লেবার · ড্যাশবোর্ড · সেটিং.

## How the owner wants to work
- Talk in **easy English**, short answers; the app UI is **Bangla** (Bangla digits ০-৯).
- He sends a screenshot + a short request → make the change → **test on computer (1440) and phone (390)** → tell him in a few lines what changed.
- After any change: `npm run dev`, open http://localhost:3000, check the page, no console errors.
- **Always publish every change right away**: commit and `git push origin main` — Vercel auto-deploys `main` to the live site https://erp-psi-woad.vercel.app in ~1 min. Never leave a change only on this computer. Then tell him to refresh.

## Where the code is (step 1 of the move to Next.js)
- The whole app is still **one file**: `public/khata/index.html` (~6,500 lines, plain HTML + CSS + JS, no build).
  - `<style>` (lines ~10–2770): base → খতিয়ান paper → স্টক/দৈনিক notebook → memo → desktop layout → side menu → pro theme → each feature's CSS (later blocks override earlier ones).
  - `<script>`: shared helpers at the top (`kDialog`, `kToast`, `uHead`, `bnLongDate`, `splitCols`, `makeCombo`, `attachWords`, `attachBanglish`, `__shortage`, `__canSend`), then one `(function(){ … })()` module per tab:
    স্টক (~3050) · কোম্পানি (~3976) · খতিয়ান + নতুন মেমো form + দৈনিক (~4389, দৈনিক ~5008) · ড্যাশবোর্ড (~5565) · মেমো + লেবার + PDF (~5714) · সেটিং (~6268) · বাকি লিস্ট (~6344).
  - Modules talk through `window.__ledger`, `window.__stock`, `window.__marka`, `window.__company`, `window.showMemo`, `window.__memoStyle` …
- `app/page.tsx` just redirects to `/khata/index.html`.

## Data
- **MongoDB** via `app/api/db/route.ts` + `lib/store.ts` (+ `lib/mongo.ts`, env `MONGO_URI`, `MONGO_DB` default `khata`). The app still uses its old paths; `lib/store.ts` maps them to clearly named collections, one record per item, fields stored directly:
  `stock_days` (days/<date>) · `stock_markas` + `stock_sizes` (settings/cats; sizes stored as `height`, `width`, `open_kg`, `buy_rate`, `mark` (only K = green now; the old B red mark was removed on purpose — don't bring it back), `marka_id`, `position` = order added) · `parties` (ledgers) · `companies` · `expenses` (khoroch) · `cash_opening` (amdani/sabek, one per date) · `settings` (`sale_rates`, `labour_rate`).
  The first layout (`{_id, data}` in days/ledgers/settings…) is moved over automatically on the first request (`migrateOldLayout`). Open `/api/db` to see record counts.
- Browser side: `public/khata/db.js` gives the same small API the app had on claude.ai (`collection(n).get()`, `doc('col/id').get()/set()/delete()`); `getDB()` in index.html uses it. On an empty database it first uploads that browser's localStorage. If the server can't be reached → `null` → app works from localStorage only.
- **No password** on the site (owner removed it on purpose) — anyone with the link can read/write. Don't add one back unless he asks.
- localStorage is still written too (cache / offline). Keys: `kg-khata-days-v1` (stock days `[{id:'YYYY-MM-DD', opening, due, entries[], outs[]}]`),
  `kg-khata-ledger-v1` (parties `[{id, name, address, opening, openJoma, openKhoroch, entries[]}]` — opening = আগের জের (অবশিষ্ট), openJoma/openKhoroch = old paper-book জমা/খরচ, added into the totals; openDate = date on the paper khatian; memo entry = `{id, memoNo, date, credit, debit, kg, items[{t,kg,rate}], picks[{item,cat,t,kg,cost}], status:'pending'|'confirmed', confirmedOn, labour…}`),
  `kg-khata-company-v1` (companies + চালান/রসিদ), `kg-khata-khoroch-v1` (`{date: [{id,desc,amt}]}`), `kg-khata-sabek-v1`,
  `kg-khata-cats-v1` (মার্কা → sizes `[{id,name,tone,items[{id,h,w,open,cost}]}]`), `kg-khata-rates`, `kg-khata-labour-rate`, UI prefs `kg-khata-*`.
- Backup file (`backup.json`, kept out of git) → `/import.html` replaces the whole database with it.

## Rules the owner already decided (keep them)
- Same header on every tab: page title left, date pill right. Old date = thin dashed light-red frame + "↩ বর্তমান দিনে ফিরে যান".
- স্টক sub-tabs (at the top, right under the header, above the calc cards): 📊 সর্বমোট মাল (purple) | 🚚 মাল আসছে (green) | 📦 মাল যাচ্ছে (red). Tables with box lines + ক্রমিক. 🚚 মাল আসছে day list: one line per গাড়ি (first column = গাড়ি নং instead of ক্রমিক, ✎ in the গাড়ি নং column; "গাড়ির মোট" কেজি, কতটা মাল, company, চালান নং) — tap to open its মাল lines (in the order entered, same as the challan, with ✎ ×); মোট row at the bottom.
  - Calc card (every স্টক sub-tab): আগের মোট (T) → আজ / এই দিনে মাল এসেছে (+, N গাড়ি · Mটা মাল) → মাল গেছে (−) → মোট স্টক; right card এই দিনের যোগ + সর্বমোট স্টক (T). All from the মার্কা sizes (`itemStats`: শুরুর কেজি + arrivals − sold), so it equals the 📦 মোট স্টক box. No hand-typed শুরুর স্টক box any more.
  - 📦 মাল যাচ্ছে has a red "✋ হাতে মাল বের করুন" button → pop-up (`openHandOut`): each line = মার্কা → সাইজ picker + মোট কেজি, ＋ আরো মাল for more; can't take more than in stock; saved in the day's `outs` (`hand:true`) → leaves the stock; listed under "✋ আজ হাতে বের করা মাল" with × (tap twice) to undo.
  - 📊 সর্বমোট মাল has a 🔍 search box (`tsQ`, `sizeMatch`): মিলি / লম্বা / "৬৫x৯১৪" → only matching sizes (and their মার্কা cards) show; × clears.
  - 📊 সর্বমোট মাল: each size has a red 🕘 "…বার এসেছে +কেজি" button → every arrival (date · গাড়ি · +কেজি in red), শুরুর কেজি and মোট এসেছে.
  - On an old date with no record, "＋ এই তারিখে মাল যোগ করুন" opens that day straight into this form.
  - Under the 🚚 মাল আসছে table: only a "📅 এই মাসের সব হিসাব" button (no separate ইতিহাস list — the day's গাড়ি are already in the table) → pop-up with every date of the month (গাড়ি · মাল · কেজি, no মোট row); rows highlight on hover (no › column); tap a date row → pop-up closes, that day's 🚚 মাল আসছে page opens scrolled to its গাড়ি table. গাড়ি count = unique গাড়ি নং, not lines.
  - Size row 🕘 "N বার এসেছে" = arrivals of the last 24 hours only (old date: that day only); no kg on the closed button.
  - 🚚 মাল আসছে form is a pop-up: only a green "＋ মাল যোগ করুন" button on the page; tap → pop-up form (✕ / outside / Esc closes; closes by itself after যোগ করুন).
  - ✎ next to গাড়ি নং (day list গাড়ি line + month pop-up) → `startCarEdit()` opens the same মাল pop-up filled with that গাড়ি (কোম্পানি, every মাল line + কেজি + কয়েল, গাড়ি নং, দর, চালান) → ✓ সেভ করুন replaces those lines (and their কোম্পানি চালান lines); 🗑 removes the whole গাড়ি. গাড়ি নং is saved in Bangla digits.
  - 🚚 মাল আসছে form: one গাড়ি can carry several মাল lines (＋ আরো মাল); each line = মাল + কেজি + কয়েল নং (`coil` on the stock entry); গাড়ি নং / দর / চালান নং are shared and saved on every line.
- মাল is picked with the pop-up **মার্কা → সাইজ**. Printed memo shows only **সফট / হার্ড + কেজি** (no sizes).
- পার্টি box in the memo / জমা form and the খতিয়ান "হিসাব" picker (`#accSel`) = search box (`partySearch(sel)` over the hidden select): type any part of the name/location → matches (names starting with it first), ↑↓ Enter, "＋ নতুন পার্টি" always last.
- Memo form: কাগজ or ডিজিটাল (setting). Digital = step by step: party first → মাল; one কেজি + দর box per size line with its টাকা (ক্রমিক ১. ২. …; the same size can be picked again as its own line; after the first মাল the top "মাল বাছাই করুন" hides and only "＋ আরো মাল যোগ করুন" (after the last group) adds more). In the digital form the সফট/হার্ড "মোট হিসাব" row is hidden once sizes are picked (owner's wish; it still holds the sums). In the paper form that row's দর box sets every line of that type ("আলাদা আলাদা দর" when they differ). Saved: each pick has `rate`; `items` = one line per type + দর (so the printed memo shows kg × দর per দর); লেবার hidden until মাল picked; full summary pop-up before saving.
- Stock check: warn when making a memo with low stock ("তবুও মেমো করুন (মাল পরে যাবে)"); that memo shows "⏳ স্টকে কম — মাল আসলে নিজে যাবে" until stock arrives.
- Memo form: optional **হাতের নং** box (`#fPaperNo` → `paperNo` on the memo, shown as 📄নং in the মেমো list and on the memo). **📝 খসড়া সেভ করুন** saves a half-done memo (party, date, হাতের নং, picks with kg/দর, লেবার on/off) in `settings/drafts` (`memo_drafts`, `{list}`; also localStorage `kg-khata-drafts`) — no memo number, no stock change; the মেমো tab lists them under "📝 খসড়া মেমো" (খুলুন › reopens the form filled, × twice deletes); the real save removes the draft.
- Memo form লেবার টাকা is editable (`#fLabAmt` → `labMan`; saved `labourManual:true`, total = মাল + that লেবার, no rounding); ↺ goes back to the কেজি-based amount. The memo pop-up has "✕ বাতিল" in its top-right corner (`#fCancelTop`); the bottom বাতিল is hidden.
- মাল picker (মার্কা → সাইজ pop-up) has a search box on the first screen: type মিলি (height) / লম্বা / "৬৫x৯১৪" → matching sizes from every মার্কা.
- মেমো tab date pill is clickable (`#mDay`): pick a day → only that day's memos (+ "↩ এই মাসের সব মেমো" back to the month list, the default); "নতুন মেমো" from there starts on that picked day (`newMemo(aid, day)`).
- **মেমো = মাল বিক্রি only.** টাকা জমা (from খতিয়ান or দৈনিক → নতুন জমা) gets no memo number and never shows in the মেমো tab — it is only in খতিয়ান / দৈনিক.
- Saving a memo = the goods leave the stock right away (no "মাল পাঠান / গেছে / ফেরান" buttons anywhere). Only if a size is short, the memo waits and goes out **by itself** when enough stock comes in (`window.__ledger.autoSend`).
- লাভ = (বিক্রি দর − কেনা দর) × কেজি per size; কেনা দর = size ✎ value, else latest কোম্পানি চালান দর (per টন ÷ 1000). লেবার is not profit. Memo stores the cost of that day.
- দৈনিক: 3 tiles (সাবেক জমা + নিট = হাতে নগদ), then আমদানি | খরচ | বিক্রয় columns; adding happens in pop-ups.
  - নতুন জমা has কার মাধ্যমে (`via`) + optional রেফারেন্স (`ref`) on the জমা entry, shown in আমদানি list and খতিয়ান. After a party is chosen a box shows its **আগের বাকি** and, once টাকা is typed, **জমার পর বাকি** (`#aPrevDue`).
  - খরচ column has a 💰 বিবিধ খরচ (খুচরা) card: items saved in the same day's khoroch list with `misc:true`; the main খরচ list shows them as one auto line "বিবিধ খরচ (খুচরা)" = their sum (totals already include them).
- Fonts: Noto Sans Bengali (clear ১), Baloo Da 2 for numbers, Tiro Bangla headings.

## Challan photos → স্টক
- When the owner sends a mill delivery challan photo + গাড়ি নং + date, follow the **`stock-challan` skill** (`.claude/skills/stock-challan/SKILL.md`): read it → show a Bangla table → after his "yes" run `insert.py` (writes the live DB: stock day + company খতিয়ান, adds missing sizes, refuses a duplicate চালান নং). ANN = নরম (kK), TRI = হার্ড (kE), RW Coil = হার্ড (kE), GLG = জাকের; 650X914 → 65 × 914; net kg, not gross.

## Roadmap (do in this order, one small step at a time)
1. ✅ Run the existing app inside Next.js (this repo).
2. Backup / restore buttons inside the app (JSON download/upload).
3. ✅ Online database (MongoDB instead of Supabase) → data on every device.
4. Login (owner / staff roles).
5. Move tabs one by one into React components under `app/` (start with বাকি লিস্ট — smallest), sharing one data layer.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
