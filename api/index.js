// api/index.js - Vercel Serverless Function
const { MongoClient, ObjectId } = require("mongodb");

// Main serverless function handler
module.exports = async function handler(req, res) {
  try {
    // Debug logging
    console.log('=== API Handler Called ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('MongoDB URI:', process.env.MONGODB_URI ? 'Set' : 'Not set');
    console.log('Node ENV:', process.env.NODE_ENV);
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
      console.log('OPTIONS request handled');
      return res.status(200).end();
    }

    // Simple response for initial testing
    if (req.method === 'GET') {
      console.log('GET request - returning test data');
      
      // Test MongoDB connection
      if (process.env.MONGODB_URI) {
        try {
          console.log('Attempting MongoDB connection...');
          const client = new MongoClient(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
          });
          
          await client.connect();
          const db = client.db(process.env.MONGODB_DB || "loanapp");
          const collection = db.collection("borrowers");
          
          console.log('MongoDB connected successfully');
          const borrowers = await collection.find({}).limit(10).toArray();
          await client.close();
          
          console.log('Found', borrowers.length, 'borrowers');
          return res.status(200).json(borrowers);
        } catch (dbError) {
          console.error('MongoDB connection failed:', dbError.message);
          return res.status(200).json({ 
            message: 'API working, MongoDB connection failed', 
            error: dbError.message,
            fallback: true 
          });
        }
      } else {
        console.log('No MongoDB URI found');
        return res.status(200).json({ 
          message: 'API working, no MongoDB configured',
          timestamp: new Date().toISOString()
        });
      }
    }
    
    if (req.method === 'POST') {
      console.log('POST request received');
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      
      const body = req.body;
      
      if (!body.name || !body.contact || !body.address) {
        return res.status(400).json({ message: "Missing required borrower fields." });
      }
      
      // Calculate initial remaining balance
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
      
      if (process.env.MONGODB_URI) {
        try {
          console.log('Creating borrower in MongoDB...');
          const client = new MongoClient(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
          });
          
          await client.connect();
          const db = client.db(process.env.MONGODB_DB || "loanapp");
          const collection = db.collection("borrowers");
          
          const result = await collection.insertOne(borrower);
          await client.close();
          
          console.log('Borrower created with ID:', result.insertedId);
          return res.status(201).json({ _id: result.insertedId, ...borrower });
        } catch (dbError) {
          console.error('Error creating borrower:', dbError.message);
          return res.status(500).json({ 
            message: "Database error", 
            error: dbError.message 
          });
        }
      } else {
        borrower._id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        console.log('Created borrower (no DB):', borrower._id);
        return res.status(201).json(borrower);
      }
    }
    
    // For PUT and DELETE, return method not implemented for now
    if (req.method === 'PUT' || req.method === 'DELETE') {
      console.log(req.method + ' request - not implemented yet');
      return res.status(501).json({ message: req.method + " method not implemented yet" });
    }
    
    console.log('Method not allowed:', req.method);
    return res.status(405).json({ message: "Method not allowed: " + req.method });
    
  } catch (error) {
    console.error('=== CRITICAL ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    return res.status(500).json({ 
      message: "Internal Server Error",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};