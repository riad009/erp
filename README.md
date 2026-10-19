# হিসাব খাতা — কাজী রোমান এন্ড ব্রাদার্স

Bangla bookkeeping app (স্টক, দৈনিক, মেমো, খতিয়ান, বাকি লিস্ট, কোম্পানি, লেবার, ড্যাশবোর্ড, সেটিং).

## Run
```bash
npm install
cp .env.example .env.local   # put your MONGO_URI + APP_PASSWORD in it
npm run dev
# open http://localhost:3000
```

## Data — MongoDB
All data is saved in MongoDB (database `khata`), so every phone / computer sees the same khata.
- The first time the app opens on an empty database, it uploads the data that is already in that browser.
- To load a backup file: open **/import.html** → choose `backup.json`. This **replaces** everything in the database.
- If the database can't be reached, the app keeps working in that browser only (as before).

## Deploy (Vercel)
1. vercel.com → Add New → Project → import `riad009/erp`.
2. Environment Variables: `MONGO_URI`, `APP_PASSWORD` (and `MONGO_DB` if not `khata`).
3. MongoDB Atlas → Network Access → allow `0.0.0.0/0` (Vercel has no fixed IP).
4. Deploy. Open the site → enter the password → open `/import.html` once and choose your `backup.json`.
