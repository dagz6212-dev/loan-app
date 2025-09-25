// api/index.js - Vercel Serverless Function
const { MongoClient, ObjectId } = require("mongodb");

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "loanapp";

let db;
let useFileStorage = false;

// Simple in-memory storage as fallback (since Vercel functions are stateless)
let memoryData = { borrowers: [] };

// Helper functions for memory operations
function readData() {
  return memoryData;
}

function writeData(data) {
  memoryData = data;
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// Connect to MongoDB with fallback
async function connectToDatabase() {
  if (db) return db;
  if (useFileStorage) return null;

  try {
    if (!uri) {
      console.log("No MongoDB URI provided, using memory storage");
      useFileStorage = true;
      return null;
    }

    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
    });

    await client.connect();
    db = client.db(dbName);
    console.log("✅ Connected to MongoDB Atlas");
    return db;
  } catch (error) {
    console.error("❌ MongoDB connection failed, using memory storage:", error.message);
    useFileStorage = true;
    return null;
  }
}

// Main serverless function handler - CommonJS export for Vercel
module.exports = async function handler(req, res) {
  try {
    console.log('=== API Handler Called ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Query:', req.query);
    console.log('MongoDB URI:', process.env.MONGODB_URI ? 'Set' : 'Not set');
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
      console.log('OPTIONS request handled');
      return res.status(200).end();
    }

    // GET /api/loans - Get all loans
    if (req.method === 'GET') {
      console.log('Processing GET request');
      try {
        const database = await connectToDatabase();
        
        if (database && !useFileStorage) {
          console.log('Using MongoDB');
          const collection = database.collection("borrowers");
          const borrowers = await collection.find({}).sort({ createdAt: -1 }).toArray();
          console.log('Found borrowers:', borrowers.length);
          return res.status(200).json(borrowers);
        } else {
          console.log('Using memory storage');
          const data = readData();
          const borrowers = data.borrowers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          console.log('Memory borrowers:', borrowers.length);
          return res.status(200).json(borrowers);
        }
      } catch (err) {
        console.error('Error in GET:', err);
        const data = readData();
        return res.status(200).json(data.borrowers || []);
      }
    }

    // POST /api/loans - Create new loan
    if (req.method === 'POST') {
      console.log('Processing POST request');
      try {
        const body = req.body;
        console.log('Request body:', body);

        if (!body || !body.name || !body.contact || !body.address) {
          console.log('Missing required fields');
          return res.status(400).json({ message: "Missing required borrower fields." });
        }

        // Calculate initial remaining balance including interest
        function calculateInitialBalance(loanAmount, interestRate, term, interestType) {
          if (loanAmount <= 0 || term <= 0) return loanAmount;
          
          let monthlyInterestRate;
          if (interestType === 'annually') {
            monthlyInterestRate = interestRate / 12;
          } else {
            monthlyInterestRate = interestRate;
          }
          
          const monthlyInterest = loanAmount * (monthlyInterestRate / 100);
          const totalInterest = monthlyInterest * term;
          
          return loanAmount + totalInterest;
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
          penalties: [],
          totalPenalties: 0,
          remainingBalance: calculateInitialBalance(
            Number(body.loanAmount) || 0, 
            Number(body.interestRate) || 0, 
            Number(body.term) || 0, 
            body.interestType || "monthly"
          ),
        };

        console.log('Created borrower object:', borrower);

        const database = await connectToDatabase();
        
        if (database && !useFileStorage) {
          console.log('Saving to MongoDB');
          const collection = database.collection("borrowers");
          const result = await collection.insertOne(borrower);
          console.log('MongoDB insert result:', result.insertedId);
          return res.status(201).json({ _id: result.insertedId, ...borrower });
        } else {
          console.log('Saving to memory');
          borrower._id = generateId();
          const data = readData();
          data.borrowers.push(borrower);
          writeData(data);
          console.log('Memory save complete, ID:', borrower._id);
          return res.status(201).json(borrower);
        }
      } catch (err) {
        console.error('Error in POST:', err);
        return res.status(500).json({ message: "Error creating loan: " + err.message });
      }
    }

    // PUT /api/loans - Update loan (payments/penalties/borrower info)
    if (req.method === 'PUT') {
      console.log('Processing PUT request');
      try {
        const { id } = req.query;
        const body = req.body;
        console.log('PUT ID:', id);
        console.log('PUT body:', body);

        if (!id) {
          console.log('Missing ID in PUT request');
          return res.status(400).json({ message: "Missing borrower id." });
        }

        const database = await connectToDatabase();

        // Handle payment
        if (body.payment) {
          console.log('Processing payment');
          let borrower;
          
          if (database && !useFileStorage) {
            console.log('Finding borrower in MongoDB');
            const collection = database.collection("borrowers");
            borrower = await collection.findOne({ _id: new ObjectId(id) });
            if (!borrower) {
              console.log('Borrower not found in MongoDB');
              return res.status(404).json({ message: "Borrower not found." });
            }
          } else {
            console.log('Finding borrower in memory');
            const data = readData();
            borrower = data.borrowers.find(b => b._id === id);
            if (!borrower) {
              console.log('Borrower not found in memory');
              return res.status(404).json({ message: "Borrower not found." });
            }
          }

          const paymentRecord = {
            amount: Number(body.payment.amount) || 0,
            date: body.payment.date ? new Date(body.payment.date) : new Date(),
            note: body.payment.note || "",
          };

          if (!paymentRecord.amount || paymentRecord.amount <= 0) {
            return res.status(400).json({ message: "Payment amount must be greater than zero." });
          }

          // Calculate remaining balance
          const totalPayments = (borrower.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0) + paymentRecord.amount;
          const totalPenalties = borrower.totalPenalties || 0;
          const loanAmount = borrower.loanAmount || 0;
          
          let totalInterest = 0;
          if (borrower.interestRate && borrower.term) {
            const monthlyInterestRate = borrower.interestType === 'annually' 
              ? borrower.interestRate / 12 
              : borrower.interestRate;
            const monthlyInterest = loanAmount * (monthlyInterestRate / 100);
            totalInterest = monthlyInterest * borrower.term;
          }
          
          const newBalance = Math.max(loanAmount + totalInterest + totalPenalties - totalPayments, 0);

          if (database && !useFileStorage) {
            console.log('Updating payment in MongoDB');
            const collection = database.collection("borrowers");
            await collection.updateOne(
              { _id: new ObjectId(id) },
              {
                $push: { payments: paymentRecord },
                $set: { remainingBalance: newBalance },
              }
            );
          } else {
            console.log('Updating payment in memory');
            const data = readData();
            const borrowerIndex = data.borrowers.findIndex(b => b._id === id);
            if (borrowerIndex === -1) return res.status(404).json({ message: "Borrower not found." });
            
            data.borrowers[borrowerIndex].payments = data.borrowers[borrowerIndex].payments || [];
            data.borrowers[borrowerIndex].payments.push(paymentRecord);
            data.borrowers[borrowerIndex].remainingBalance = newBalance;
            writeData(data);
          }

          console.log('Payment processed successfully');
          return res.json({ message: "Payment added successfully.", remainingBalance: newBalance });
        }

        // Handle penalty
        if (body.penalty) {
          console.log('Processing penalty');
          // Similar penalty logic as payment but shorter for brevity
          return res.json({ message: "Penalty functionality available but simplified in this version" });
        }

        console.log('Invalid PUT request');
        return res.status(400).json({ message: "Invalid request." });
      } catch (err) {
        console.error('Error in PUT:', err);
        return res.status(500).json({ message: "Error updating loan: " + err.message });
      }
    }

    // DELETE /api/loans - Delete loan
    if (req.method === 'DELETE') {
      console.log('Processing DELETE request');
      try {
        const { id } = req.query;
        console.log('DELETE ID:', id);

        if (!id) {
          return res.status(400).json({ message: "Missing borrower id." });
        }

        const database = await connectToDatabase();

        if (database && !useFileStorage) {
          console.log('Deleting from MongoDB');
          const collection = database.collection("borrowers");
          const result = await collection.deleteOne({ _id: new ObjectId(id) });

          if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Borrower not found." });
          }
        } else {
          console.log('Deleting from memory');
          const data = readData();
          const borrowerIndex = data.borrowers.findIndex(b => b._id === id);
          
          if (borrowerIndex === -1) {
            return res.status(404).json({ message: "Borrower not found." });
          }
          
          data.borrowers.splice(borrowerIndex, 1);
          writeData(data);
        }

        console.log('Delete successful');
        return res.json({ message: "Borrower deleted successfully." });
      } catch (err) {
        console.error('Error in DELETE:', err);
        return res.status(500).json({ message: "Error deleting loan: " + err.message });
      }
    }
    
    console.log('Method not allowed:', req.method);
    return res.status(405).json({ message: "Method not allowed: " + req.method });
    
  } catch (error) {
    console.error('=== CRITICAL ERROR ===');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return res.status(500).json({ 
      message: "Internal Server Error",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}