import express, { Request, Response } from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import mongoose from 'mongoose'; // Add this

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// ============================================
// MONGODB SCHEMAS
// ============================================
const TransactionSchema = new mongoose.Schema({
  serverTxId: { type: String, required: true, unique: true },
  txId: String,
  clientTxId: String,
  from: String,
  to: String,
  amount: String,
  nonce: Number,
  expiry: Number,
  signature: String,
  status: String,
  queuedAt: Number,
  onChainTxHash: String,
  submittedAt: Number
});

const BalanceSchema = new mongoose.Schema({
  address: { type: String, required: true, unique: true },
  balance: { type: String, default: '0' }
});

const Transaction = mongoose.model('Transaction', TransactionSchema);
const Balance = mongoose.model('Balance', BalanceSchema);

// ============================================
// CONNECT TO MONGODB
// ============================================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bridgepay';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Contract setup (same as before)
const CONTRACT_ABI = [
  "function submitOfflineTx(address,address,uint256,bytes,uint256,uint256,bytes32) returns (bytes32)",
  "function finalizeTx(bytes32)",
  "function getBalance(address) view returns (uint256)",
  "function getNonce(address) view returns (uint256)",
  "function deposit() payable"
];

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

let provider: ethers.providers.JsonRpcProvider;
let wallet: ethers.Wallet;
let contract: ethers.Contract;

try {
  provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
  console.log('✅ Connected to blockchain');
} catch (error) {
  console.error('⚠️  Blockchain connection failed');
}

// EIP-712 setup (same as before)
const domain = {
  name: 'BridgePay',
  version: '1',
  chainId: 31337,
  verifyingContract: CONTRACT_ADDRESS
};

const types = {
  OfflineTransaction: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'clientTxId', type: 'bytes32' }
  ]
};

// ============================================
// ROUTES
// ============================================

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    contract: CONTRACT_ADDRESS,
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Submit offline transaction - NOW SAVES TO DATABASE
app.post('/offline/tx', async (req: Request, res: Response) => {
  try {
    const { from, to, amount, nonce, expiry, clientTxId, signature } = req.body;

    if (!ethers.utils.isAddress(from) || !ethers.utils.isAddress(to)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const value = {
      from, to,
      amount: ethers.BigNumber.from(amount),
      nonce, expiry, clientTxId
    };

    const recoveredAddress = ethers.utils.verifyTypedData(domain, types, value, signature);
    if (recoveredAddress.toLowerCase() !== from.toLowerCase()) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const serverTxId = uuidv4();
    const txId = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes32'],
        [from, to, amount, nonce, expiry, clientTxId]
      )
    );

    // Save to MongoDB instead of memory
    const newTx = new Transaction({
      serverTxId, txId, clientTxId,
      from, to, amount, nonce, expiry, signature,
      status: 'PENDING',
      queuedAt: Date.now()
    });

    await newTx.save();

    console.log(`✅ Transaction saved: ${serverTxId}`);

    res.json({
      serverTxId, txId,
      status: 'PENDING',
      queuedAt: newTx.queuedAt
    });

  } catch (error: any) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction status - FROM DATABASE
app.get('/offline/tx/:serverTxId', async (req: Request, res: Response) => {
  try {
    const tx = await Transaction.findOne({ serverTxId: req.params.serverTxId });
    
    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(tx);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Push transactions to blockchain - FROM DATABASE
app.post('/sync/push', async (req: Request, res: Response) => {
  try {
    if (!provider || !contract) {
      return res.status(503).json({ error: 'Blockchain unavailable' });
    }

    // Get all PENDING transactions from database
    const pendingTxs = await Transaction.find({ status: 'PENDING' });
    const results = [];

    for (const tx of pendingTxs) {
      try {
        const contractTx = await contract.submitOfflineTx(
          tx.from, tx.to, tx.amount, tx.signature,
          tx.nonce, tx.expiry, tx.clientTxId
        );

        const receipt = await contractTx.wait();

        // Update in database
        tx.status = 'SUBMITTED';
        tx.submittedAt = Date.now();
        tx.onChainTxHash = receipt.transactionHash;
        await tx.save();

        results.push({
          serverTxId: tx.serverTxId,
          status: 'SUBMITTED',
          onChainTxHash: receipt.transactionHash
        });

        console.log(`✅ Submitted: ${tx.serverTxId}`);

      } catch (error: any) {
        console.error(`❌ Failed ${tx.serverTxId}:`, error.message);
        results.push({
          serverTxId: tx.serverTxId,
          status: 'FAILED',
          error: error.message
        });
      }
    }

    res.json({ pushed: results.length, results });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get all transactions - FROM DATABASE
app.get('/transactions', async (req: Request, res: Response) => {
  try {
    const txs = await Transaction.find().sort({ queuedAt: -1 });
    res.json({
      count: txs.length,
      transactions: txs
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get balance
app.get('/balance/:address', async (req: Request, res: Response) => {
  try {
    if (!contract) {
      return res.status(503).json({ error: 'Blockchain unavailable' });
    }

    const balance = await contract.getBalance(req.params.address);
    
    res.json({
      address: req.params.address,
      balance: balance.toString(),
      balanceETH: ethers.utils.formatEther(balance)
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get nonce
app.get('/nonce/:address', async (req: Request, res: Response) => {
  try {
    if (!contract) {
      return res.status(503).json({ error: 'Blockchain unavailable' });
    }

    const nonce = await contract.getNonce(req.params.address);
    res.json({
      address: req.params.address,
      nonce: nonce.toNumber()
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN FUNDING ENDPOINT (No shell needed!)
// ============================================
app.post('/admin/fund', async (req: Request, res: Response) => {
  try {
    const { address, amountETH, secret } = req.body;

    // Security check
    if (secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!ethers.utils.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    if (!contract || !wallet) {
      return res.status(503).json({ error: 'Blockchain unavailable' });
    }

    console.log(`💰 Admin funding ${address} with ${amountETH} ETH`);

    // Server wallet deposits to contract
    const tx = await contract.deposit({
      value: ethers.utils.parseEther(amountETH)
    });

    await tx.wait();

    // Get new balance
    const balance = await contract.getBalance(address);

    // Save to database
    await Balance.findOneAndUpdate(
      { address },
      { balance: balance.toString() },
      { upsert: true }
    );

    console.log(`✅ Funded ${address}`);

    res.json({
      success: true,
      address,
      amountAdded: amountETH,
      txHash: tx.hash,
      newBalance: ethers.utils.formatEther(balance)
    });

  } catch (error: any) {
    console.error('Funding error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/eip712-domain', (req: Request, res: Response) => {
  res.json({ domain, types });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 BridgePay Server running on port ${PORT}`);
  console.log(`📡 Health: http://localhost:${PORT}/health`);
});