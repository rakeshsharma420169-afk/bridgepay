// Ethereum Blockchain Account Manager
// Works with: Ethereum, BSC, Polygon, Arbitrum, Base, etc.

const { ethers } = require('ethers');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, '..', 'blockchain_users.json');

// Encryption helpers
function encrypt(text, password) {
    const key = crypto.scryptSync(password, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedData, password) {
    try {
        const parts = encryptedData.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encrypted = parts[1];
        const key = crypto.scryptSync(password, 'salt', 32);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        throw new Error('Invalid password');
    }
}

// Create new blockchain account
async function createAccount(username, password) {
    try {
        // Read existing users
        let users = {};
        try {
            const data = await fs.readFile(USERS_FILE, 'utf8');
            users = JSON.parse(data);
        } catch (error) {
            // File doesn't exist yet, will create it
        }

        // Check if user already exists
        if (users[username]) {
            throw new Error('User already exists');
        }

        // Create new wallet
        const wallet = ethers.Wallet.createRandom();
        const address = wallet.address;
        const privateKey = wallet.privateKey;
        const mnemonic = wallet.mnemonic.phrase;

        // Encrypt private key with password
        const encryptedPrivateKey = encrypt(privateKey, password);

        // Store user data
        users[username] = {
            address: address,
            encryptedPrivateKey: encryptedPrivateKey,
            mnemonic: encrypt(mnemonic, password), // Also encrypt mnemonic
            createdAt: new Date().toISOString(),
            lastLogin: null,
            balance: 0.0
        };

        // Save to file
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 4));

        console.log(`✅ Ethereum account created for ${username}`);
        console.log(`Address: ${address}`);

        return {
            success: true,
            address: address,
            encryptedPrivateKey: encryptedPrivateKey,
            mnemonic: mnemonic // Return for one-time display to user
        };

    } catch (error) {
        console.error('❌ Error creating account:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// Login (verify password and return decrypted private key)
async function login(username, password) {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        const users = JSON.parse(data);

        if (!users[username]) {
            throw new Error('User not found');
        }

        const userData = users[username];

        // Try to decrypt private key with password
        const privateKey = decrypt(userData.encryptedPrivateKey, password);
        const wallet = new ethers.Wallet(privateKey);

        // Verify address matches
        if (wallet.address.toLowerCase() !== userData.address.toLowerCase()) {
            throw new Error('Invalid password');
        }

        // Update last login
        users[username].lastLogin = new Date().toISOString();
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 4));

        console.log(`✅ Login successful for ${username}`);

        return {
            success: true,
            address: userData.address,
            privateKey: privateKey
        };

    } catch (error) {
        console.error('❌ Login error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// Get balance (works with any EVM chain)
async function getBalance(address, rpcUrl) {
    try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const balance = await provider.getBalance(address);
        const balanceInEther = ethers.formatEther(balance);

        console.log(`Balance for ${address}: ${balanceInEther} ETH`);
        
        return {
            success: true,
            balance: parseFloat(balanceInEther),
            balanceWei: balance.toString()
        };

    } catch (error) {
        console.error('❌ Error fetching balance:', error.message);
        return {
            success: false,
            error: error.message,
            balance: 0.0
        };
    }
}

// Send transaction (works with any EVM chain)
async function sendTransaction(fromPrivateKey, toAddress, amount, rpcUrl) {
    try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(fromPrivateKey, provider);

        // Convert amount to Wei
        const amountWei = ethers.parseEther(amount.toString());

        // Check balance first
        const balance = await provider.getBalance(wallet.address);
        if (balance < amountWei) {
            throw new Error('Insufficient balance');
        }

        // Create transaction
        const tx = await wallet.sendTransaction({
            to: toAddress,
            value: amountWei
        });

        console.log(`📤 Transaction sent: ${tx.hash}`);
        console.log('⏳ Waiting for confirmation...');

        // Wait for confirmation
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
        console.error('❌ Transaction error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// Get user by address
async function getUserByAddress(address) {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        const users = JSON.parse(data);

        const userEntry = Object.entries(users).find(([key, value]) => 
            value.address.toLowerCase() === address.toLowerCase()
        );

        if (!userEntry) {
            return null;
        }

        const [username, userData] = userEntry;
        return {
            username,
            ...userData
        };
    } catch (error) {
        return null;
    }
}

// Export functions for use in server
module.exports = {
    createAccount,
    login,
    getBalance,
    sendTransaction,
    getUserByAddress,
    decrypt
};

// CLI usage (for testing)
if (require.main === module) {
    const command = process.argv[2];
    
    switch(command) {
        case 'create':
            const username = process.argv[3];
            const password = process.argv[4];
            if (!username || !password) {
                console.log('Usage: node accountManager.js create <username> <password>');
                process.exit(1);
            }
            createAccount(username, password).then(result => {
                if (result.success) {
                    console.log('\n🔑 SAVE THIS MNEMONIC PHRASE:');
                    console.log(result.mnemonic);
                }
            });
            break;
            
        case 'balance':
            const address = process.argv[3];
            const rpcUrl = process.argv[4] || process.env.RPC_URL || 'https://sepolia.infura.io/v3/YOUR_KEY';
            if (!address) {
                console.log('Usage: node accountManager.js balance <address> [rpcUrl]');
                process.exit(1);
            }
            getBalance(address, rpcUrl);
            break;
            
        default:
            console.log('Available commands:');
            console.log('  create <username> <password>');
            console.log('  balance <address> [rpcUrl]');
    }
}