require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const { validationResult } = require('express-validator');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

// Import local modules
const { apiLimiter, authLimiter } = require('./rateLimiter');
const { 
    registerValidation, loginValidation, otpValidation, debtorValidation 
} = require('./validator');
const { authenticateToken, authorize, validateSession } = require('./auth');
const { generateOTP, sendOTPEmail } = require('./emailService');
const blockchainService = require('./blockchainService');

const app = express();

// Create uploads folder if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// ============ FILE UPLOAD CONFIGURATION ============
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const hash = crypto.createHash('sha256')
            .update(file.originalname + Date.now() + crypto.randomBytes(16).toString('hex'))
            .digest('hex');
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, hash + ext);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedMimes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only images (JPG, PNG, GIF, WEBP) are allowed.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    limits: { 
        fileSize: 5 * 1024 * 1024,
        files: 1
    },
    fileFilter: fileFilter
});

// Multer error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files. Only one file allowed.' });
        }
    }
    if (error.message && error.message.includes('Invalid file type')) {
        return res.status(400).json({ error: error.message });
    }
    next(error);
});

// ============ MIDDLEWARE ============
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ 
    origin: ['http://127.0.0.1:3001', 'http://localhost:3001'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use('/uploads', express.static('uploads', {
    setHeaders: (res, path) => {
        res.set('Cross-Origin-Resource-Policy', 'cross-origin');
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Cache-Control', 'public, max-age=31536000');
    }
}));
app.use('/api/', apiLimiter);

// ============ DATABASE ============
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'listatrust_db',
    waitForConnections: true,
    connectionLimit: 10
});

// ============ SESSION CLEANUP JOB ============
setInterval(async () => {
    try {
        await pool.execute('DELETE FROM sessions WHERE expires_at < NOW()');
    } catch (error) {
        console.error('Session cleanup error:', error);
    }
}, 60 * 60 * 1000);

// ============ HELPER FUNCTIONS ============
const auditLog = async (userId, action, req) => {
    await pool.execute(
        'INSERT INTO audit_logs (user_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)',
        [userId, action, req.ip, req.headers['user-agent']]
    );
};

const saveOTP = async (userId, email, code, type) => {
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    await pool.execute(
        'INSERT INTO otp_codes (user_id, email, code, type, expires_at) VALUES (?, ?, ?, ?, ?)',
        [userId === 0 ? 0 : userId, email, code, type, expires]
    );
};

const verifyOTP = async (email, code, type) => {
    const [otps] = await pool.execute(
        'SELECT * FROM otp_codes WHERE email = ? AND code = ? AND type = ? AND used = FALSE AND expires_at > NOW()',
        [email, code, type]
    );
    if (otps.length > 0) {
        await pool.execute('UPDATE otp_codes SET used = TRUE WHERE id = ?', [otps[0].id]);
        return true;
    }
    return false;
};

const invalidateUserSessions = async (userId) => {
    await pool.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
};

// ============ AUTH ROUTES ============

// Register - Send OTP
app.post('/api/auth/register/send-otp', authLimiter, registerValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, username } = req.body;

    const [existing] = await pool.execute(
        'SELECT id FROM users WHERE email = ? OR username = ?',
        [email, username]
    );
    if (existing.length > 0) {
        return res.status(400).json({ error: 'Email or username already exists' });
    }

    const otp = generateOTP();
    await sendOTPEmail(email, otp, 'verification');
    await saveOTP(0, email, otp, 'VERIFY_EMAIL');

    res.json({ message: 'OTP sent to email', email });
});

// Verify OTP and complete registration
app.post('/api/auth/register/verify', authLimiter, otpValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, otp, username, password, firstName, lastName, phone } = req.body;

    const isValid = await verifyOTP(email, otp, 'VERIFY_EMAIL');
    if (!isValid) return res.status(400).json({ error: 'Invalid or expired OTP' });

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Use a default wallet address from Ganache for now
    // In production, you'd generate or assign one per user
    const walletAddress = process.env.DEFAULT_STORE_OWNER_ADDRESS || '0x0000000000000000000000000000000000000000';
    
    const [result] = await pool.execute(
        `INSERT INTO users (username, email, password_hash, first_name, last_name, phone, wallet_address, is_verified) 
         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [username, email, hashedPassword, firstName, lastName, phone, walletAddress]
    );

    const userId = result.insertId;

    // Insert store
    await pool.execute(
        'INSERT INTO stores (owner_id, store_name, is_approved) VALUES (?, ?, ?)',
        [userId, `${username}'s Store`, true] // Auto-approve for now
    );

    // Deploy blockchain contract for this user
    try {
        await blockchainService.deployContractForStoreOwner(userId, walletAddress, username);
        console.log(`✅ Contract deployed for new user: ${username}`);
    } catch (error) {
        console.error('Failed to deploy contract for new user:', error);
        // Don't fail registration
    }

    await auditLog(userId, 'REGISTER', req);
    res.status(201).json({ message: 'Registration successful' });
});

// Login - Step 1
app.post('/api/auth/login', authLimiter, loginValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    const [users] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = users[0];

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(423).json({ error: 'Account locked. Try later.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        const attempts = user.failed_login_attempts + 1;
        const lockUntil = attempts >= 5 ? new Date(Date.now() + 30 * 60000) : null;
        await pool.execute(
            'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
            [attempts, lockUntil, user.id]
        );
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    await pool.execute('UPDATE users SET failed_login_attempts = 0 WHERE id = ?', [user.id]);
    
    const otp = generateOTP();
    await sendOTPEmail(email, otp, 'login');
    await saveOTP(user.id, email, otp, 'LOGIN_MFA');

    res.json({ message: 'OTP sent', requiresOTP: true, email, userId: user.id });
});

// Verify OTP and complete login
app.post('/api/auth/login/verify', authLimiter, otpValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, otp } = req.body;

    const isValid = await verifyOTP(email, otp, 'LOGIN_MFA');
    if (!isValid) return res.status(400).json({ error: 'Invalid OTP' });

    const [users] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    const user = users[0];

    await pool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    const sessionToken = crypto.randomBytes(64).toString('hex');
    const jwtToken = jwt.sign(
        { 
            id: user.id, 
            username: user.username, 
            email: user.email, 
            role: user.role, 
            walletAddress: user.wallet_address,
            sessionToken 
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );

    await pool.execute(
        'INSERT INTO sessions (user_id, token, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))',
        [user.id, sessionToken, req.ip, req.headers['user-agent']]
    );

    await auditLog(user.id, 'LOGIN', req);

    delete user.password_hash;
    res.json({ message: 'Login successful', token: jwtToken, user });
});

// Logout
app.post('/api/auth/logout', authenticateToken, validateSession, async (req, res) => {
    await invalidateUserSessions(req.user.id);
    await auditLog(req.user.id, 'LOGOUT', req);
    res.json({ message: 'Logout successful' });
});

// Get current user
app.get('/api/auth/me', authenticateToken, validateSession, async (req, res) => {
    try {
        const [users] = await pool.execute(
            'SELECT id, username, email, first_name, last_name, role, is_verified, profile_photo, wallet_address FROM users WHERE id = ?',
            [req.user.id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(users[0]);
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ FILE UPLOAD ROUTES ============

// Upload profile photo
app.post('/api/users/profile-photo', authenticateToken, validateSession, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const fileBuffer = fs.readFileSync(req.file.path);
        const magicNumbers = fileBuffer.toString('hex', 0, 4);
        
        const validMagicNumbers = [
            'ffd8ffe0', 'ffd8ffe1', '89504e47', '47494638', '52494646'
        ];
        
        const isValidImage = validMagicNumbers.some(magic => magicNumbers.startsWith(magic));
        
        if (!isValidImage) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Invalid or corrupted image file' });
        }

        const [oldPhoto] = await pool.execute('SELECT profile_photo FROM users WHERE id = ?', [req.user.id]);
        
        const [result] = await pool.execute(
            'UPDATE users SET profile_photo = ? WHERE id = ?',
            [req.file.filename, req.user.id]
        );

        if (result.affectedRows === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'User not found' });
        }

        if (oldPhoto[0]?.profile_photo) {
            try {
                fs.unlinkSync(path.join('uploads', oldPhoto[0].profile_photo));
            } catch (err) {
                console.error('Error deleting old photo:', err);
            }
        }

        await auditLog(req.user.id, 'UPLOAD_PROFILE_PHOTO', req);
        
        res.json({ 
            message: 'Profile photo uploaded successfully', 
            filename: req.file.filename,
            url: `http://127.0.0.1:3000/uploads/${req.file.filename}`
        });
    } catch (error) {
        console.error('Upload error:', error);
        if (req.file) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('Error deleting file:', unlinkError);
            }
        }
        res.status(500).json({ error: 'Upload failed: ' + error.message });
    }
});

// Upload debtor photo
app.post('/api/debtors/:debtorId/photo', authenticateToken, validateSession, authorize('store_owner'), upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const fileBuffer = fs.readFileSync(req.file.path);
        const magicNumbers = fileBuffer.toString('hex', 0, 4);
        
        const validMagicNumbers = [
            'ffd8ffe0', 'ffd8ffe1', '89504e47', '47494638', '52494646'
        ];
        
        const isValidImage = validMagicNumbers.some(magic => magicNumbers.startsWith(magic));
        
        if (!isValidImage) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Invalid or corrupted image file' });
        }

        const [stores] = await pool.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
        if (stores.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Store not found' });
        }

        const [oldPhoto] = await pool.execute('SELECT photo FROM debtors WHERE debtor_id = ? AND store_id = ?', 
            [req.params.debtorId, stores[0].id]);

        const [result] = await pool.execute(
            'UPDATE debtors SET photo = ? WHERE debtor_id = ? AND store_id = ?',
            [req.file.filename, req.params.debtorId, stores[0].id]
        );

        if (result.affectedRows === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Debtor not found' });
        }

        if (oldPhoto[0]?.photo) {
            try {
                fs.unlinkSync(path.join('uploads', oldPhoto[0].photo));
            } catch (err) {
                console.error('Error deleting old photo:', err);
            }
        }

        await auditLog(req.user.id, 'UPLOAD_DEBTOR_PHOTO', req);
        
        res.json({ 
            message: 'Photo uploaded successfully', 
            filename: req.file.filename,
            url: `http://127.0.0.1:3000/uploads/${req.file.filename}`
        });
    } catch (error) {
        console.error('Upload error:', error);
        if (req.file) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('Error deleting file:', unlinkError);
            }
        }
        res.status(500).json({ error: 'Upload failed: ' + error.message });
    }
});

// ============ BLOCKCHAIN ROUTES ============

// Add debt to blockchain
app.post('/api/blockchain/add-utang', authenticateToken, validateSession, authorize('store_owner'), async (req, res) => {
    try {
        const { debtorName, amount, items } = req.body;

        if (!debtorName || !amount || !items) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Get store info
        const [stores] = await pool.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
        if (stores.length === 0) {
            return res.status(404).json({ error: 'Store not found' });
        }

        // Use user's wallet address from database
        const [users] = await pool.execute('SELECT wallet_address FROM users WHERE id = ?', [req.user.id]);
        const storeOwnerAddress = users[0]?.wallet_address || process.env.DEFAULT_STORE_OWNER_ADDRESS;

        // Add to blockchain
        const receipt = await blockchainService.addUtang(storeOwnerAddress, debtorName, amount, items);
        
// Extract utang ID from event - FIXED
let utangId = 'unknown';
if (receipt.events && receipt.events.length > 0) {
    const event = receipt.events.find(e => e.event === 'NewUtang');
    if (event && event.args) {
        utangId = event.args.id.toString();
    } else {
        // Fallback: try to get from logs
        console.log('No NewUtang event found, using transaction hash');
        utangId = receipt.transactionHash.slice(0, 8);
    }
} else {
    console.log('No events in receipt');
    utangId = receipt.transactionHash.slice(0, 8);
}

        // Save to database for fast queries
        await pool.execute(
            `INSERT INTO blockchain_utang (utang_id, store_id, debtor_name, amount, items, transaction_hash, block_number) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [utangId, stores[0].id, debtorName, amount, items, receipt.transactionHash, receipt.blockNumber]
        );

        await auditLog(req.user.id, 'ADD_BLOCKCHAIN_UTANG', req);

        res.json({ 
            success: true, 
            utangId,
            transactionHash: receipt.transactionHash,
            message: 'Debt recorded on blockchain'
        });

    } catch (error) {
        console.error('Blockchain error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Mark utang as paid on blockchain
app.post('/api/blockchain/mark-paid/:utangId', authenticateToken, validateSession, authorize('store_owner'), async (req, res) => {
    try {
        const { utangId } = req.params;

        const [users] = await pool.execute('SELECT wallet_address FROM users WHERE id = ?', [req.user.id]);
        const storeOwnerAddress = users[0]?.wallet_address || process.env.DEFAULT_STORE_OWNER_ADDRESS;

        const receipt = await blockchainService.markAsPaid(storeOwnerAddress, utangId);

        await pool.execute(
            'UPDATE blockchain_utang SET status = ? WHERE utang_id = ?',
            ['paid', utangId]
        );

        await auditLog(req.user.id, 'MARK_BLOCKCHAIN_PAID', req);

        res.json({ 
            success: true, 
            transactionHash: receipt.transactionHash,
            message: 'Utang marked as paid on blockchain'
        });

    } catch (error) {
        console.error('Blockchain error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get store owner's utang from blockchain
app.get('/api/blockchain/my-utang', authenticateToken, validateSession, authorize('store_owner'), async (req, res) => {
    try {
        const { offset = 0, limit = 50 } = req.query;

        const [users] = await pool.execute('SELECT wallet_address FROM users WHERE id = ?', [req.user.id]);
        const storeOwnerAddress = users[0]?.wallet_address || process.env.DEFAULT_STORE_OWNER_ADDRESS;

        const utangList = await blockchainService.getMyUtang(storeOwnerAddress, parseInt(offset), parseInt(limit));
        
        const formatted = utangList.map(u => ({
            id: u.id.toString(),
            debtorName: u.debtorName,
            amount: u.amount.toString(),
            items: u.items,
            paid: u.paid,
            timestamp: new Date(u.timestamp * 1000)
        }));

        res.json(formatted);

    } catch (error) {
        console.error('Blockchain error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Sync blockchain data to database
app.post('/api/blockchain/sync', authenticateToken, validateSession, authorize('store_owner'), async (req, res) => {
    try {
        const [users] = await pool.execute('SELECT wallet_address FROM users WHERE id = ?', [req.user.id]);
        const storeOwnerAddress = users[0]?.wallet_address || process.env.DEFAULT_STORE_OWNER_ADDRESS;

        const [stores] = await pool.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
        if (stores.length === 0) {
            return res.status(404).json({ error: 'Store not found' });
        }

        const utangList = await blockchainService.getMyUtang(storeOwnerAddress, 0, 100);
        
        for (const u of utangList) {
            await pool.execute(
                `INSERT INTO blockchain_utang (utang_id, store_id, debtor_name, amount, items, status) 
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE status = ?`,
                [u.id.toString(), stores[0].id, u.debtorName, u.amount.toString(), u.items, 
                 u.paid ? 'paid' : 'active', u.paid ? 'paid' : 'active']
            );
        }

        res.json({ 
            success: true, 
            synced: utangList.length,
            message: `Synced ${utangList.length} records`
        });

    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Deploy contract for existing store owner (admin only)
app.post('/api/admin/deploy-contract/:userId', authenticateToken, validateSession, authorize('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        
        const [users] = await pool.execute('SELECT id, username, wallet_address FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];
        const walletAddress = user.wallet_address || process.env.DEFAULT_STORE_OWNER_ADDRESS;
        
        const contractAddress = await blockchainService.deployContractForStoreOwner(
            user.id, 
            walletAddress, 
            user.username
        );

        await auditLog(req.user.id, 'DEPLOY_CONTRACT', req);

        res.json({ 
            success: true, 
            contractAddress,
            message: 'Contract deployed successfully'
        });

    } catch (error) {
        console.error('Deploy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ STORE OWNER ROUTES ============

// Get dashboard stats
app.get('/api/dashboard/stats', authenticateToken, validateSession, authorize('store_owner', 'admin'), async (req, res) => {
    const [stores] = await pool.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
    if (stores.length === 0) return res.status(404).json({ error: 'Store not found' });

    const storeId = stores[0].id;

    const [[debtorCount], [transactionStats], [trustLevels], [blockchainStats]] = await Promise.all([
        pool.execute('SELECT COUNT(*) as count FROM debtors WHERE store_id = ?', [storeId]),
        pool.execute(`SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'PENDING' THEN amount ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'COMPLETED' THEN amount ELSE 0 END) as collected
            FROM transactions WHERE store_id = ?`, [storeId]),
        pool.execute(`SELECT trust_level, COUNT(*) as count FROM debtors WHERE store_id = ? GROUP BY trust_level`, [storeId]),
        pool.execute(`SELECT COUNT(*) as blockchain_total, 
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_blockchain
            FROM blockchain_utang WHERE store_id = ?`, [storeId])
    ]);

    res.json({
        totalDebtors: debtorCount[0].count,
        pendingAmount: transactionStats[0].pending || 0,
        collectedAmount: transactionStats[0].collected || 0,
        totalTransactions: transactionStats[0].total || 0,
        trustLevels: trustLevels,
        blockchainTotal: blockchainStats[0]?.blockchain_total || 0,
        activeBlockchain: blockchainStats[0]?.active_blockchain || 0
    });
});

// Get all debtors
app.get('/api/debtors', authenticateToken, validateSession, authorize('store_owner'), async (req, res) => {
    const [stores] = await pool.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
    if (stores.length === 0) return res.status(404).json({ error: 'Store not found' });

    const [debtors] = await pool.execute(
        'SELECT id, debtor_id, first_name, last_name, phone, email, address, trust_score, trust_level, total_borrowed, total_repaid, active_debts, completed_debts, photo, created_at FROM debtors WHERE store_id = ? ORDER BY created_at DESC',
        [stores[0].id]
    );
    res.json(debtors);
});

// Get single debtor
app.get('/api/debtors/:debtorId', authenticateToken, validateSession, authorize('store_owner'), async (req, res) => {
    const [stores] = await pool.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
    if (stores.length === 0) return res.status(404).json({ error: 'Store not found' });

    const [debtors] = await pool.execute(
        'SELECT * FROM debtors WHERE debtor_id = ? AND store_id = ?',
        [req.params.debtorId, stores[0].id]
    );

    if (debtors.length === 0) return res.status(404).json({ error: 'Debtor not found' });

    const [transactions] = await pool.execute(
        'SELECT * FROM transactions WHERE debtor_id = ? ORDER BY created_at DESC',
        [debtors[0].id]
    );

    res.json({ 
        debtor: debtors[0], 
        transactions
    });
});

// Add debtor
app.post('/api/debtors', authenticateToken, validateSession, authorize('store_owner'), debtorValidation, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const [stores] = await pool.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
    if (stores.length === 0) return res.status(404).json({ error: 'Store not found' });

    const storeId = stores[0].id;

    // Auto-generate debtor ID if not provided
    const debtorId = req.body.debtorId || `DEBTOR-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const [result] = await pool.execute(
        `INSERT INTO debtors (store_id, debtor_id, first_name, last_name, phone, email, address) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [storeId, debtorId, req.body.firstName, req.body.lastName, 
         req.body.phone || null, req.body.email || null, req.body.address || null]
    );

    await auditLog(req.user.id, 'ADD_DEBTOR', req);
    res.status(201).json({ message: 'Debtor added', id: result.insertId, debtorId });
});

// Edit debtor
app.put('/api/debtors/:debtorId', authenticateToken, validateSession, authorize('store_owner'), async (req, res) => {
    try {
        const { firstName, lastName, phone, email, address } = req.body;
        
        const [stores] = await pool.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
        if (stores.length === 0) return res.status(404).json({ error: 'Store not found' });

        const storeId = stores[0].id;

        const [result] = await pool.execute(
            `UPDATE debtors SET 
             first_name = ?, last_name = ?, phone = ?, email = ?, address = ?
             WHERE debtor_id = ? AND store_id = ?`,
            [firstName, lastName, phone, email, address, req.params.debtorId, storeId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Debtor not found' });
        }

        await auditLog(req.user.id, 'EDIT_DEBTOR', req);
        res.json({ message: 'Debtor updated successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete debtor
app.delete('/api/debtors/:debtorId', authenticateToken, validateSession, authorize('store_owner'), async (req, res) => {
    try {
        const [stores] = await pool.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
        if (stores.length === 0) return res.status(404).json({ error: 'Store not found' });

        const storeId = stores[0].id;

        const [debtor] = await pool.execute(
            'SELECT active_debts, photo FROM debtors WHERE debtor_id = ? AND store_id = ?',
            [req.params.debtorId, storeId]
        );

        if (debtor.length === 0) {
            return res.status(404).json({ error: 'Debtor not found' });
        }

        if (debtor[0].active_debts > 0) {
            return res.status(400).json({ error: 'Cannot delete debtor with active debts' });
        }

        if (debtor[0].photo) {
            try {
                fs.unlinkSync(path.join('uploads', debtor[0].photo));
            } catch (err) {
                console.error('Error deleting photo file:', err);
            }
        }

        await pool.execute(
            'DELETE FROM debtors WHERE debtor_id = ? AND store_id = ?',
            [req.params.debtorId, storeId]
        );

        await auditLog(req.user.id, 'DELETE_DEBTOR', req);
        res.json({ message: 'Debtor deleted successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Record borrow transaction
app.post('/api/transactions/borrow', authenticateToken, validateSession, authorize('store_owner'),
    async (req, res) => {
        const { debtorId, amount, items, dueDate } = req.body;

        const [stores] = await pool.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
        if (stores.length === 0) return res.status(404).json({ error: 'Store not found' });

        const storeId = stores[0].id;

        const [debtors] = await pool.execute(
            'SELECT * FROM debtors WHERE debtor_id = ? AND store_id = ?',
            [debtorId, storeId]
        );
        if (debtors.length === 0) return res.status(404).json({ error: 'Debtor not found' });

        const debtor = debtors[0];
        const transactionId = `TXN-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

        await pool.execute(
            `INSERT INTO transactions (transaction_id, store_id, debtor_id, amount, type, items, due_date) 
             VALUES (?, ?, ?, ?, 'BORROW', ?, ?)`,
            [transactionId, storeId, debtor.id, amount, items || null, dueDate || null]
        );

        await pool.execute(
            'UPDATE debtors SET total_borrowed = total_borrowed + ?, active_debts = active_debts + 1 WHERE id = ?',
            [amount, debtor.id]
        );

        await auditLog(req.user.id, 'BORROW', req);
        res.status(201).json({ message: 'Transaction recorded', transactionId });
    }
);

// Edit transaction
app.put('/api/transactions/:transactionId', authenticateToken, validateSession, authorize('store_owner'), async (req, res) => {
    try {
        const { amount, items, dueDate } = req.body;

        const [transactions] = await pool.execute(
            `SELECT t.* FROM transactions t
             JOIN stores s ON t.store_id = s.id
             WHERE t.transaction_id = ? AND s.owner_id = ? AND t.status = 'PENDING'`,
            [req.params.transactionId, req.user.id]
        );

        if (transactions.length === 0) {
            return res.status(404).json({ error: 'Pending transaction not found' });
        }

        const oldAmount = transactions[0].amount;
        const amountDiff = amount - oldAmount;

        await pool.execute(
            `UPDATE transactions SET 
             amount = ?, items = ?, due_date = ?
             WHERE transaction_id = ?`,
            [amount, items, dueDate, req.params.transactionId]
        );

        if (amountDiff !== 0) {
            await pool.execute(
                'UPDATE debtors SET total_borrowed = total_borrowed + ? WHERE id = ?',
                [amountDiff, transactions[0].debtor_id]
            );
        }

        await auditLog(req.user.id, 'EDIT_TRANSACTION', req);
        res.json({ message: 'Transaction updated successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Record payment
app.post('/api/transactions/pay/:transactionId', authenticateToken, validateSession, authorize('store_owner'), async (req, res) => {
    const [transactions] = await pool.execute(
        `SELECT t.*, d.id as debtor_db_id FROM transactions t
         JOIN debtors d ON t.debtor_id = d.id
         JOIN stores s ON t.store_id = s.id
         WHERE t.transaction_id = ? AND s.owner_id = ?`,
        [req.params.transactionId, req.user.id]
    );

    if (transactions.length === 0) return res.status(404).json({ error: 'Transaction not found' });

    const txn = transactions[0];
    if (txn.status === 'COMPLETED') return res.status(400).json({ error: 'Already paid' });

    await pool.execute('UPDATE transactions SET status = "COMPLETED", paid_date = NOW() WHERE id = ?', [txn.id]);

    await pool.execute(
        `UPDATE debtors SET 
         total_repaid = total_repaid + ?,
         active_debts = active_debts - 1,
         completed_debts = completed_debts + 1,
         on_time_payments = on_time_payments + 1
         WHERE id = ?`,
        [txn.amount, txn.debtor_db_id]
    );

    const [[stats]] = await pool.execute(
        `SELECT COUNT(*) as total, SUM(CASE WHEN paid_date <= due_date OR due_date IS NULL THEN 1 ELSE 0 END) as on_time
         FROM transactions WHERE debtor_id = ? AND status = 'COMPLETED'`,
        [txn.debtor_db_id]
    );

    if (stats.total > 0) {
        const trustScore = Math.round((stats.on_time / stats.total) * 100);
        const trustLevel = trustScore >= 70 ? 'HIGH' : trustScore >= 40 ? 'MEDIUM' : 'LOW';
        await pool.execute('UPDATE debtors SET trust_score = ?, trust_level = ? WHERE id = ?',
            [trustScore, trustLevel, txn.debtor_db_id]);
    }

    await auditLog(req.user.id, 'PAYMENT', req);
    res.json({ message: 'Payment recorded' });
});

// Get transactions for a debtor
app.get('/api/transactions/debtor/:debtorId', authenticateToken, validateSession, authorize('store_owner'), async (req, res) => {
    const [stores] = await pool.execute('SELECT id FROM stores WHERE owner_id = ?', [req.user.id]);
    if (stores.length === 0) return res.status(404).json({ error: 'Store not found' });

    const [debtors] = await pool.execute(
        'SELECT id FROM debtors WHERE debtor_id = ? AND store_id = ?',
        [req.params.debtorId, stores[0].id]
    );

    if (debtors.length === 0) return res.status(404).json({ error: 'Debtor not found' });

    const [transactions] = await pool.execute(
        'SELECT * FROM transactions WHERE debtor_id = ? ORDER BY created_at DESC',
        [debtors[0].id]
    );

    res.json(transactions);
});

// ============ ADMIN ROUTES ============

// Get all users
app.get('/api/admin/users', authenticateToken, validateSession, authorize('admin', 'super_admin'), async (req, res) => {
    const [users] = await pool.execute(
        'SELECT id, username, email, first_name, last_name, role, is_verified, is_active, wallet_address, created_at FROM users'
    );
    res.json(users);
});

// Get pending stores
app.get('/api/admin/stores/pending', authenticateToken, validateSession, authorize('admin'), async (req, res) => {
    const [stores] = await pool.execute(
        `SELECT s.*, u.username, u.email FROM stores s
         JOIN users u ON s.owner_id = u.id
         WHERE s.is_approved = FALSE`
    );
    res.json(stores);
});

// Approve store
app.post('/api/admin/stores/:storeId/approve', authenticateToken, validateSession, authorize('admin'), async (req, res) => {
    await pool.execute('UPDATE stores SET is_approved = TRUE WHERE id = ?', [req.params.storeId]);
    await auditLog(req.user.id, 'APPROVE_STORE', req);
    res.json({ message: 'Store approved' });
});

// Toggle user status
app.post('/api/admin/users/:userId/toggle-status', authenticateToken, validateSession, authorize('admin'), async (req, res) => {
    const [users] = await pool.execute('SELECT is_active FROM users WHERE id = ?', [req.params.userId]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const newStatus = !users[0].is_active;
    await pool.execute('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, req.params.userId]);

    if (!newStatus) {
        await invalidateUserSessions(req.params.userId);
    }

    await auditLog(req.user.id, 'TOGGLE_USER', req);
    res.json({ message: `User ${newStatus ? 'activated' : 'deactivated'}` });
});

// Get audit logs
app.get('/api/admin/audit-logs', authenticateToken, validateSession, authorize('admin'), async (req, res) => {
    const [logs] = await pool.execute(
        'SELECT l.*, u.username FROM audit_logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT 100'
    );
    res.json(logs);
});

// Get all contracts (admin only)
app.get('/api/admin/contracts', authenticateToken, validateSession, authorize('admin'), async (req, res) => {
    try {
        const contracts = await blockchainService.getAllContracts();
        res.json(contracts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
    res.json({ status: 'OK', time: new Date().toISOString() });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 ListaTrust backend running on port ${PORT}`);
    console.log(`📧 OTP codes will be shown in console (for development)`);
    console.log(`🖼️  File upload: JPG, PNG, GIF, WEBP only (max 5MB) - Filenames are hashed`);
    console.log(`🔐 Session management: Cross-tab logout enabled`);
    console.log(`⛓️  Blockchain: Connected to Ganache at ${process.env.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:8545'}`);
    console.log(`👤 Default store owner address: ${process.env.DEFAULT_STORE_OWNER_ADDRESS || 'Not set'}\n`);
});