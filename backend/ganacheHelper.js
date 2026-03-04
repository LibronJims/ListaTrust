// ganacheHelper.js - Automatically get accounts from Ganache
const { ethers } = require('ethers');

class GanacheHelper {
    constructor() {
        this.provider = null;
        this.accounts = [];
        this.initialized = false;
    }

    async init() {
        try {
            if (!process.env.BLOCKCHAIN_RPC_URL) {
                console.error('❌ BLOCKCHAIN_RPC_URL not set in .env');
                return false;
            }

            this.provider = new ethers.providers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
            
            // Test connection
            await this.provider.getNetwork();
            
            // Get all accounts from Ganache
            this.accounts = await this.provider.listAccounts();
            
            if (this.accounts.length === 0) {
                console.error('❌ No accounts found in Ganache. Make sure Ganache is running.');
                return false;
            }

            console.log(`✅ Connected to Ganache. Found ${this.accounts.length} accounts`);
            console.log(`📋 Account 0: ${this.accounts[0]} (MASTER - deploys contracts)`);
            console.log(`📋 Account 1: ${this.accounts[1]} (DEFAULT STORE OWNER)`);
            
            this.initialized = true;
            return true;

        } catch (error) {
            console.error('❌ Failed to connect to Ganache:', error.message);
            console.error('   Make sure Ganache is running at', process.env.BLOCKCHAIN_RPC_URL);
            return false;
        }
    }

    // Get next available account for new user
    async getNextAvailableAccount() {
        if (!this.initialized) {
            await this.init();
        }

        // Get accounts already used from database
        const mysql = require('mysql2/promise');
        const pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'listatrust_db',
        });

        const [usedAccounts] = await pool.execute(
            'SELECT wallet_address FROM users WHERE wallet_address IS NOT NULL'
        );

        const usedSet = new Set(usedAccounts.map(u => u.wallet_address));

        // Find first unused account (skip account 0 - that's master)
        for (let i = 1; i < this.accounts.length; i++) {
            if (!usedSet.has(this.accounts[i])) {
                console.log(`✅ Assigning new account ${this.accounts[i]} to user`);
                return this.accounts[i];
            }
        }

        // If all accounts are used, create a new one? But Ganache has fixed accounts
        // Better to reuse account 1 for demo
        console.warn('⚠️ No unused accounts. Using account 1 (for demo only)');
        return this.accounts[1];
    }

    // Get master wallet (account 0)
    getMasterWallet() {
        if (!this.initialized) return null;
        // We need private key for master - must be in .env
        // This is a limitation - we still need MASTER_PRIVATE_KEY
        return null;
    }
}

module.exports = new GanacheHelper();