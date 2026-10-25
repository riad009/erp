---
name: stock-challan
description: Insert a company delivery challan (photo) into স্টক → মাল আসছে and the কোম্পানি খতিয়ান of the live Khata app. Use when the owner sends a challan / delivery photo with a গাড়ি নং and date ("here is 45 car, 20 October", "insert this"), or asks to fix a গাড়ি that was inserted this way.
---

# Challan photo → স্টক (live data)

The owner photographs a mill's **Delivery Challan** and says the **গাড়ি নং** and **date**. You read it, show the values, and after his **"yes"** write it straight into the live database. No code change and no deploy are needed; he only refreshes.

## 1. Read the photo
- **Company**: the header, e.g. *Karnafully Steel Mills Limited* → "Karnafully Steel Mills", or *Jalalabad Metal Ltd.*
- **চালান নং**: *Trip/Dev.Ch No* (Karnafully) or *Challan No* (Jalalabad).
- **Date**: the date he gives. It is usually the challan's Delivery Date too; if they differ, ask.
- **গাড়ি নং**: the number **he gives**, not the truck plate. One challan = one গাড়ি. If he says one number for two challans, put both on that গাড়ি.
- **Lines**: one stock line per printed row, in the same order. Qty in MT → কেজি (21.84 MT = 21,840). Use the **net** weight, never "Gross Weight".
  - If a photo shows only a handwritten coil list (cut off) next to the printed rows, use the printed rows.
- **Check**: the lines must add up to the printed **Total**. If they don't, say so.

## 2. Map each item to মার্কা + সাইজ
Item codes (the owner's words):
- **ANN** = নরম মাল → `kK` নরম মাল (কাজী মার্কা)
- **TRI** = strong / হার্ড → `kE` হার্ড মাল (কাজী E মার্কা)
- **RW Coil** (Jalalabad) → `kE` হার্ড মাল (কাজী E মার্কা)
- **GLG** = জাকের এর মাল → `mvgc3ws6d1xn` Jaker jp/jl

Other মার্কা: `kF` নরম মাল (কাজী F মার্কা), `mvgc04pngq71` Badoler math. Ask if a code is new.

Size = height × width as the app stores it:
- `650X914` → **65 × 914**; `800X1000` → **80 × 1000**; `550X914` → **55 × 914** (first number ÷ 10)
- `CRC1.2X914` or "1.20 mm × 1220 mm" → **1.2 × 914** / **1.2 × 1220**
- "1.60 mm" → **1.6**; "1.00 mm" → **1**; a strange value like "0.12 mm × 914" is most likely **1.2** — ask.

If the size is missing in that মার্কা, say **"(new size)"** in the table; the script adds it.

Keep the original code text as `ci` (e.g. `SFG.ANN.CRC.650X914`, `RW Coil 1.60X1220 (2 Coil)`). The app shows it under the মাল.

## 3. Show, then wait for "yes"
Reply in easy English with a Bangla-digit table:

**২০ অক্টোবর · গাড়ি ৪৫ · 🏭 Karnafully Steel Mills · চালান ৫৩৯২৭৯**

| ক্রমিক | মাল | সাইজ | কেজি |
|---|---|---|---|
| ১ | নরম মাল (কাজী মার্কা) — ANN | ৯০ × ৯১৪ (new size) | ৭,৯৪০ |
| | | **মোট** | **২৫,৩১৫** ✓ |

- Add a line that it goes into the company খতিয়ান with **দর ০**, unless he gave a দর (per টন).
- Ask only real questions: an unclear number, a new item code, or a cut-off line.
- End with: Reply **"yes"** and I'll insert it.
- Insert straight away only when his message itself already says "insert" **and** nothing is unclear.

## 4. Insert (after "yes")
Write the spec to the scratchpad and run the helper. Run a dry run first, then `--write`:

```bash
cat > "$SCRATCH/challan.json" <<'EOF'
{"date":"2026-10-20","car":"45","vno":"539279","company":"Karnafully Steel Mills","time":"15:30","rate":0,
 "lines":[{"marka":"kK","h":90,"w":914,"kg":7940,"ci":"SFG.ANN.CRC.900X914"},
          {"marka":"kK","h":65,"w":1000,"kg":17375,"ci":"SFG.ANN.CRC.650X1000"}]}
EOF
python3 .claude/skills/stock-challan/insert.py "$SCRATCH/challan.json"          # dry run
python3 .claude/skills/stock-challan/insert.py "$SCRATCH/challan.json" --write  # real
```

What the script does:
- Finds the company by name, or creates it.
- Adds missing sizes.
- **Stops if that চালান নং is already on that day**, so the same challan is never added twice.
- Writes the stock day (`days/<date>`) plus one চালান line per row in the company (`companies/<id>`), linked by `co` / `ce` like the app's own form.
- Prints the day's new totals.

For `time`, take the next free half hour after the day's last গাড়ি, so the cars stay in order. It is shown as the entry time in Dhaka.

## 5. Tell him
In a few lines: what was added (a table with গাড়ির মোট), any new size, the day's totals (N গাড়ি · Mটা মাল · কেজি), দর ০ in the খতিয়ান, then **"Please refresh."**

If he later says "yes insert this N no car" for a গাড়ি that is already in, **do not insert again**. Check the day via the API and tell him it is already there and to refresh.

## Fixing later
- **Small fixes** (wrong গাড়ি নং, kg, size): he can use **✎** on the গাড়ি line himself. Or edit via the API: get `days/<date>` and `companies/<id>`, change the matching entries (same `vno` / `ce`) in **both**, then set both back.
- **দর later**: on each company entry set `rate` and `amount = round(kg/1000 × rate)`.

## API (no password)
`POST https://erp-psi-woad.vercel.app/api/db` with JSON:
- `{"op":"get","path":"days/2026-10-20"}`
- `{"op":"set","path":…,"data":…}`
- `{"op":"list","col":"companies"}`
- `settings/cats` holds every মার্কা and size. Setting it replaces them all, so always get → change → set the full list.

Never use the `import` op; it replaces the whole database.
