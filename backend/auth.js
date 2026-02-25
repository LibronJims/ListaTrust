const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

// Create connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'listatrust_db',
    waitForConnections: true,
    connectionLimit: 10
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Validate session exists in database
const validateSession = async (req, res, next) => {
    try {
        const [sessions] = await pool.execute(
            'SELECT * FROM sessions WHERE user_id = ? AND token = ? AND expires_at > NOW()',
            [req.user.id, req.user.sessionToken]
        );

        if (sessions.length === 0) {
            return res.status(401).json({ error: 'Session expired or invalid' });
        }

        next();
    } catch (error) {
        console.error('Session validation error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const authorize = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    next();
};

module.exports = { authenticateToken, authorize, validateSession };