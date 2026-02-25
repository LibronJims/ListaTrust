const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

class BlockchainService {
    constructor() {
        this.provider = null;
        this.masterWallet = null;
        this.contractJson = null;
        this.pool = null;
        this.initialized = false;
        
        this.init();
    }

    init() {
        try {
            // Database connection
            this.pool = mysql.createPool({
                host: process.env.DB_HOST || 'localhost',
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || '',
                database: process.env.DB_NAME || 'listatrust_db',
                waitForConnections: true,
                connectionLimit: 10
            });

            // Blockchain connection
            if (!process.env.BLOCKCHAIN_RPC_URL) {
                console.warn('⚠️ BLOCKCHAIN_RPC_URL not set');
                return;
            }

            this.provider = new ethers.providers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);

            // Master wallet (Account 0 from Ganache)
            if (process.env.MASTER_PRIVATE_KEY) {
                this.masterWallet = new ethers.Wallet(process.env.MASTER_PRIVATE_KEY, this.provider);
                console.log('✅ Master wallet loaded:', this.masterWallet.address);
            } else {
                console.warn('⚠️ MASTER_PRIVATE_KEY not set');
            }

            // Load contract JSON with absolute path
            try {
                // Get the absolute path to the contracts folder
                const backendPath = __dirname; // This is /backend
                const projectPath = path.resolve(backendPath, '..'); // Go up to project root
                const contractPath = path.join(projectPath, 'contracts', 'ListaTrust.json');
                
                console.log('📁 Looking for contract at:', contractPath);
                
                if (!fs.existsSync(contractPath)) {
                    throw new Error(`Contract file not found at ${contractPath}`);
                }
                
                const fileContent = fs.readFileSync(contractPath, 'utf8');
                this.contractJson = JSON.parse(fileContent);
                
                if (!this.contractJson.abi) {
                    throw new Error('Contract JSON missing "abi" field');
                }
                if (!this.contractJson.bytecode) {
                    throw new Error('Contract JSON missing "bytecode" field');
                }
                
                console.log('✅ Contract JSON loaded successfully');
                console.log('📄 ABI entries:', this.contractJson.abi.length);
                console.log('🔧 Bytecode length:', this.contractJson.bytecode.length);
                
            } catch (e) {
                console.error('❌ Failed to load contract JSON:', e.message);
                console.error('Current working directory:', process.cwd());
                console.error('__dirname:', __dirname);
                this.contractJson = null;
                process.exit(1); // Exit since we can't continue without contract
            }

            this.initialized = true;
            console.log('✅ Blockchain service initialized');
            console.log('📡 Connected to:', process.env.BLOCKCHAIN_RPC_URL);

        } catch (error) {
            console.error('❌ Blockchain service init error:', error.message);
            process.exit(1);
        }
    }

    // Get contract for specific store owner
    async getContractForStoreOwner(storeOwnerAddress) {
        if (!this.initialized) {
            throw new Error('Blockchain service not initialized');
        }

        if (!this.contractJson || !this.contractJson.abi) {
            throw new Error('Contract ABI not loaded');
        }

        try {
            // Get store owner's contract address from database using JOIN with users table
            const [stores] = await this.pool.execute(
                `SELECT s.contract_address, s.id as store_id, u.id as user_id
                 FROM stores s 
                 JOIN users u ON s.owner_id = u.id 
                 WHERE u.wallet_address = ?`,
                [storeOwnerAddress]
            );

            console.log('Contract lookup for address:', storeOwnerAddress);
            console.log('Found stores:', stores);

            if (stores.length === 0) {
                // Try direct lookup in stores table as fallback
                const [storesDirect] = await this.pool.execute(
                    `SELECT s.contract_address, s.id as store_id
                     FROM stores s
                     WHERE s.wallet_address = ?`,
                    [storeOwnerAddress]
                );
                
                console.log('Direct store lookup:', storesDirect);
                
                if (storesDirect.length > 0 && storesDirect[0].contract_address) {
                    return new ethers.Contract(
                        storesDirect[0].contract_address,
                        this.contractJson.abi,
                        this.masterWallet
                    );
                }
                
                throw new Error(`No contract deployed for store owner ${storeOwnerAddress}`);
            }

            if (!stores[0].contract_address) {
                throw new Error(`Contract address is null for store owner ${storeOwnerAddress}`);
            }

            console.log(`✅ Found contract at: ${stores[0].contract_address} for owner ${storeOwnerAddress}`);

            // Create contract instance
            return new ethers.Contract(
                stores[0].contract_address,
                this.contractJson.abi,
                this.masterWallet
            );
        } catch (error) {
            console.error('Error in getContractForStoreOwner:', error);
            throw error;
        }
    }

    // Deploy new contract for a store owner
    async deployContractForStoreOwner(ownerId, ownerAddress, storeName) {
        if (!this.initialized || !this.masterWallet) {
            throw new Error('Blockchain service not properly initialized');
        }

        if (!this.contractJson) {
            throw new Error('Contract JSON not loaded');
        }

        try {
            console.log(`🚀 Deploying contract for ${storeName} (${ownerAddress})...`);
            
            const factory = new ethers.ContractFactory(
                this.contractJson.abi,
                this.contractJson.bytecode,
                this.masterWallet
            );
            
            const contract = await factory.deploy();
            await contract.deployed();
            
            console.log(`✅ Contract deployed at: ${contract.address}`);
            
            // Save to database
            await this.pool.execute(
                'UPDATE stores SET contract_address = ?, wallet_address = ? WHERE owner_id = ?',
                [contract.address, ownerAddress, ownerId]
            );
            
            return contract.address;
        } catch (error) {
            console.error('Error deploying contract:', error);
            throw error;
        }
    }

    // Add utang
    async addUtang(storeOwnerAddress, debtorName, amount, items) {
        try {
            const contract = await this.getContractForStoreOwner(storeOwnerAddress);
            
            console.log(`➕ Adding utang for debtor "${debtorName}" using contract ${contract.address}`);
            const tx = await contract.addUtang(debtorName, amount, items);
            console.log('⏳ Transaction sent:', tx.hash);
            
            const receipt = await tx.wait();
            console.log('✅ Transaction confirmed in block:', receipt.blockNumber);
            
            return receipt;
        } catch (error) {
            console.error('Blockchain addUtang error:', error);
            throw error;
        }
    }

    // Mark utang as paid
    async markAsPaid(storeOwnerAddress, utangId) {
        try {
            const contract = await this.getContractForStoreOwner(storeOwnerAddress);
            
            console.log(`💰 Marking utang ${utangId} as paid`);
            const tx = await contract.markAsPaid(utangId);
            console.log('⏳ Transaction sent:', tx.hash);
            
            const receipt = await tx.wait();
            console.log('✅ Transaction confirmed in block:', receipt.blockNumber);
            
            return receipt;
        } catch (error) {
            console.error('Blockchain markAsPaid error:', error);
            throw error;
        }
    }

    // Get store owner's utang
    async getMyUtang(storeOwnerAddress, offset = 0, limit = 50) {
        try {
            const contract = await this.getContractForStoreOwner(storeOwnerAddress);
            
            console.log(`📋 Fetching utang for ${storeOwnerAddress}`);
            const utangList = await contract.getMyUtang(offset, limit);
            
            return utangList;
        } catch (error) {
            console.error('Blockchain getMyUtang error:', error);
            throw error;
        }
    }

    // Get all contracts for admin view
    async getAllContracts() {
        const [stores] = await this.pool.execute(
            `SELECT s.contract_address, s.wallet_address, u.username, u.email, u.id as user_id
             FROM stores s 
             JOIN users u ON s.owner_id = u.id 
             WHERE s.contract_address IS NOT NULL`
        );
        return stores;
    }

    // Debug function to check database state
    async debugCheckUser(storeOwnerAddress) {
        try {
            const [users] = await this.pool.execute(
                'SELECT id, username, wallet_address FROM users WHERE wallet_address = ?',
                [storeOwnerAddress]
            );
            console.log('Users found:', users);

            if (users.length > 0) {
                const [stores] = await this.pool.execute(
                    'SELECT * FROM stores WHERE owner_id = ?',
                    [users[0].id]
                );
                console.log('Stores found:', stores);
            }

            return { users, stores: users.length > 0 ? await this.pool.execute('SELECT * FROM stores WHERE owner_id = ?', [users[0].id]) : [] };
        } catch (error) {
            console.error('Debug error:', error);
            return { error: error.message };
        }
    }
}

module.exports = new BlockchainService();