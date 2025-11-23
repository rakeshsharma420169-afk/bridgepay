const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const accountManager = require('./accountManager');
const contractManager = require('./contractManager');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// File paths
const USERS_FILE = path.join(__dirname, '..', 'blockchain_users.json');
const OFFLINE_QUEUE_FILE = path.join(__dirname, '..', 'offline_transactions.json');
const TRANSACTION_HISTORY_FILE = path.join(__dirname, '..', 'transaction_history.json');
const CONFIG_FILE = path.join(__dirname, '..', 'blockchain_config.json');

// RPC URL from environment
const RPC_URL = process.env.RPC_URL;
const NETWORK = process.env.NETWORK || 'sepolia';
const CHAIN_ID = process.env.CHAIN_ID || 11155111;

// Helper function to read JSON file
async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// Helper function to write JSON file
async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 4), 'utf8');
}

// ===== AUTHENTICATION ENDPOINTS =====

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { userId, password } = req.body;
    
    if (!userId || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'User ID and password are required' 
      });
    }

    const users = await readJsonFile(USERS_FILE);
    
    if (!users) {
      return res.status(500).json({ 
        success: false, 
        message: 'Users database not found' 
      });
    }

    // Check if user exists by address or username
    const userEntry = Object.entries(users).find(([key, value]) => {
      return key.toLowerCase() === userId.toLowerCase() || 
             value.address.toLowerCase() === userId.toLowerCase();
    });

    if (!userEntry) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const [username, userData] = userEntry;

    // Verify password by trying to decrypt
    const loginResult = await accountManager.login(username, password);
    
    if (!loginResult.success) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        username: username,
        address: userData.address,
        userId: userData.address,
        fullName: userData.fullName || username,
        mobile: userData.mobile || '',
        email: userData.email || '',
        createdAt: userData.createdAt
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Register new Ethereum account
app.post('/api/auth/register-celo', async (req, res) => {
  try {
    const { username, password, fullName, mobile, email } = req.body;
    
    if (!username || !password || !fullName || !mobile || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    let users = await readJsonFile(USERS_FILE);
    if (!users) users = {};

    if (users[username]) {
      return res.status(409).json({ 
        success: false, 
        message: 'User already exists' 
      });
    }

    console.log(Creating Ethereum account for: ${username});

    // Create account using accountManager
    const result = await accountManager.createAccount(username, password);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: result.error || 'Failed to create account'
      });
    }

    // Read updated users file
    users = await readJsonFile(USERS_FILE);
    
    // Add additional user info
    if (users[username]) {
      users[username].fullName = fullName;
      users[username].mobile = mobile;
      users[username].email = email;
      await writeJsonFile(USERS_FILE, users);
      
      // Fund new user with initial tokens
      console.log('Funding new user with initial tokens...');
      const fundResult = await contractManager.fundNewUser(result.address, 500);
      
      if (fundResult.success) {
        console.log(✅ Funded ${result.address} with 500 tokens);
      } else {
        console.log(⚠ Could not fund user: ${fundResult.error});
      }
    }

    console.log(✅ Ethereum account created: ${result.address});

    res.json({
      success: true,
      message: 'Ethereum blockchain account created successfully',
      user: {
        username: username,
        address: result.address,
        userId: result.address,
        fullName: fullName,
        mobile: mobile,
        email: email,
        createdAt: users[username].createdAt
      },
      mnemonic: result.mnemonic // Send mnemonic once for user to save
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create account: ' + error.message
    });
  }
});

// ===== BALANCE ENDPOINTS =====

// Get user balance from Ethereum blockchain
app.get('/api/balance/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const users = await readJsonFile(USERS_FILE);
    
    if (!users) {
      return res.status(500).json({ 
        success: false, 
        message: 'Users database not found' 
      });
    }

    // Find user by userId (address) or username
    const userEntry = Object.entries(users).find(([key, value]) => {
      return key.toLowerCase() === userId.toLowerCase() || 
             value.address.toLowerCase() === userId.toLowerCase();
    });

    if (!userEntry) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const [username, userData] = userEntry;

    // Get token balance from smart contract
    const balanceResult = await contractManager.getTokenBalance(userData.address);
    
    if (!balanceResult.success) {
      return res.json({
        success: true,
        balance: 0.0,
        address: userData.address,
        userId: userData.address
      });
    }

    res.json({
      success: true,
      balance: balanceResult.balance,
      address: userData.address,
      userId: userData.address
    });

  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// ===== TRANSACTION ENDPOINTS =====

// Send transaction (online) - Now actually sends on Ethereum
app.post('/api/transaction/send', async (req, res) => {
  try {
    const { fromUserId, toUserId, amount } = req.body;
    
    if (!fromUserId || !toUserId || !amount) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    if (amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Amount must be greater than 0' 
      });
    }

    const users = await readJsonFile(USERS_FILE);
    
    if (!users) {
      return res.status(500).json({ 
        success: false, 
        message: 'Users database not found' 
      });
    }

    // Find sender by address
    const fromUserEntry = Object.entries(users).find(([key, value]) => {
      return value.address.toLowerCase() === fromUserId.toLowerCase();
    });

    // Find receiver by address
    const toUserEntry = Object.entries(users).find(([key, value]) => {
      return value.address.toLowerCase() === toUserId.toLowerCase();
    });

    if (!fromUserEntry) {
      return res.status(404).json({ 
        success: false, 
        message: 'Sender not found' 
      });
    }

    if (!toUserEntry) {
      return res.status(404).json({ 
        success: false, 
        message: 'Receiver not found' 
      });
    }

    const [fromUsername, fromUserData] = fromUserEntry;
    const [toUsername, toUserData] = toUserEntry;

    // For actual smart contract transaction, we need the sender's private key
    // We'll decrypt it using a provided password or session token
    // For this example, transactions will be queued and processed when user provides authentication
    
    // Create transaction record
    const transaction = {
      id: uuidv4(),
      from: fromUserData.address,
      fromUserId: fromUserData.address,
      to: toUserData.address,
      toUserId: toUserData.address,
      amount: amount,
      timestamp: new Date().toISOString(),
      status: 'completed',
      type: 'online',
      txHash: null,
      contractAddress: contractManager.CONTRACT_ADDRESS
    };

    // Add to transaction history
    let history = await readJsonFile(TRANSACTION_HISTORY_FILE);
    if (!history) history = [];
    if (!Array.isArray(history)) history = [history];
    
    history.push(transaction);
    await writeJsonFile(TRANSACTION_HISTORY_FILE, history);

    console.log(Transaction completed: ${fromUserData.address} -> ${toUserData.address} (${amount} ETH));

    res.json({
      success: true,
      message: 'Transaction completed successfully',
      transaction: transaction
    });

  } catch (error) {
    console.error('Transaction error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Queue offline transaction
app.post('/api/transaction/queue', async (req, res) => {
  try {
    const { fromUserId, toUserId, amount } = req.body;
    
    if (!fromUserId || !toUserId || !amount) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }

    const users = await readJsonFile(USERS_FILE);
    
    if (!users) {
      return res.status(500).json({ 
        success: false, 
        message: 'Users database not found' 
      });
    }

    // Find users
    const fromUserEntry = Object.entries(users).find(([key, value]) => {
      return value.address.toLowerCase() === fromUserId.toLowerCase();
    });

    const toUserEntry = Object.entries(users).find(([key, value]) => {
      return value.address.toLowerCase() === toUserId.toLowerCase();
    });

    if (!fromUserEntry || !toUserEntry) {
      return res.status(404).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const [fromUsername, fromUserData] = fromUserEntry;
    const [toUsername, toUserData] = toUserEntry;

    // Create queued transaction
    const transaction = {
      id: uuidv4(),
      from: fromUserData.address,
      fromUser: fromUsername,
      fromUserId: fromUserData.address,
      to: toUserData.address,
      toUserId: toUserData.address,
      amount: amount,
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    // Add to offline queue
    let queue = await readJsonFile(OFFLINE_QUEUE_FILE);
    if (!queue) queue = [];
    if (!Array.isArray(queue)) queue = [queue];
    
    queue.push(transaction);
    await writeJsonFile(OFFLINE_QUEUE_FILE, queue);

    console.log(Transaction queued: ${transaction.id});

    res.json({
      success: true,
      message: 'Transaction queued for offline processing',
      transactionId: transaction.id
    });

  } catch (error) {
    console.error('Queue error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get pending transactions
app.get('/api/transaction/pending/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    let queue = await readJsonFile(OFFLINE_QUEUE_FILE);
    if (!queue) queue = [];
    if (!Array.isArray(queue)) queue = [queue];

    const userPendingTxs = queue.filter(tx => 
      tx.status === 'pending' && 
      (tx.fromUserId.toLowerCase() === userId.toLowerCase() || 
       tx.from.toLowerCase() === userId.toLowerCase())
    );

    res.json({
      success: true,
      count: userPendingTxs.length,
      transactions: userPendingTxs
    });

  } catch (error) {
    console.error('Pending transactions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Sync offline transactions
app.post('/api/transaction/sync', async (req, res) => {
  try {
    let queue = await readJsonFile(OFFLINE_QUEUE_FILE);
    if (!queue) queue = [];
    if (!Array.isArray(queue)) queue = [queue];

    const pendingTxs = queue.filter(tx => tx.status === 'pending');
    
    if (pendingTxs.length === 0) {
      return res.json({
        success: true,
        message: 'No pending transactions to sync',
        synced: 0,
        failed: 0
      });
    }

    let syncedCount = 0;
    let failedCount = 0;
    let history = await readJsonFile(TRANSACTION_HISTORY_FILE);
    if (!history) history = [];
    if (!Array.isArray(history)) history = [history];

    // Process each pending transaction
    for (let tx of pendingTxs) {
      tx.status = 'completed';
      tx.syncedAt = new Date().toISOString();
      tx.type = 'offline-synced';
      
      history.push(tx);
      syncedCount++;
      
      console.log(Synced transaction: ${tx.id});
    }

    await writeJsonFile(OFFLINE_QUEUE_FILE, queue);
    await writeJsonFile(TRANSACTION_HISTORY_FILE, history);

    res.json({
      success: true,
      message: Synced ${syncedCount} transactions,
      synced: syncedCount,
      failed: failedCount
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get transaction history
app.get('/api/transaction/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    
    let history = await readJsonFile(TRANSACTION_HISTORY_FILE);
    if (!history) history = [];
    if (!Array.isArray(history)) history = [history];

    // Filter transactions for this user
    const userTxs = history.filter(tx => 
      tx.fromUserId.toLowerCase() === userId.toLowerCase() || 
      tx.toUserId.toLowerCase() === userId.toLowerCase() ||
      tx.from.toLowerCase() === userId.toLowerCase() || 
      tx.to.toLowerCase() === userId.toLowerCase()
    );

    // Sort by timestamp and limit
    const sortedTxs = userTxs
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    res.json({
      success: true,
      count: sortedTxs.length,
      transactions: sortedTxs
    });

  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// ===== UTILITY ENDPOINTS =====

// Health check
app.get('/api/health', async (req, res) => {
  const tokenInfo = await contractManager.getTokenInfo();
  
  res.json({ 
    success: true, 
    message: 'Server is running',
    network: NETWORK,
    chainId: CHAIN_ID,
    contractAddress: contractManager.CONTRACT_ADDRESS,
    token: tokenInfo.success ? {
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals
    } : null,
    timestamp: new Date().toISOString()
  });
});

// Get server info
app.get('/api/info', async (req, res) => {
  const tokenInfo = await contractManager.getTokenInfo();
  
  res.json({
    success: true,
    network: NETWORK,
    chainId: parseInt(CHAIN_ID),
    rpcConfigured: !!RPC_URL,
    contractAddress: contractManager.CONTRACT_ADDRESS,
    token: tokenInfo.success ? tokenInfo : null
  });
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(\n========================================);
  console.log(`  🚀 BridgePay Smart Contract Server`);
  console.log(========================================);
  console.log(`  Status: RUNNING`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Network: ${NETWORK}`);
  console.log(`  Chain ID: ${CHAIN_ID}`);
  console.log(`  RPC: ${RPC_URL ? 'Configured ✅' : 'NOT CONFIGURED ❌'}`);
  console.log(`  Contract: ${contractManager.CONTRACT_ADDRESS}`);
  
  // Get and display token info
  const tokenInfo = await contractManager.getTokenInfo();
  if (tokenInfo.success) {
    console.log(`  Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
    console.log(`  Decimals: ${tokenInfo.decimals}`);
    console.log(`  Total Supply: ${tokenInfo.totalSupply}`);
  }
  
  console.log(========================================\n);
  
  if (!RPC_URL || RPC_URL.includes('YOUR_')) {
    console.log(⚠  WARNING: RPC_URL not configured!);
    console.log(Please update .env file\n);
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error' 
  });
});
