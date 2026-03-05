const rateLimit = require('express-rate-limit');

// For general API routes
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { error: 'Too many requests' }
});

// For login/register - INCREASED LIMITS
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // Changed from 1 hour to 15 minutes
    max: 20, // Increased from 5 to 20 attempts
    message: { error: 'Too many login attempts. Please wait 15 minutes.' }
});

module.exports = { apiLimiter, authLimiter };