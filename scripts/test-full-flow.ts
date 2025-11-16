
import { ethers } from "hardhat";
import axios from 'axios';

async function main() {
  console.log("🧪 Testing Complete Transaction Flow\n");

  const [owner, user1, user2] = await ethers.getSigners();
  
  const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const BridgePay = await ethers.getContractFactory("BridgePay");
  const contract = BridgePay.attach(contractAddress);

  console.log("📋 Setup:");
  console.log("   Contract:", contract.address);
  console.log("   User 1:", user1.address);
  console.log("   User 2:", user2.address);
  console.log("");

  // Step 1: Deposit funds
  console.log("💰 Step 1: Depositing 10 ETH to user1...");
  const depositTx = await contract.connect(user1).deposit({ 
    value: ethers.utils.parseEther("10") 
  });
  await depositTx.wait();
  
  let balance = await contract.getBalance(user1.address);
  console.log("   ✅ User1 balance:", ethers.utils.formatEther(balance), "ETH\n");

  // Step 2: Get nonce
  console.log("🔢 Step 2: Getting nonce...");
  const nonce = await contract.getNonce(user1.address);
  console.log("   ✅ Nonce:", nonce.toNumber(), "\n");

  // Step 3: Create signed transaction
  console.log("✍️  Step 3: Creating EIP-712 signed transaction...");
  
  const clientTxId = ethers.utils.hexlify(ethers.utils.randomBytes(32));
  const expiry = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
  const amount = ethers.utils.parseEther("1");

  const domain = {
    name: 'BridgePay',
    version: '1',
    chainId: 31337,
    verifyingContract: contract.address
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

  const value = {
    from: user1.address,
    to: user2.address,
    amount,
    nonce: nonce.toNumber(),
    expiry,
    clientTxId
  };

  const signature = await user1._signTypedData(domain, types, value);
  console.log("   ✅ Transaction signed\n");

  // Step 4: Submit to server
  console.log("📤 Step 4: Submitting to server API...");
  
  const serverResponse = await axios.post('http://localhost:3000/offline/tx', {
    from: user1.address,
    to: user2.address,
    amount: amount.toString(),
    nonce: nonce.toNumber(),
    expiry,
    clientTxId,
    signature
  });

  console.log("   ✅ Server Response:");
  console.log("      Server TX ID:", serverResponse.data.serverTxId);
  console.log("      TX ID:", serverResponse.data.txId);
  console.log("      Status:", serverResponse.data.status);
  console.log("");

  const serverTxId = serverResponse.data.serverTxId;

  // Step 5: Check status
  console.log("🔍 Step 5: Checking transaction status...");
  const statusResponse = await axios.get(`http://localhost:3000/offline/tx/${serverTxId}`);
  console.log("   ✅ Status:", statusResponse.data.status);
  console.log("");

  // Step 6: Push to blockchain
  console.log("⛓️  Step 6: Pushing to blockchain...");
  const syncResponse = await axios.post('http://localhost:3000/sync/push');
  console.log("   ✅ Pushed:", syncResponse.data.pushed, "transaction(s)");
  console.log("   On-chain TX:", syncResponse.data.results[0].onChainTxHash);
  console.log("");

  // Step 7: Check updated status
  console.log("🔍 Step 7: Checking updated status...");
  const updatedStatus = await axios.get(`http://localhost:3000/offline/tx/${serverTxId}`);
  console.log("   ✅ Status:", updatedStatus.data.status);
  console.log("   On-chain hash:", updatedStatus.data.onChainTxHash);
  console.log("");

  // Step 8: Check balances via API
  console.log("💰 Step 8: Checking balances via API...");
  const balance1 = await axios.get(`http://localhost:3000/balance/${user1.address}`);
  const balance2 = await axios.get(`http://localhost:3000/balance/${user2.address}`);
  
  console.log("   User1 balance:", balance1.data.balanceETH, "ETH");
  console.log("   User2 balance:", balance2.data.balanceETH, "ETH");
  console.log("");

  console.log("🎉 Complete transaction flow successful!");
  console.log("\n📊 Summary:");
  console.log("   ✅ Funds deposited");
  console.log("   ✅ Transaction signed offline (EIP-712)");
  console.log("   ✅ Submitted to server API");
  console.log("   ✅ Pushed to blockchain");
  console.log("   ✅ Transaction confirmed on-chain");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});