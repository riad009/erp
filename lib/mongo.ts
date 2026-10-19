import { MongoClient, type Db } from 'mongodb';

// one client per server instance (Vercel reuses it between requests)
const g = globalThis as unknown as { __mongo?: Promise<MongoClient> };

export async function getMongo(): Promise<Db> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  if (!g.__mongo) g.__mongo = new MongoClient(uri).connect().catch(e => { g.__mongo = undefined; throw e; });
  return (await g.__mongo).db(process.env.MONGO_DB || 'khata');
}
