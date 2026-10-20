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
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Friad009%2Ferp&env=MONGO_URI,APP_PASSWORD&envDescription=MONGO_URI%3A%20your%20MongoDB%20Atlas%20connection%20string.%20APP_PASSWORD%3A%20password%20for%20the%20site.)

1. MongoDB Atlas → **Network Access** → Add IP Address → **Allow access from anywhere** (`0.0.0.0/0`). Vercel has no fixed IP.
2. Click the button above (or vercel.com → Add New → Project → import `riad009/erp`).
3. Fill in the Environment Variables:
   - `MONGO_URI` = `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/`
   - `APP_PASSWORD` = a password for the site
   - (optional) `MONGO_DB` — database name, default `khata`
4. Deploy. Then:
   - open `https://<your-site>/api/db` → enter the password → should show `"ok": true` (database connected)
   - open `https://<your-site>/import.html` → choose your `backup.json` once to load the old data
