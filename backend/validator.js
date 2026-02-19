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

const debtorValidation = [
    body('debtorId').notEmpty().trim().escape(),
    body('firstName').notEmpty().trim().escape(),
    body('lastName').notEmpty().trim().escape()
];

module.exports = {
    registerValidation,
    loginValidation,
    otpValidation,
    debtorValidation
};