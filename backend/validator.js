const { body } = require('express-validator');

const registerValidation = [
    body('username').isLength({ min: 3 }).trim().escape(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('firstName').optional().trim().escape(),
    body('lastName').optional().trim().escape()
];

const loginValidation = [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
];

const otpValidation = [
    body('email').isEmail().normalizeEmail(),
    body('otp').isLength({ min: 6, max: 6 }).matches(/^\d+$/)
];

// FIXED: Make debtorId optional
const debtorValidation = [
    body('debtorId').optional().trim().escape(),  // ← Changed to optional
    body('firstName').notEmpty().trim().escape(),
    body('lastName').notEmpty().trim().escape(),
    body('phone').optional().trim().escape(),
    body('email').optional().isEmail().normalizeEmail()
];

module.exports = {
    registerValidation,
    loginValidation,
    otpValidation,
    debtorValidation
};