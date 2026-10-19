# হিসাব খাতা — কাজী রোমান এন্ড ব্রাদার্স

Bangla bookkeeping app (স্টক, দৈনিক, মেমো, খতিয়ান, বাকি লিস্ট, কোম্পানি, লেবার, ড্যাশবোর্ড, সেটিং).

## Run
```bash
npm install
npm run dev
# open http://localhost:3000
```
First time only: open **http://localhost:3000/import.html** → "✓ backup.json থেকে আনুন" to load the data copied from claude.ai.

## Deploy (Vercel)
Push to GitHub → import the repo on vercel.com → Deploy (no settings needed).

## Note
Data is saved in the browser for now (one device). Next step is a Supabase backend — see `CLAUDE.md` → Roadmap.
