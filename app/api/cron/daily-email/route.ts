import { getMongo } from '@/lib/mongo';
import { sendDaily } from '@/lib/report';

// Vercel Cron (vercel.json) calls this every night at 11:59 pm Dhaka (17:59 UTC).
// With CRON_SECRET set on Vercel only Vercel can call it; without it, it still sends at most once a day.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  const sec = process.env.CRON_SECRET;
  if (sec && req.headers.get('authorization') !== `Bearer ${sec}`) return Response.json({ error: 'no' }, { status: 401 });
  try {
    return Response.json(await sendDaily(await getMongo()));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
