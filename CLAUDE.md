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
  `stock_days` (days/<date>) · `stock_markas` + `stock_sizes` (settings/cats; sizes stored as `height`, `width`, `open_kg`, `buy_rate`, `mark` (B = red, K = green; old `is_z` = B), `marka_id`, `position` = order added) · `parties` (ledgers) · `companies` · `expenses` (khoroch) · `cash_opening` (amdani/sabek, one per date) · `settings` (`sale_rates`, `labour_rate`).
  The first layout (`{_id, data}` in days/ledgers/settings…) is moved over automatically on the first request (`migrateOldLayout`). Open `/api/db` to see record counts.
- Browser side: `public/khata/db.js` gives the same small API the app had on claude.ai (`collection(n).get()`, `doc('col/id').get()/set()/delete()`); `getDB()` in index.html uses it. On an empty database it first uploads that browser's localStorage. If the server can't be reached → `null` → app works from localStorage only.
- **No password** on the site (owner removed it on purpose) — anyone with the link can read/write. Don't add one back unless he asks.
- localStorage is still written too (cache / offline). Keys: `kg-khata-days-v1` (stock days `[{id:'YYYY-MM-DD', opening, due, entries[], outs[]}]`),
  `kg-khata-ledger-v1` (parties `[{id, name, address, opening, openJoma, openKhoroch, entries[]}]` — opening = আগের জের (অবশিষ্ট), openJoma/openKhoroch = old paper-book জমা/খরচ, added into the totals; memo entry = `{id, memoNo, date, credit, debit, kg, items[{t,kg,rate}], picks[{item,cat,t,kg,cost}], status:'pending'|'confirmed', confirmedOn, labour…}`),
  `kg-khata-company-v1` (companies + চালান/রসিদ), `kg-khata-khoroch-v1` (`{date: [{id,desc,amt}]}`), `kg-khata-sabek-v1`,
  `kg-khata-cats-v1` (মার্কা → sizes `[{id,name,tone,items[{id,h,w,open,cost}]}]`), `kg-khata-rates`, `kg-khata-labour-rate`, UI prefs `kg-khata-*`.
- Backup file (`backup.json`, kept out of git) → `/import.html` replaces the whole database with it.

## Rules the owner already decided (keep them)
- Same header on every tab: page title left, date pill right. Old date = red frame + "↩ বর্তমান দিনে ফিরে যান".
- স্টক sub-tabs: 📊 সর্বমোট মাল (purple) | 🚚 মাল আসছে (green) | 📦 মাল যাচ্ছে (red). Tables with box lines + ক্রমিক, newest on top.
- মাল is picked with the pop-up **মার্কা → সাইজ**. Printed memo shows only **সফট / হার্ড + কেজি** (no sizes).
- Memo form: কাগজ or ডিজিটাল (setting). Digital = step by step: party first → মাল; one কেজি box per size; লেবার hidden until মাল picked; full summary pop-up before saving.
- Stock check: warn when making a memo with low stock ("তবুও মেমো করুন (মাল পরে যাবে)"); that memo shows "⏳ স্টকে কম — মাল আসলে নিজে যাবে" until stock arrives.
- Saving a memo = the goods leave the stock right away (no "মাল পাঠান / গেছে / ফেরান" buttons anywhere). Only if a size is short, the memo waits and goes out **by itself** when enough stock comes in (`window.__ledger.autoSend`).
- লাভ = (বিক্রি দর − কেনা দর) × কেজি per size; কেনা দর = size ✎ value, else latest কোম্পানি চালান দর (per টন ÷ 1000). লেবার is not profit. Memo stores the cost of that day.
- দৈনিক: 3 tiles (সাবেক জমা + নিট = হাতে নগদ), then আমদানি | খরচ | বিক্রয় columns; adding happens in pop-ups.
- Fonts: Noto Sans Bengali (clear ১), Baloo Da 2 for numbers, Tiro Bangla headings.

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
