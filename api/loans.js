// api/loans.js
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;      // set this in Vercel env (see below)
const dbName = process.env.MONGODB_DB || 'loanapp';
let cachedClient = null;
let cachedDb = null;

module.exports = async (req, res) => {
  if (!uri) {
    return res.status(500).json({ error: 'MONGODB_URI not configured' });
  }

  // lazy init + cache client across invocations
  if (!cachedClient) {
    const client = new MongoClient(uri);
    await client.connect();
    cachedClient = client;
    cachedDb = client.db(dbName);
  }

  const collection = cachedDb.collection('loans');

  // GET -> list loans
  if (req.method === 'GET') {
    const docs = await collection.find({}).sort({ createdAt: -1 }).limit(200).toArray();
    return res.status(200).json(docs);
  }

  // POST -> create a loan record
  if (req.method === 'POST') {
    // Ensure body parsed as JSON (Vercel usually provides parsed body for application/json)
    const body = req.body;
    if (!body || !body.name || !body.amount) {
      return res.status(400).json({ error: 'Missing name or amount' });
    }
    const doc = {
      name: String(body.name),
      amount: Number(body.amount),
      term: body.term || null,
      createdAt: new Date()
    };
    const r = await collection.insertOne(doc);
    return res.status(201).json({ insertedId: r.insertedId });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end('Method Not Allowed');
};
