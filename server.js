// server.js
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const fs = require("fs");
const dotenv = require("dotenv");
const path = require("path");

// Load environment variables based on environment
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: ".env.local" });
}

const app = express();
const port = process.env.PORT || 3000;

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "loanapp";

let db;
let useFileStorage = false;

// File storage setup
const dataFile = path.join(__dirname, 'data.json');

// Initialize data file if it doesn't exist
if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(dataFile, JSON.stringify({ borrowers: [] }, null, 2));
}

// Helper functions for file operations
function readData() {
  try {
    const data = fs.readFileSync(dataFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading data:', error);
    return { borrowers: [] };
  }
}

function writeData(data) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing data:', error);
  }
}

function generateId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// Connect to MongoDB with fallback
async function connectToDatabase() {
  if (db) return db;
  if (useFileStorage) return null;

  try {
    const client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // 5 second timeout
    });

    await client.connect();
    db = client.db(dbName);
    console.log("✅ Connected to MongoDB Atlas");
    return db;
  } catch (error) {
    console.error("❌ MongoDB connection failed, using file storage:", error.message);
    useFileStorage = true;
    console.log("ℹ️ Using file-based storage as fallback: data.json");
    return null;
  }
}

// Middleware
app.use(express.json());

// CORS headers for production
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Serve frontend (your HTML file)
app.use(express.static(path.join(__dirname)));

// API routes
app.get("/api/loans", async (req, res) => {
  try {
    const db = await connectToDatabase();
    
    if (db && !useFileStorage) {
      // Use MongoDB
      const collection = db.collection("borrowers");
      const borrowers = await collection.find({}).sort({ createdAt: -1 }).toArray();
      res.json(borrowers);
    } else {
      // Use file storage
      const data = readData();
      const borrowers = data.borrowers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.json(borrowers);
    }
  } catch (err) {
    console.error('Error fetching loans:', err);
    // Fallback to file storage on any error
    try {
      const data = readData();
      const borrowers = data.borrowers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      res.json(borrowers);
    } catch (fileErr) {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
});

app.post("/api/loans", async (req, res) => {
  try {
    const body = req.body;

    if (!body.name || !body.contact || !body.address) {
      return res.status(400).json({ message: "Missing required borrower fields." });
    }

    // Calculate initial remaining balance including interest
    function calculateInitialBalance(loanAmount, interestRate, term, interestType) {
      if (loanAmount <= 0 || term <= 0) return loanAmount;
      
      // Convert annual rate to monthly if needed
      let monthlyInterestRate;
      if (interestType === 'annually') {
        monthlyInterestRate = interestRate / 12;
      } else {
        monthlyInterestRate = interestRate;
      }
      
      // Calculate total interest: loan amount × interest rate (%) × term
      const monthlyInterest = loanAmount * (monthlyInterestRate / 100);
      const totalInterest = monthlyInterest * term;
      
      // Initial remaining balance = loan amount + total interest + penalties (0 for new loans)
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
      remainingBalance: calculateInitialBalance(Number(body.loanAmount) || 0, Number(body.interestRate) || 0, Number(body.term) || 0, body.interestType || "monthly"),
    };

    const db = await connectToDatabase();
    
    if (db && !useFileStorage) {
      // Use MongoDB
      const collection = db.collection("borrowers");
      const result = await collection.insertOne(borrower);
      res.status(201).json({ _id: result.insertedId, ...borrower });
    } else {
      // Use file storage
      borrower._id = generateId();
      const data = readData();
      data.borrowers.push(borrower);
      writeData(data);
      res.status(201).json(borrower);
    }
  } catch (err) {
    console.error('Error creating loan:', err);
    // Fallback to file storage
    try {
      const borrower = {
        _id: generateId(),
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
        remainingBalance: calculateInitialBalance(Number(body.loanAmount) || 0, Number(body.interestRate) || 0, Number(body.term) || 0, body.interestType || "monthly"),
      };
      const data = readData();
      data.borrowers.push(borrower);
      writeData(data);
      res.status(201).json(borrower);
    } catch (fileErr) {
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
});

app.put("/api/loans", async (req, res) => {
  try {
    const db = await connectToDatabase();
    const collection = db.collection("borrowers");
    const { id } = req.query;
    const body = req.body;

    if (!id) return res.status(400).json({ message: "Missing borrower id." });

    if (body.payment) {
      let borrower;
      
      if (db && !useFileStorage) {
        // MongoDB operation
        borrower = await collection.findOne({ _id: new ObjectId(id) });
        if (!borrower) return res.status(404).json({ message: "Borrower not found." });
      } else {
        // File storage operation
        const data = readData();
        borrower = data.borrowers.find(b => b._id === id);
        if (!borrower) return res.status(404).json({ message: "Borrower not found." });
      }

      const paymentRecord = {
        amount: Number(body.payment.amount) || 0,
        date: body.payment.date ? new Date(body.payment.date) : new Date(),
        note: body.payment.note || "",
      };

      // Enhanced payment validation
      if (!paymentRecord.amount || paymentRecord.amount <= 0) {
        return res.status(400).json({ message: "Payment amount must be greater than zero." });
      }

      if (paymentRecord.amount > 999999999) {
        return res.status(400).json({ message: "Payment amount is too large." });
      }

      if (isNaN(paymentRecord.amount)) {
        return res.status(400).json({ message: "Payment amount must be a valid number." });
      }

      // Calculate remaining balance = loan amount + total interest + total penalties - total payments
      const totalPayments = (borrower.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0) + paymentRecord.amount;
      const totalPenalties = borrower.totalPenalties || 0;
      const loanAmount = borrower.loanAmount || 0;
      
      // Calculate total interest based on loan terms
      let totalInterest = 0;
      if (borrower.interestRate && borrower.term) {
        const monthlyInterestRate = borrower.interestType === 'annually' 
          ? borrower.interestRate / 12 
          : borrower.interestRate;
        const monthlyInterest = loanAmount * (monthlyInterestRate / 100);
        totalInterest = monthlyInterest * borrower.term;
      }
      
      const newBalance = Math.max(loanAmount + totalInterest + totalPenalties - totalPayments, 0);

      const updateData = {
        $push: { payments: paymentRecord },
        $set: { remainingBalance: newBalance },
      };

      // Enhanced due date update logic for advance payments
      if (body.payment.updateDueDate && 
          borrower.monthlyPayment && 
          borrower.nextDueDate && 
          paymentRecord.amount > 0) {
        
        const currentDueDate = new Date(borrower.nextDueDate);
        const monthlyPayment = borrower.monthlyPayment;
        
        // Calculate how many months this payment covers
        const monthsCovered = Math.floor(paymentRecord.amount / monthlyPayment);
        
        if (monthsCovered >= 1) {
          // Advance the due date by the number of months covered
          const nextDueDate = new Date(currentDueDate);
          nextDueDate.setMonth(nextDueDate.getMonth() + monthsCovered);
          updateData.$set.nextDueDate = nextDueDate;
          
          // Store advance payment info for display
          updateData.$set.lastAdvancePayment = {
            amount: paymentRecord.amount,
            monthsCovered: monthsCovered,
            date: paymentRecord.date,
            originalDueDate: currentDueDate,
            newDueDate: nextDueDate
          };
        }
      }

      if (db && !useFileStorage) {
        // MongoDB operation
        await collection.updateOne({ _id: new ObjectId(id) }, updateData);
      } else {
        // File storage operation
        const data = readData();
        const borrowerIndex = data.borrowers.findIndex(b => b._id === id);
        if (borrowerIndex === -1) return res.status(404).json({ message: "Borrower not found." });
        
        // Update borrower with payment
        data.borrowers[borrowerIndex].payments = data.borrowers[borrowerIndex].payments || [];
        data.borrowers[borrowerIndex].payments.push(paymentRecord);
        data.borrowers[borrowerIndex].remainingBalance = newBalance;
        
        // Update due date if advance payment
        if (updateData.$set.nextDueDate) {
          data.borrowers[borrowerIndex].nextDueDate = updateData.$set.nextDueDate;
        }
        if (updateData.$set.lastAdvancePayment) {
          data.borrowers[borrowerIndex].lastAdvancePayment = updateData.$set.lastAdvancePayment;
        }
        
        writeData(data);
      }

      return res.json({ message: "Payment added successfully.", remainingBalance: newBalance });
    }

    if (body.penalty) {
      let borrower;
      
      if (db && !useFileStorage) {
        // MongoDB operation
        borrower = await collection.findOne({ _id: new ObjectId(id) });
        if (!borrower) return res.status(404).json({ message: "Borrower not found." });
      } else {
        // File storage operation
        const data = readData();
        borrower = data.borrowers.find(b => b._id === id);
        if (!borrower) return res.status(404).json({ message: "Borrower not found." });
      }

      const penaltyRecord = {
        amount: Number(body.penalty.amount) || 0,
        reason: body.penalty.reason || "Penalty",
        date: new Date(),
        type: "penalty"
      };

      // Calculate total penalties from existing penalty records
      const existingPenalties = (borrower.penalties || []).reduce((sum, p) => sum + (p.amount || 0), 0);
      const newTotalPenalties = existingPenalties + penaltyRecord.amount;
      
      // Calculate remaining balance = loan amount + total interest + total penalties - total payments
      const totalPayments = (borrower.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
      const loanAmount = borrower.loanAmount || 0;
      
      // Calculate total interest based on loan terms
      let totalInterest = 0;
      if (borrower.interestRate && borrower.term) {
        const monthlyInterestRate = borrower.interestType === 'annually' 
          ? borrower.interestRate / 12 
          : borrower.interestRate;
        const monthlyInterest = loanAmount * (monthlyInterestRate / 100);
        totalInterest = monthlyInterest * borrower.term;
      }
      
      const newBalance = loanAmount + totalInterest + newTotalPenalties - totalPayments;

      if (db && !useFileStorage) {
        // MongoDB operation
        await collection.updateOne(
          { _id: new ObjectId(id) },
          {
            $push: { penalties: penaltyRecord },
            $set: { 
              remainingBalance: Math.max(newBalance, 0),
              totalPenalties: newTotalPenalties
            },
          }
        );
      } else {
        // File storage operation
        const data = readData();
        const borrowerIndex = data.borrowers.findIndex(b => b._id === id);
        if (borrowerIndex === -1) return res.status(404).json({ message: "Borrower not found." });
        
        data.borrowers[borrowerIndex].penalties = data.borrowers[borrowerIndex].penalties || [];
        data.borrowers[borrowerIndex].penalties.push(penaltyRecord);
        data.borrowers[borrowerIndex].remainingBalance = Math.max(newBalance, 0);
        data.borrowers[borrowerIndex].totalPenalties = newTotalPenalties;
        
        writeData(data);
      }

      return res.json({ 
        message: "Penalty added successfully.", 
        remainingBalance: Math.max(newBalance, 0),
        totalPenalties: newTotalPenalties
      });
    }

    // Handle borrower update (edit borrower info)
    if (body.borrowerUpdate) {
      const borrower = await collection.findOne({ _id: new ObjectId(id) });
      if (!borrower) return res.status(404).json({ message: "Borrower not found." });

      const updateFields = {};
      if (body.borrowerUpdate.name) updateFields.name = body.borrowerUpdate.name;
      if (body.borrowerUpdate.contact) updateFields.contact = body.borrowerUpdate.contact;
      if (body.borrowerUpdate.address) updateFields.address = body.borrowerUpdate.address;
      if (body.borrowerUpdate.loanAmount !== undefined) updateFields.loanAmount = Number(body.borrowerUpdate.loanAmount);
      if (body.borrowerUpdate.term !== undefined) updateFields.term = Number(body.borrowerUpdate.term);
      if (body.borrowerUpdate.interestRate !== undefined) updateFields.interestRate = Number(body.borrowerUpdate.interestRate);
      if (body.borrowerUpdate.interestType) updateFields.interestType = body.borrowerUpdate.interestType;
      if (body.borrowerUpdate.nextDueDate) updateFields.nextDueDate = new Date(body.borrowerUpdate.nextDueDate);
      if (body.borrowerUpdate.monthlyPayment !== undefined) updateFields.monthlyPayment = Number(body.borrowerUpdate.monthlyPayment);

      // Recalculate remaining balance if loan terms changed
      if (body.borrowerUpdate.loanAmount !== undefined || 
          body.borrowerUpdate.term !== undefined || 
          body.borrowerUpdate.interestRate !== undefined || 
          body.borrowerUpdate.interestType) {
        
        const loanAmount = updateFields.loanAmount ?? borrower.loanAmount ?? 0;
        const term = updateFields.term ?? borrower.term ?? 0;
        const interestRate = updateFields.interestRate ?? borrower.interestRate ?? 0;
        const interestType = updateFields.interestType ?? borrower.interestType ?? 'monthly';
        
        // Calculate total interest based on updated loan terms
        let totalInterest = 0;
        if (interestRate && term) {
          const monthlyInterestRate = interestType === 'annually' 
            ? interestRate / 12 
            : interestRate;
          const monthlyInterest = loanAmount * (monthlyInterestRate / 100);
          totalInterest = monthlyInterest * term;
        }
        
        const totalPayments = (borrower.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
        const totalPenalties = borrower.totalPenalties || 0;
        const newBalance = Math.max(loanAmount + totalInterest + totalPenalties - totalPayments, 0);
        
        updateFields.remainingBalance = newBalance;
      }

      await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateFields }
      );

      return res.json({ message: "Borrower updated successfully." });
    }

    res.status(400).json({ message: "Invalid request." });
  } catch (err) {
    console.error('Error updating loan:', err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.delete("/api/loans", async (req, res) => {
  try {
    const db = await connectToDatabase();
    const collection = db.collection("borrowers");
    const { id } = req.query;

    if (!id) return res.status(400).json({ message: "Missing borrower id." });

    const result = await collection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Borrower not found." });
    }

    res.json({ message: "Borrower deleted successfully." });
  } catch (err) {
    console.error('Error deleting loan:', err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Start server
// Start server only if not in Vercel environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`);
  });
}

// Export app for Vercel
module.exports = app;
