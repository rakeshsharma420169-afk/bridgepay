
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol";

contract BridgePay is AccessControl, ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;

    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant MULTISIG_ROLE = keccak256("MULTISIG_ROLE");
    
    bytes32 public constant OFFLINE_TX_TYPEHASH = keccak256(
        "OfflineTransaction(address from,address to,uint256 amount,uint256 nonce,uint256 expiry,bytes32 clientTxId)"
    );

    enum TxStatus { PENDING, FINALIZED, REJECTED, AUTO_FINALIZED }

    struct Transaction {
        address from;
        address to;
        uint256 amount;
        uint256 nonce;
        uint256 expiry;
        bytes32 clientTxId;
        uint256 submittedAt;
        uint256 finalizedAt;
        TxStatus status;
        address relayer;
    }

    mapping(bytes32 => Transaction) public transactions;
    mapping(address => uint256) public balances;
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public clientTxIdUsed;
    
    uint256 public constant DISPUTE_WINDOW = 7 days;
    uint256 public constant FORCE_FINALIZE_DELAY = 14 days;
    uint256 public constant MULTISIG_THRESHOLD = 3;
    
    mapping(bytes32 => address[]) public forceFinalizeSigs;
    
    event OfflineTxSubmitted(bytes32 indexed txHash, bytes32 indexed clientTxId, address indexed from, address to, uint256 amount, uint256 submittedAt);
    event TxFinalized(bytes32 indexed txHash, bytes32 indexed clientTxId, uint256 finalizedAt);
    event TxAutoFinalized(bytes32 indexed txHash, bytes32 indexed clientTxId, uint256 finalizedAt, address[] signers);
    event TxDisputed(bytes32 indexed txHash, bytes32 indexed clientTxId, address disputer, bytes evidence);
    event TxRejected(bytes32 indexed txHash, bytes32 indexed clientTxId, string reason);
    event BalanceDeposited(address indexed user, uint256 amount);
    event BalanceWithdrawn(address indexed user, uint256 amount);

    constructor() EIP712("BridgePay", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE, msg.sender);
        _grantRole(MULTISIG_ROLE, msg.sender);
    }

    function deposit() external payable {
        require(msg.value > 0, "Amount must be > 0");
        balances[msg.sender] += msg.value;
        emit BalanceDeposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        balances[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
        emit BalanceWithdrawn(msg.sender, amount);
    }

    function submitOfflineTx(
        address from,
        address to,
        uint256 amount,
        bytes memory signature,
        uint256 nonce,
        uint256 expiry,
        bytes32 clientTxId
    ) external onlyRole(RELAYER_ROLE) returns (bytes32 txHash) {
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");
        require(expiry > block.timestamp, "Transaction expired");
        require(!clientTxIdUsed[clientTxId], "ClientTxId already used");
        require(nonces[from] == nonce, "Invalid nonce");
        
        bytes32 structHash = keccak256(abi.encode(OFFLINE_TX_TYPEHASH, from, to, amount, nonce, expiry, clientTxId));
        bytes32 digest = _hashTypedDataV4(structHash);
        
        address recoveredSigner = digest.recover(signature);
        require(recoveredSigner == from, "Invalid signature");
        
        txHash = keccak256(abi.encodePacked(from, to, amount, nonce, expiry, clientTxId));
        require(transactions[txHash].from == address(0), "Transaction already exists");
        
        transactions[txHash] = Transaction({
            from: from,
            to: to,
            amount: amount,
            nonce: nonce,
            expiry: expiry,
            clientTxId: clientTxId,
            submittedAt: block.timestamp,
            finalizedAt: 0,
            status: TxStatus.PENDING,
            relayer: msg.sender
        });
        
        clientTxIdUsed[clientTxId] = true;
        emit OfflineTxSubmitted(txHash, clientTxId, from, to, amount, block.timestamp);
        return txHash;
    }

    function finalizeTx(bytes32 txHash) external onlyRole(RELAYER_ROLE) nonReentrant {
        Transaction storage tx = transactions[txHash];
        require(tx.from != address(0), "Transaction not found");
        require(tx.status == TxStatus.PENDING, "Transaction not pending");
        require(block.timestamp <= tx.expiry, "Transaction expired");
        require(block.timestamp >= tx.submittedAt + DISPUTE_WINDOW, "Dispute window active");
        require(balances[tx.from] >= tx.amount, "Insufficient balance");
        
        balances[tx.from] -= tx.amount;
        balances[tx.to] += tx.amount;
        
        tx.status = TxStatus.FINALIZED;
        tx.finalizedAt = block.timestamp;
        nonces[tx.from]++;
        
        emit TxFinalized(txHash, tx.clientTxId, block.timestamp);
    }

    function forceFinalize(bytes32 txHash) external onlyRole(MULTISIG_ROLE) nonReentrant {
        Transaction storage tx = transactions[txHash];
        require(tx.from != address(0), "Transaction not found");
        require(tx.status == TxStatus.PENDING, "Transaction not pending");
        require(block.timestamp >= tx.submittedAt + FORCE_FINALIZE_DELAY, "14-day delay not elapsed");
        
        address[] storage signers = forceFinalizeSigs[txHash];
        for (uint i = 0; i < signers.length; i++) {
            require(signers[i] != msg.sender, "Already signed");
        }
        signers.push(msg.sender);
        
        if (signers.length >= MULTISIG_THRESHOLD) {
            require(balances[tx.from] >= tx.amount, "Insufficient balance");
            balances[tx.from] -= tx.amount;
            balances[tx.to] += tx.amount;
            tx.status = TxStatus.AUTO_FINALIZED;
            tx.finalizedAt = block.timestamp;
            nonces[tx.from]++;
            emit TxAutoFinalized(txHash, tx.clientTxId, block.timestamp, signers);
        }
    }

    function disputeTx(bytes32 txHash, bytes calldata evidence) external {
        Transaction storage tx = transactions[txHash];
        require(tx.from != address(0), "Transaction not found");
        require(tx.status == TxStatus.PENDING, "Transaction not pending");
        require(block.timestamp < tx.submittedAt + DISPUTE_WINDOW, "Dispute window closed");
        require(msg.sender == tx.from || msg.sender == tx.to, "Only involved parties can dispute");
        
        tx.status = TxStatus.REJECTED;
        emit TxDisputed(txHash, tx.clientTxId, msg.sender, evidence);
        emit TxRejected(txHash, tx.clientTxId, "Disputed by party");
    }

    function getTransaction(bytes32 txHash) external view returns (Transaction memory) {
        return transactions[txHash];
    }

    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }

    function getNonce(address user) external view returns (uint256) {
        return nonces[user];
    }
}