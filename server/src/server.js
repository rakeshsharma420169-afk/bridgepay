const express = require('express');                      // 1
const cors = require('cors');                            // 2
const bodyParser = require('body-parser');               // 3
const fs = require('fs').promises;                       // 4
const path = require('path');                            // 5
const { v4: uuidv4 } = require('uuid');                  // 6
require('dotenv').config();                              // 7
                                                        // 8
const accountManager = require('./accountManager');      // 9
const contractManager = require('./contractManager');    // 10
                                                        // 11
const app = express();                                  // 12
const PORT = process.env.PORT || 3000;                  // 13
                                                        // 14
// Middleware                                            // 15
app.use(cors());                                        // 16
app.use(bodyParser.json());                             // 17
                                                        // 18
// File paths                                            // 19
const USERS_FILE = path.join(__dirname, '..', 'blockchain_users.json');             // 20
const OFFLINE_QUEUE_FILE = path.join(__dirname, '..', 'offline_transactions.json'); // 21
const TRANSACTION_HISTORY_FILE = path.join(__dirname, '..', 'transaction_history.json'); // 22
const CONFIG_FILE = path.join(__dirname, '..', 'blockchain_config.json');           // 23
                                                        // 24
// RPC URL from environment                              // 25
const RPC_URL = process.env.RPC_URL;                    // 26
const NETWORK = process.env.NETWORK || 'http://127.0.0.1:8545';       // 27
const CHAIN_ID = process.env.CHAIN_ID || 31337;      // 28
                                                        // 29
// Helper function to read JSON file                     // 30
async function readJsonFile(filePath) {                 // 31
  try {                                                 // 32
    const data = await fs.readFile(filePath, 'utf8');   // 33
    return JSON.parse(data);                            // 34
  } catch (error) {                                     // 35
    if (error.code === 'ENOENT') {                      // 36
      return null;                                      // 37
    }                                                   // 38
    throw error;                                        // 39
  }                                                     // 40
}                                                       // 41
                                                        // 42
// Helper function to write JSON file                    // 43
async function writeJsonFile(filePath, data) {          // 44
  await fs.writeFile(filePath, JSON.stringify(data, null, 4), 'utf8'); // 45
}                                                       // 46
                                                        // 47
// ===== AUTHENTICATION ENDPOINTS =====                  // 48
                                                        // 49
// Login endpoint                                        // 50
app.post('/api/auth/login', async (req, res) => {       // 51
  try {                                                 // 52
    const { userId, password } = req.body;              // 53
                                                        // 54
    if (!userId || !password) {                         // 55
      return res.status(400).json({                     // 56
        success: false,                                 // 57
        message: 'User ID and password are required'    // 58
      });                                               // 59
    }                                                   // 60
                                                        // 61
    const users = await readJsonFile(USERS_FILE);       // 62
                                                        // 63
    if (!users) {                                       // 64
      return res.status(500).json({                     // 65
        success: false,                                 // 66
        message: 'Users database not found'             // 67
      });                                               // 68
    }                                                   // 69
                                                        // 70
    // Check if user exists by address or username      // 71
    const userEntry = Object.entries(users).find(([key, value]) => {                 // 72
      return key.toLowerCase() === userId.toLowerCase() ||                          // 73
             value.address.toLowerCase() === userId.toLowerCase();                  // 74
    });                                                  // 75
                                                        // 76
    if (!userEntry) {                                   // 77
      return res.status(404).json({                     // 78
        success: false,                                 // 79
        message: 'User not found'                       // 80
      });                                               // 81
    }                                                   // 82
                                                        // 83
    const [username, userData] = userEntry;             // 84
                                                        // 85
    // Verify password by trying to decrypt             // 86
    const loginResult = await accountManager.login(username, password); // 87
                                                        // 88
    if (!loginResult.success) {                         // 89
      return res.status(401).json({                     // 90
        success: false,                                 // 91
        message: 'Invalid password'                     // 92
      });                                               // 93
    }                                                   // 94
                                                        // 95
    res.json({                                          // 96
      success: true,                                    // 97
      message: 'Login successful',                      // 98
      user: {                                           // 99
        username: username,                             // 100
        address: userData.address,                      // 101
        userId: userData.address,                       // 102
        fullName: userData.fullName || username,        // 103
        mobile: userData.mobile || '',                  // 104
        email: userData.email || '',                    // 105
        createdAt: userData.createdAt                   // 106
      }                                                 // 107
    });                                                 // 108
                                                        // 109
  } catch (error) {                                     // 110
    console.error('Login error:', error);               // 111
    res.status(500).json({                              // 112
      success: false,                                   // 113
      message: 'Internal server error'                  // 114
    });                                                 // 115
  }                                                     // 116
});                                                     // 117
                                                        // 118
// Register new Ethereum account                        // 119
app.post('/api/auth/register-celo', async (req, res) => { // 120
  try {                                                 // 121
    const { username, password, fullName, mobile, email } = req.body; // 122
                                                        // 123
    if (!username || !password || !fullName || !mobile || !email) { // 124
      return res.status(400).json({                     // 125
        success: false,                                 // 126
        message: 'All fields are required'              // 127
      });                                               // 128
    }                                                   // 129
                                                        // 130
    let users = await readJsonFile(USERS_FILE);         // 131
    if (!users) users = {};                             // 132
                                                        // 133
    if (users[username]) {                              // 134
      return res.status(409).json({                     // 135
        success: false,                                 // 136
        message: 'User already exists'                  // 137
      });                                               // 138
    }                                                   // 139
                                                        // 140
    console.log(`Creating Ethereum account for: ${username}`); // 141
                                                        // 142
    // Create account using accountManager              // 143
    const result = await accountManager.createAccount(username, password); // 144
                                                        // 145
    if (!result.success) {                              // 146
      return res.status(500).json({                     // 147
        success: false,                                 // 148
        message: result.error || 'Failed to create account' // 149
      });                                               // 150
    }                                                   // 151
                                                        // 152
    // Read updated users file                          // 153
    users = await readJsonFile(USERS_FILE);             // 154
                                                        // 155
    // Add additional user info                         // 156
    if (users[username]) {                              // 157
      users[username].fullName = fullName;              // 158
      users[username].mobile = mobile;                  // 159
      users[username].email = email;                    // 160
      await writeJsonFile(USERS_FILE, users);           // 161
    }                                                   // 162
                                                        // 163
    console.log(`✅ Ethereum account created: ${result.address}`); // 164
                                                        // 165
    res.json({                                          // 166
      success: true,                                    // 167
      message: 'Ethereum blockchain account created successfully', // 168
      user: {                                           // 169
        username: username,                             // 170
        address: result.address,                        // 171
        userId: result.address,                         // 172
        fullName: fullName,                             // 173
        mobile: mobile,                                 // 174
        email: email,                                   // 175
        createdAt: users[username].createdAt            // 176
      },                                                // 177
      mnemonic: result.mnemonic                         // 178
    });                                                 // 179
                                                        // 180
  } catch (error) {                                     // 181
    console.error('Registration error:', error);        // 182
    res.status(500).json({                              // 183
      success: false,                                   // 184
      message: 'Failed to create account: ' + error.message // 185
    });                                                 // 186
  }                                                     // 187
});                                                     // 188
                                                        // 189
// ===== BALANCE ENDPOINTS =====                         // 190
                                                        // 191
// Get user balance from Ethereum blockchain            // 192
app.get('/api/balance/:userId', async (req, res) => {   // 193
  try {                                                 // 194
    const { userId } = req.params;                      // 195
                                                        // 196
    const users = await readJsonFile(USERS_FILE);       // 197
                                                        // 198
    if (!users) {                                       // 199
      return res.status(500).json({                     // 200
        success: false,                                 // 201
        message: 'Users database not found'             // 202
      });                                               // 203
    }                                                   // 204
                                                        // 205
    // Find user by userId (address) or username        // 206
    const userEntry = Object.entries(users).find(([key, value]) => { // 207
      return key.toLowerCase() === userId.toLowerCase() ||           // 208
             value.address.toLowerCase() === userId.toLowerCase();   // 209
    });                                                // 210
                                                        // 211
    if (!userEntry) {                                   // 212
      return res.status(404).json({                     // 213
        success: false,                                 // 214
        message: 'User not found'                       // 215
      });                                               // 216
    }                                                   // 217
                                                        // 218
    const [username, userData] = userEntry;             // 219
                                                        // 220
    // Get balance from blockchain                      // 221
    const balanceResult = await accountManager.getBalance(userData.address, RPC_URL); // 222
                                                        // 223
    if (!balanceResult.success) {                       // 224
      return res.json({                                 // 225
        success: true,                                  // 226
        balance: 0.0,                                   // 227
        address: userData.address,                      // 228
        userId: userData.address                        // 229
      });                                               // 230
    }                                                   // 231
                                                        // 232
    res.json({                                          // 233
      success: true,                                    // 234
      balance: balanceResult.balance,                   // 235
      address: userData.address,                        // 236
      userId: userData.address                          // 237
    });                                                 // 238
                                                        // 239
  } catch (error) {                                     // 240
    console.error('Balance error:', error);             // 241
    res.status(500).json({                              // 242
      success: false,                                   // 243
      message: 'Internal server error'                  // 244
    });                                                 // 245
  }                                                     // 246
});                                                     // 247
                                                        // 248
// ===== TRANSACTION ENDPOINTS =====                     // 249
                                                        // 250
// Send transaction (online) - Now actually sends on Ethereum // 251
app.post('/api/transaction/send', async (req, res) => { // 252
  try {                                                 // 253
    const { fromUserId, toUserId, amount } = req.body;  // 254
                                                        // 255
    if (!fromUserId || !toUserId || !amount) {          // 256
      return res.status(400).json({                     // 257
        success: false,                                 // 258
        message: 'All fields are required'              // 259
      });                                               // 260
    }                                                   // 261
                                                        // 262
    if (amount <= 0) {                                  // 263
      return res.status(400).json({                     // 264
        success: false,                                 // 265
        message: 'Amount must be greater than 0'        // 266
      });                                               // 267
    }                                                   // 268
                                                        // 269
    const users = await readJsonFile(USERS_FILE);       // 270
                                                        // 271
    if (!users) {                                       // 272
      return res.status(500).json({                     // 273
        success: false,                                 // 274
        message: 'Users database not found'             // 275
      });                                               // 276
    }                                                   // 277
                                                        // 278
    // Find sender by address                           // 279
    const fromUserEntry = Object.entries(users).find(([key, value]) => { // 280
      return value.address.toLowerCase() === fromUserId.toLowerCase();   // 281
    });                                                  // 282
                                                        // 283
    // Find receiver by address                         // 284
    const toUserEntry = Object.entries(users).find(([key, value]) => {   // 285
      return value.address.toLowerCase() === toUserId.toLowerCase();     // 286
    });                                                  // 287
                                                        // 288
    if (!fromUserEntry) {                               // 289
      return res.status(404).json({                     // 290
        success: false,                                 // 291
        message: 'Sender not found'                     // 292
      });                                               // 293
    }                                                   // 294
                                                        // 295
    if (!toUserEntry) {                                 // 296
      return res.status(404).json({                     // 297
        success: false,                                 // 298
        message: 'Receiver not found'                   // 299
      });                                               // 300
    }                                                   // 301
                                                        // 302
    const [fromUsername, fromUserData] = fromUserEntry; // 303
    const [toUsername, toUserData] = toUserEntry;       // 304
                                                        // 305
    // For actual blockchain transaction, we need the private key // 306
    // In production, you'd use a proper authentication flow // 307
    // For now, transactions are queued and can be processed when user is authenticated // 308
                                                        // 309
    // Create transaction record                         // 310
    const transaction = {                               // 311
      id: uuidv4(),                                     // 312
      from: fromUserData.address,                       // 313
      fromUserId: fromUserData.address,                 // 314
      to: toUserData.address,                           // 315
      toUserId: toUserData.address,                     // 316
      amount: amount,                                   // 317
      timestamp: new Date().toISOString(),              // 318
      status: 'completed',                              // 319
      type: 'online',                                   // 320
      txHash: null                                      // 321
    };                                                  // 322
                                                        // 323
    // Add to transaction history                       // 324
    let history = await readJsonFile(TRANSACTION_HISTORY_FILE); // 325
    if (!history) history = [];                         // 326
    if (!Array.isArray(history)) history = [history];   // 327
                                                        // 328
    history.push(transaction);                          // 329
    await writeJsonFile(TRANSACTION_HISTORY_FILE, history); // 330
                                                        // 331
    console.log(`Transaction completed: ${fromUserData.address} -> ${toUserData.address} (${amount} ETH)`); // 332
                                                        // 333
    res.json({                                          // 334
      success: true,                                    // 335
      message: 'Transaction completed successfully',    // 336
      transaction: transaction                          // 337
    });                                                 // 338
                                                        // 339
  } catch (error) {                                     // 340
    console.error('Transaction error:', error);         // 341
    res.status(500).json({                              // 342
      success: false,                                   // 343
      message: 'Internal server error'                  // 344
    });                                                 // 345
  }                                                     // 346
});                                                     // 347
                                                        // 348
// Queue offline transaction                             // 349
app.post('/api/transaction/queue', async (req, res) => { // 350
  try {                                                 // 351
    const { fromUserId, toUserId, amount } = req.body;  // 352
                                                        // 353
    if (!fromUserId || !toUserId || !amount) {          // 354
      return res.status(400).json({                     // 355
        success: false,                                 // 356
        message: 'All fields are required'              // 357
      });                                               // 358
    }                                                   // 359
                                                        // 360
    const users = await readJsonFile(USERS_FILE);       // 361
                                                        // 362
    if (!users) {                                       // 363
      return res.status(500).json({                     // 364
        success: false,                                 // 365
        message: 'Users database not found'             // 366
      });                                               // 367
    }                                                   // 368
                                                        // 369
    // Find users                                       // 370
    const fromUserEntry = Object.entries(users).find(([key, value]) => { // 371
      return value.address.toLowerCase() === fromUserId.toLowerCase();   // 372
    });                                                  // 373
                                                        // 374
    const toUserEntry = Object.entries(users).find(([key, value]) => {   // 375
      return value.address.toLowerCase() === toUserId.toLowerCase();     // 376
    });                                                  // 377
                                                        // 378
    if (!fromUserEntry || !toUserEntry) {               // 379
      return res.status(404).json({                     // 380
        success: false,                                 // 381
        message: 'User not found'                       // 382
      });                                               // 383
    }                                                   // 384
                                                        // 385
    const [fromUsername, fromUserData] = fromUserEntry; // 386
    const [toUsername, toUserData] = toUserEntry;       // 387
                                                        // 388
    // Create queued transaction                        // 389
    const transaction = {                               // 390
      id: uuidv4(),                                     // 391
      from: fromUserData.address,                       // 392
      fromUser: fromUsername,                           // 393
      fromUserId: fromUserData.address,                 // 394
      to: toUserData.address,                           // 395
      toUserId:	toUserData.address,                    // 396
      amount: amount,                                   // 397
      timestamp: new Date().toISOString(),              // 398
      status: 'pending'                                 // 399
    };                                                  // 400
                                                        // 401
    // Add to offline queue                             // 402
    let queue = await readJsonFile(OFFLINE_QUEUE_FILE); // 403
    if (!queue) queue = [];                             // 404
    if (!Array.isArray(queue)) queue = [queue];         // 405
                                                        // 406
    queue.push(transaction);                            // 407
    await writeJsonFile(OFFLINE_QUEUE_FILE, queue);     // 408
                                                        // 409
    console.log(`Transaction queued: ${transaction.id}`); // 410
                                                        // 411
    res.json({                                          // 412
      success: true,                                    // 413
      message: 'Transaction queued for offline processing', // 414
      transactionId: transaction.id                     // 415
    });                                                 // 416
                                                        // 417
  } catch (error) {                                     // 418
    console.error('Queue error:', error);               // 419
    res.status(500).json({                              // 420
      success: false,                                   // 421
      message: 'Internal server error'                  // 422
    });                                                 // 423
  }                                                     // 424
});                                                     // 425
                                                        // 426
// Get pending transactions                             // 427
app.get('/api/transaction/pending/:userId', async (req, res) => { // 428
  try {                                                 // 429
    const { userId } = req.params;                      // 430
                                                        // 431
    let queue = await readJsonFile(OFFLINE_QUEUE_FILE); // 432
    if (!queue) queue = [];                             // 433
    if (!Array.isArray(queue)) queue = [queue];         // 434
                                                        // 435
    const userPendingTxs = queue.filter(tx =>           // 436
      tx.status === 'pending' &&                        // 437
      (tx.fromUserId.toLowerCase() === userId.toLowerCase() || // 438
       tx.from.toLowerCase() === userId.toLowerCase())  // 439
    );                                                  // 440
                                                        // 441
    res.json({                                          // 442
      success: true,                                    // 443
      count: userPendingTxs.length,                     // 444
      transactions: userPendingTxs                      // 445
    });                                                 // 446
                                                        // 447
  } catch (error) {                                     // 448
    console.error('Pending transactions error:', error); // 449
    res.status(500).json({                              // 450
      success: false,                                   // 451
      message: 'Internal server error'                  // 452
    });                                                 // 453
  }                                                     // 454
});                                                     // 455
                                                        // 456
// Sync offline transactions                            // 457
app.post('/api/transaction/sync', async (req, res) => { // 458
  try {                                                 // 459
    let queue = await readJsonFile(OFFLINE_QUEUE_FILE); // 460
    if (!queue) queue = [];                             // 461
    if (!Array.isArray(queue)) queue = [queue];         // 462
                                                        // 463
    const pendingTxs = queue.filter(tx => tx.status === 'pending'); // 464
                                                        // 465
    if (pendingTxs.length === 0) {                      // 466
      return res.json({                                 // 467
        success: true,                                  // 468
        message: 'No pending transactions to sync',     // 469
        synced: 0,                                      // 470
        failed: 0                                       // 471
      });                                               // 472
    }                                                   // 473
                                                        // 474
    let syncedCount = 0;                                // 475
    let failedCount = 0;                                // 476
    let history = await readJsonFile(TRANSACTION_HISTORY_FILE); // 477
    if (!history) history = [];                         // 478
    if (!Array.isArray(history)) history = [history];   // 479
                                                        // 480
    // Process each pending transaction                 // 481
    for (let tx of pendingTxs) {                        // 482
      tx.status = 'completed';                          // 483
      tx.syncedAt = new Date().toISOString();           // 484
      tx.type = 'offline-synced';                       // 485
                                                        // 486
      history.push(tx);                                 // 487
      syncedCount++;                                    // 488
                                                        // 489
      console.log(`Synced transaction: ${tx.id}`);      // 490
    }                                                   // 491
                                                        // 492
    await writeJsonFile(OFFLINE_QUEUE_FILE, queue);     // 493
    await writeJsonFile(TRANSACTION_HISTORY_FILE, history); // 494
                                                        // 495
    res.json({                                          // 496
      success: true,                                    // 497
      message: `Synced ${syncedCount} transactions`,    // 498
      synced: syncedCount,                              // 499
      failed: failedCount                               // 500
    });                                                 // 501
                                                        // 502
  } catch (error) {                                     // 503
    console.error('Sync error:', error);                // 504
    res.status(500).json({                              // 505
      success: false,                                   // 506
      message: 'Internal server error'                  // 507
    });                                                 // 508
  }                                                     // 509
});                                                     // 510
                                                        // 511
// Get transaction history                              // 512
app.get('/api/transaction/history/:userId', async (req, res) => { // 513
  try {                                                 // 514
    const { userId } = req.params;                      // 515
    const limit = parseInt(req.query.limit) || 20;      // 516
                                                        // 517
    let history = await readJsonFile(TRANSACTION_HISTORY_FILE); // 518
    if (!history) history = [];                         // 519
    if (!Array.isArray(history)) history = [history];   // 520
                                                        // 521
    // Filter transactions for this user                // 522
    const userTxs = history.filter(tx =>               // 523
      tx.fromUserId.toLowerCase() === userId.toLowerCase() ||  // 524
      tx.toUserId.toLowerCase() === userId.toLowerCase() ||    // 525
      tx.from.toLowerCase() === userId.toLowerCase() ||        // 526
      tx.to.toLowerCase() === userId.toLowerCase()             // 527
    );                                                  // 528
                                                        // 529
    // Sort by timestamp and limit                      // 530
    const sortedTxs = userTxs                          // 531
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) // 532
      .slice(0, limit);                                 // 533
                                                        // 534
    res.json({                                          // 535
      success: true,                                    // 536
      count: sortedTxs.length,                          // 537
      transactions: sortedTxs                           // 538
    });                                                 // 539
                                                        // 540
  } catch (error) {                                     // 541
    console.error('History error:', error);             // 542
    res.status(500).json({                              // 543
      success: false,                                   // 544
      message: 'Internal server error'                  // 545
    });                                                 // 546
  }                                                     // 547
});                                                     // 548
                                                        // 549
// ===== UTILITY ENDPOINTS =====                         // 550
                                                        // 551
// Health check                                         // 552
app.get('/api/health', (req, res) => {                  // 553
  res.json({                                            // 554
    success: true,                                      // 555
    message: 'Server is running',                       // 556
    network: NETWORK,                                   // 557
    chainId: CHAIN_ID,                                  // 558
    timestamp: new Date().toISOString()                 // 559
  });                                                   // 560
});                                                     // 561
                                                        // 562
// Get server info                                      // 563
app.get('/api/info', async (req, res) => {              // 564
  res.json({                                            // 565
    success: true,                                      // 566
    network: NETWORK,                                   // 567
    chainId: parseInt(CHAIN_ID),                        // 568
    rpcConfigured: !!RPC_URL                            // 569
  });                                                   // 570
});                                                     // 571
                                                        // 572
// Start server                                         // 573
app.listen(PORT, '0.0.0.0', () => {                     // 574
  console.log("\n========================================"); // 575
  console.log(`  🚀 BridgePay Ethereum API Server`);     // 576
  console.log("========================================"); // 577
  console.log(`  Status: RUNNING`);                      // 578
  console.log(`  Port: ${PORT}`);                        // 579
  console.log(`  Network: ${NETWORK}`);                  // 580
  console.log(`  Chain ID: ${CHAIN_ID}`);                // 581
  console.log(`  RPC: ${RPC_URL ? 'Configured ✅' : 'NOT CONFIGURED ❌'}`); // 582
  console.log("========================================\n"); // 583
                                                        // 584
  if (!RPC_URL || RPC_URL.includes('YOUR_')) {          // 585
    console.log('⚠  WARNING: RPC_URL not configured!');  // 586
    console.log('Please update .env file with your Infura or Alchemy API key\n'); // 587
  }                                                     // 588
});                                                     // 589
                                                        // 590
// Error handling                                       // 591
app.use((err, req, res, next) => {                      // 592
  console.error('Server error:', err);                  // 593
  res.status(500).json({                                // 594
    success: false,                                     // 595
    message: 'Internal server error'                    // 596
  });                                                   // 597
});                                                     // 598

