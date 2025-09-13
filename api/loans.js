// api/loans.js
const { MongoClient, ObjectId } = require("mongodb");

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "loanapp";

let cachedClient = null;
let cachedDb = null;

async function connectToDatabase() {
  if (cachedClient && cachedDb) return { client: cachedClient, db: cachedDb };

  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  await client.connect();
  const db = client.db(dbName);

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

module.exports = async (req, res) => {
  try {
    const { db } = await connectToDatabase();
    const collection = db.collection("borrowers");

    if (req.method === "GET") {
      const borrowers = await collection.find({}).sort({ createdAt: -1 }).toArray();
      return res.status(200).json(borrowers);
    }

    if (req.method === "POST") {
      const body = req.body;

      if (!body.name || !body.contact || !body.address) {
        return res.status(400).json({ message: "Missing required borrower fields." });
      }

      const borrower = {
        name: body.name,
        contact: body.contact,
        address: body.address,
        loanAmount: Number(body.loanAmount) || 0,
        term: Number(body.term) || 0,
        interestRate: Number(body.interestRate) || 0,
        interestType: body.interestType || "monthly",
        nextDueDate: body.nextDueDate ? new Date(body.nextDueDate) : null,
        monthlyPayment: Number(body.monthlyPayment) || 0,
        createdAt: new Date(),
        payments: [],
        remainingBalance: Number(body.loanAmount) || 0,
      };

      const result = await collection.insertOne(borrower);
      return res.status(201).json({ _id: result.insertedId, ...borrower });
    }

    if (req.method === "PUT") {
      const { id } = req.query;
      const body = req.body;

      if (!id) {
        return res.status(400).json({ message: "Missing borrower id." });
      }

      if (body.payment) {
        const paymentRecord = {
          amount: Number(body.payment.amount) || 0,
          date: body.payment.date ? new Date(body.payment.date) : new Date(),
          note: body.payment.note || "",
        };

        const borrower = await collection.findOne({ _id: new ObjectId(id) });
        if (!borrower) return res.status(404).json({ message: "Borrower not found." });

        const newBalance = Math.max(
          (borrower.remainingBalance ?? borrower.loanAmount) - paymentRecord.amount,
          0
        );

        await collection.updateOne(
          { _id: new ObjectId(id) },
          {
            $push: { payments: paymentRecord },
            $set: { remainingBalance: newBalance },
          }
        );

        return res.status(200).json({ message: "Payment added successfully.", remainingBalance: newBalance });
      }
    }

    if (req.method === "DELETE") {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ message: "Missing borrower id." });
      }

      const result = await collection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ message: "Borrower not found." });
      }

      return res.status(200).json({ message: "Borrower deleted successfully." });
    }

    res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
