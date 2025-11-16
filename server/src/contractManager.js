// Smart Contract Manager for BridgePay Token
const { ethers } = require('ethers');
require('dotenv').config();

const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const ADMIN_PRIVATE_KEY = process.env.PRIVATE_KEY;

// Standard ERC20 Token ABI (works with most token contracts)
const TOKEN_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "event Approval(address indexed owner, address indexed spender, uint256 value)",
    
    // Common extended functions (if your contract has them)
    "function mint(address to, uint256 amount) returns (bool)",
    "function burn(uint256 amount) returns (bool)"
];

// Get provider and contract instance
function getContract() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, TOKEN_ABI, provider);
    return { provider, contract };
}

// Get contract with signer (for write operations)
function getContractWithSigner(privateKey) {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, TOKEN_ABI, wallet);
    return { provider, wallet, contract };
}

// Get token info
async function getTokenInfo() {
    try {
        const { contract } = getContract();
        
        const name = await contract.name();
        const symbol = await contract.symbol();
        const decimals = await contract.decimals();
        const totalSupply = await contract.totalSupply();
        
        return {
            success: true,
            name,
            symbol,
            decimals: Number(decimals),
            totalSupply: ethers.formatUnits(totalSupply, decimals)
        };
    } catch (error) {
        console.error('Error getting token info:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Get token balance for an address
async function getTokenBalance(address) {
    try {
        const { contract } = getContract();
        const balance = await contract.balanceOf(address);
        const decimals = await contract.decimals();
        
        const balanceFormatted = ethers.formatUnits(balance, decimals);
        
        console.log(`Token balance for ${address}: ${balanceFormatted}`);
        
        return {
            success: true,
            balance: parseFloat(balanceFormatted),
            balanceRaw: balance.toString(),
            decimals: Number(decimals)
        };
    } catch (error) {
        console.error('Error getting token balance:', error);
        return {
            success: false,
            balance: 0,
            error: error.message
        };
    }
}

// Get ETH balance (for gas fees)
async function getEthBalance(address) {
    try {
        const { provider } = getContract();
        const balance = await provider.getBalance(address);
        const balanceFormatted = ethers.formatEther(balance);
        
        return {
            success: true,
            balance: parseFloat(balanceFormatted),
            balanceWei: balance.toString()
        };
    } catch (error) {
        console.error('Error getting ETH balance:', error);
        return {
            success: false,
            balance: 0,
            error: error.message
        };
    }
}

// Transfer tokens
async function transferTokens(fromPrivateKey, toAddress, amount) {
    try {
        const { wallet, contract } = getContractWithSigner(fromPrivateKey);
        const decimals = await contract.decimals();
        
        // Convert amount to token units (considering decimals)
        const amountInUnits = ethers.parseUnits(amount.toString(), decimals);
        
        console.log(`Transferring ${amount} tokens from ${wallet.address} to ${toAddress}...`);
        
        // Check balance first
        const balance = await contract.balanceOf(wallet.address);
        if (balance < amountInUnits) {
            throw new Error('Insufficient token balance');
        }
        
        // Check ETH balance for gas
        const ethBalance = await wallet.provider.getBalance(wallet.address);
        if (ethBalance === 0n) {
            throw new Error('Insufficient ETH for gas fees');
        }
        
        // Execute transfer
        const tx = await contract.transfer(toAddress, amountInUnits);
        console.log(`Transaction sent: ${tx.hash}`);
        console.log('Waiting for confirmation...');
        
        const receipt = await tx.wait();
        console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
        
        return {
            success: true,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            from: wallet.address,
            to: toAddress,
            amount: amount
        };
    } catch (error) {
        console.error('Transfer error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Mint tokens (if contract has mint function and caller is authorized)
async function mintTokens(toAddress, amount) {
    try {
        const { wallet, contract } = getContractWithSigner(ADMIN_PRIVATE_KEY);
        const decimals = await contract.decimals();
        const amountInUnits = ethers.parseUnits(amount.toString(), decimals);
        
        console.log(`Minting ${amount} tokens to ${toAddress}...`);
        
        const tx = await contract.mint(toAddress, amountInUnits);
        console.log(`Mint transaction sent: ${tx.hash}`);
        
        const receipt = await tx.wait();
        console.log(`✅ Mint confirmed in block ${receipt.blockNumber}`);
        
        return {
            success: true,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            to: toAddress,
            amount: amount
        };
    } catch (error) {
        console.error('Mint error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Give initial tokens to new users
async function fundNewUser(address, initialAmount = 5000) {
    try {
        console.log(`Funding new user ${address} with ${initialAmount} tokens...`);
        
        // Try to mint tokens
        const result = await mintTokens(address, initialAmount);
        
        if (!result.success) {
            // If minting fails, try transfer from admin wallet
            console.log('Minting failed, trying transfer from admin...');
            return await transferTokens(ADMIN_PRIVATE_KEY, address, initialAmount);
        }
        
        return result;
    } catch (error) {
        console.error('Fund user error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    getTokenInfo,
    getTokenBalance,
    getEthBalance,
    transferTokens,
    mintTokens,
    fundNewUser,
    CONTRACT_ADDRESS
};