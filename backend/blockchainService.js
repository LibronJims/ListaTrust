const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const ganacheHelper = require('./ganacheHelper');

class BlockchainService {
    constructor() {
        this.provider = null;
        this.masterWallet = null;
        this.contractJson = null;
        this.pool = null;
        this.initialized = false;
        
        // Don't auto-init - wait for explicit call
    }

    async init() {
        if (this.initialized) return true;

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
                throw new Error('BLOCKCHAIN_RPC_URL not set in .env');
            }

            this.provider = new ethers.providers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);

            // Test connection
            await this.provider.getNetwork();
            console.log('✅ Connected to Ganache at', process.env.BLOCKCHAIN_RPC_URL);

            // Master wallet (Account 0 from Ganache) - REQUIRED
            if (!process.env.MASTER_PRIVATE_KEY) {
                throw new Error('MASTER_PRIVATE_KEY not set in .env');
            }

            this.masterWallet = new ethers.Wallet(process.env.MASTER_PRIVATE_KEY, this.provider);
            console.log('✅ Master wallet loaded:', this.masterWallet.address);

            // Load contract JSON
            const backendPath = __dirname;
            const projectPath = path.resolve(backendPath, '..');
            const contractPath = path.join(projectPath, 'contracts', 'ListaTrust.json');
            
            if (!fs.existsSync(contractPath)) {
                throw new Error(`Contract file not found at ${contractPath}`);
            }
            
            const fileContent = fs.readFileSync(contractPath, 'utf8');
            this.contractJson = JSON.parse(fileContent);
            
            if (!this.contractJson.abi || !this.contractJson.bytecode) {
                throw new Error('Contract JSON missing ABI or bytecode');
            }
            
            console.log('✅ Contract JSON loaded');

            // Initialize ganache helper
            await ganacheHelper.init();

            this.initialized = true;
            return true;

        } catch (error) {
            console.error('❌ Blockchain service init error:', error.message);
            console.error('   Make sure:');
            console.error('   1. Ganache is running at', process.env.BLOCKCHAIN_RPC_URL);
            console.error('   2. MASTER_PRIVATE_KEY is correct in .env');
            console.error('   3. Contract JSON exists at correct path');
            return false;
        }
    }

    // FIXED: Get contract with better error handling
    async getContractForStoreOwner(storeOwnerAddress) {
        if (!this.initialized) {
            await this.init();
        }

        try {
            // First check database
            const [stores] = await this.pool.execute(
                `SELECT s.contract_address 
                 FROM stores s 
                 JOIN users u ON s.owner_id = u.id 
                 WHERE u.wallet_address = ?`,
                [storeOwnerAddress]
            );

            if (stores.length === 0 || !stores[0].contract_address) {
                throw new Error(`No contract deployed for ${storeOwnerAddress}`);
            }

            return new ethers.Contract(
                stores[0].contract_address,
                this.contractJson.abi,
                this.masterWallet
            );

        } catch (error) {
            console.error('Error getting contract:', error);
            throw error;
        }
    }

    // FIXED: Deploy contract with better error handling and gas optimization
    async deployContractForStoreOwner(ownerId, ownerAddress, storeName) {
        try {
            if (!this.initialized) {
                await this.init();
            }

            if (!this.masterWallet) {
                throw new Error('Master wallet not initialized');
            }

            console.log(`\n🚀 Deploying contract for ${storeName} (${ownerAddress})...`);
            
            const factory = new ethers.ContractFactory(
                this.contractJson.abi,
                this.contractJson.bytecode,
                this.masterWallet
            );
            
            // Get current gas price
            const feeData = await this.provider.getFeeData();
            
            // Deploy with optimized gas
            const contract = await factory.deploy({
                gasPrice: feeData.gasPrice,
                gasLimit: 3000000 // Explicit gas limit
            });
            
            console.log('⏳ Waiting for deployment confirmation...');
            await contract.deployed();
            
            console.log(`✅ Contract deployed at: ${contract.address}`);

            // Save to database
            const [result] = await this.pool.execute(
                'UPDATE stores SET contract_address = ?, wallet_address = ? WHERE owner_id = ?',
                [contract.address, ownerAddress, ownerId]
            );

            if (result.affectedRows === 0) {
                // Try insert if update fails
                await this.pool.execute(
                    'INSERT INTO stores (owner_id, contract_address, wallet_address, store_name, is_approved) VALUES (?, ?, ?, ?, ?)',
                    [ownerId, contract.address, ownerAddress, storeName, true]
                );
            }

            console.log(`✅ Contract address saved to database`);
            return contract.address;

        } catch (error) {
            console.error('❌ Deployment failed:', error);
            
            // Log detailed error
            if (error.error) {
                console.error('   Reason:', error.error.reason || error.error.message);
            }
            
            throw new Error(`Contract deployment failed: ${error.message}`);
        }
    }

    // FIXED: Add utang with better error handling and multiple items support
    async addUtang(storeOwnerAddress, debtorName, amount, items) {
        try {
            if (!this.initialized) {
                await this.init();
            }

            const contract = await this.getContractForStoreOwner(storeOwnerAddress);
            
            // Handle multiple items
            const itemsString = Array.isArray(items) ? items.join('|') : items;
            
            console.log(`\n➕ Adding utang for "${debtorName}"...`);
            console.log(`   Amount: ${amount}`);
            console.log(`   Items: ${itemsString}`);
            console.log(`   Contract: ${contract.address}`);

            // Get gas price
            const feeData = await this.provider.getFeeData();
            
            // Send transaction
            const tx = await contract.addUtang(debtorName, amount, itemsString, {
                gasPrice: feeData.gasPrice,
                gasLimit: 500000
            });
            
            console.log(`⏳ Transaction sent: ${tx.hash}`);
            
            // Wait for confirmation
            const receipt = await tx.wait();
            console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
            console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
            
            return receipt;

        } catch (error) {
            console.error('❌ Blockchain addUtang error:', error);
            
            // Provide helpful error message
            if (error.message.includes('No contract deployed')) {
                throw new Error('Contract not deployed for this store owner. Please contact admin.');
            }
            if (error.message.includes('nonce')) {
                throw new Error('Transaction nonce error. Try again.');
            }
            throw error;
        }
    }

    // Mark utang as paid
    async markAsPaid(storeOwnerAddress, utangId) {
        try {
            if (!this.initialized) {
                await this.init();
            }

            const contract = await this.getContractForStoreOwner(storeOwnerAddress);
            
            console.log(`\n💰 Marking utang ${utangId} as paid...`);

            const feeData = await this.provider.getFeeData();
            
            const tx = await contract.markAsPaid(utangId, {
                gasPrice: feeData.gasPrice,
                gasLimit: 300000
            });
            
            console.log(`⏳ Transaction sent: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
            console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
            
            return receipt;

        } catch (error) {
            console.error('❌ markAsPaid error:', error);
            throw error;
        }
    }

// Get store owner's utang - FIXED for your contract
async getMyUtang(storeOwnerAddress, offset = 0, limit = 50) {
    try {
        if (!this.initialized) {
            await this.init();
        }

        console.log(`\n📋 Fetching utang for ${storeOwnerAddress}...`);
        
        const contract = await this.getContractForStoreOwner(storeOwnerAddress);
        console.log(`✅ Got contract at: ${contract.address}`);

        // Your contract has BOTH versions, so we need to call correctly
        let utangList = [];
        
        try {
            // Try with parameters first (your optimized version)
            console.log(`Calling getMyUtang(${offset}, ${limit})...`);
            utangList = await contract['getMyUtang(uint256,uint256)'](offset, limit);
        } catch (e) {
            console.log('Parameter version failed:', e.message);
            
            try {
                // Fall back to no-parameter version
                console.log('Falling back to getMyUtang()...');
                utangList = await contract['getMyUtang()']();
            } catch (e2) {
                console.log('Both versions failed:', e2.message);
                return [];
            }
        }

        console.log(`✅ Found ${utangList.length} records`);
        
        // Log first record for debugging
        if (utangList.length > 0) {
            console.log('Sample record:', {
                id: utangList[0].id.toString(),
                debtorName: utangList[0].debtorName,
                amount: utangList[0].amount.toString(),
                paid: utangList[0].paid
            });
        }
        
        return utangList;

    } catch (error) {
        console.error('❌ getMyUtang error:', error);
        return [];
    }
}

    // Get all contracts for admin
    async getAllContracts() {
        if (!this.initialized) {
            await this.init();
        }

        const [stores] = await this.pool.execute(
            `SELECT s.contract_address, s.wallet_address, u.username, u.email, u.id as user_id
             FROM stores s 
             JOIN users u ON s.owner_id = u.id 
             WHERE s.contract_address IS NOT NULL`
        );
        return stores;
    }

    // FIXED: Check if contract exists
    async hasContract(ownerId) {
        if (!this.initialized) {
            await this.init();
        }

        const [stores] = await this.pool.execute(
            'SELECT contract_address FROM stores WHERE owner_id = ?',
            [ownerId]
        );

        return stores.length > 0 && stores[0].contract_address !== null;
    }

    // FIXED: Get wallet balance
    async getBalance(address) {
        if (!this.initialized) {
            await this.init();
        }

        const balance = await this.provider.getBalance(address);
        return ethers.utils.formatEther(balance);
    }

    // FIXED: Debug function
    async debugCheck(storeOwnerAddress) {
        if (!this.initialized) {
            await this.init();
        }

        console.log('\n🔍 DEBUG INFO:');
        console.log('================');
        
        // Check provider
        try {
            const network = await this.provider.getNetwork();
            console.log('Network:', network.name, 'chainId:', network.chainId);
        } catch (e) {
            console.log('Provider error:', e.message);
        }

        // Check accounts
        try {
            const accounts = await this.provider.listAccounts();
            console.log('Ganache accounts:', accounts.length);
            console.log('Account 0:', accounts[0]);
            console.log('Account 1:', accounts[1]);
        } catch (e) {
            console.log('Account error:', e.message);
        }

        // Check database
        const [users] = await this.pool.execute(
            'SELECT id, username, wallet_address FROM users WHERE wallet_address = ?',
            [storeOwnerAddress]
        );
        console.log('User in DB:', users);

        if (users.length > 0) {
            const [stores] = await this.pool.execute(
                'SELECT * FROM stores WHERE owner_id = ?',
                [users[0].id]
            );
            console.log('Store in DB:', stores);
        }

        return { users, provider: 'ok' };
    }
}

module.exports = new BlockchainService();