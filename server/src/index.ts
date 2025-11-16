
import express, { Request, Response } from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Contract ABI (minimal for our needs)
const CONTRACT_ABI = [
  "function submitOfflineTx(address,address,uint256,bytes,uint256,uint256,bytes32) returns (bytes32)",
  "function finalizeTx(bytes32)",
  "function getBalance(address) view returns (uint256)",
  "function getNonce(address) view returns (uint256)",
  "function getTransaction(bytes32) view returns (tuple(address from, address to, uint256 amount, uint256 nonce, uint256 expiry, bytes32 clientTxId, uint256 submittedAt, uint256 finalizedAt, uint8 status, address relayer))",
  "function deposit() payable",
  "event OfflineTxSubmitted(bytes32 indexed txHash, bytes32 indexed clientTxId, address indexed from, address to, uint256 amount, uint256 submittedAt)"
];

// Configuration
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Initialize provider and contract
let provider: ethers.providers.JsonRpcProvider;
let wallet: ethers.Wallet;
let contract: ethers.Contract;

try {
  provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
  console.log('✅ Connected to blockchain');
  console.log('📝 Contract:', CONTRACT_ADDRESS);
} catch (error) {
  console.error('⚠️  Blockchain connection failed:', error);
}

// EIP-712 Domain
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

// In-memory transaction store
interface OfflineTx {
  serverTxId: string;
  txId: string;
  clientTxId: string;
  from: string;
  to: string;
  amount: string;
  nonce: number;
  expiry: number;
  signature: string;
  status: string;
  queuedAt: number;
  onChainTxHash?: string;
  submittedAt?: number;
}

const transactions = new Map<string, OfflineTx>();

// Routes

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    contract: CONTRACT_ADDRESS,
    chainId: 31337
  });
});

// Submit offline transaction
app.post('/offline/tx', async (req: Request, res: Response) => {
  try {
    const { from, to, amount, nonce, expiry, clientTxId, signature } = req.body;

    // Validation
    if (!ethers.utils.isAddress(from) || !ethers.utils.isAddress(to)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    if (!amount || ethers.BigNumber.from(amount).lte(0)) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Verify signature
    const value = {
      from,
      to,
      amount: ethers.BigNumber.from(amount),
      nonce,
      expiry,
      clientTxId
    };

    const recoveredAddress = ethers.utils.verifyTypedData(domain, types, value, signature);
    
    if (recoveredAddress.toLowerCase() !== from.toLowerCase()) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Generate IDs
    const serverTxId = uuidv4();
    const txId = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['address', 'address', 'uint256', 'uint256', 'uint256', 'bytes32'],
        [from, to, amount, nonce, expiry, clientTxId]
      )
    );

    const tx: OfflineTx = {
      serverTxId,
      txId,
      clientTxId,
      from,
      to,
      amount,
      nonce,
      expiry,
      signature,
      status: 'PENDING',
      queuedAt: Date.now()
    };

    transactions.set(serverTxId, tx);

    console.log(`✅ Transaction accepted: ${serverTxId}`);

    res.json({
      serverTxId,
      txId,
      status: 'PENDING',
      queuedAt: tx.queuedAt
    });

  } catch (error: any) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get transaction status
app.get('/offline/tx/:serverTxId', (req: Request, res: Response) => {
  const tx = transactions.get(req.params.serverTxId);
  
  if (!tx) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  res.json(tx);
});

// Push transactions to blockchain
app.post('/sync/push', async (req: Request, res: Response) => {
  try {
    if (!provider || !contract) {
      return res.status(503).json({ error: 'Blockchain unavailable' });
    }

    const results = [];

    for (const [serverTxId, tx] of transactions) {
      if (tx.status !== 'PENDING') continue;

      try {
        // Submit to blockchain
        const contractTx = await contract.submitOfflineTx(
          tx.from,
          tx.to,
          tx.amount,
          tx.signature,
          tx.nonce,
          tx.expiry,
          tx.clientTxId
        );

        const receipt = await contractTx.wait();

        tx.status = 'SUBMITTED';
        tx.submittedAt = Date.now();
        tx.onChainTxHash = receipt.transactionHash;

        results.push({
          serverTxId,
          txId: tx.txId,
          status: 'SUBMITTED',
          onChainTxHash: receipt.transactionHash
        });

        console.log(`✅ Submitted: ${serverTxId} -> ${receipt.transactionHash}`);

      } catch (error: any) {
        console.error(`❌ Failed ${serverTxId}:`, error.message);
        results.push({
          serverTxId,
          status: 'FAILED',
          error: error.message
        });
      }
    }

    res.json({
      pushed: results.length,
      results
    });

  } catch (error: any) {
    console.error('Sync push error:', error);
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

// List all transactions
app.get('/transactions', (req: Request, res: Response) => {
  const txList = Array.from(transactions.values());
  res.json({
    count: txList.length,
    transactions: txList
  });
});

// Get EIP-712 domain (for clients to use)
app.get('/eip712-domain', (req: Request, res: Response) => {
  res.json({
    domain,
    types
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 BridgePay Server running on port ${PORT}`);
  console.log(`📡 Health: http://localhost:${PORT}/health`);
  console.log(`📝 API Docs: http://localhost:${PORT}/api-docs`);
});