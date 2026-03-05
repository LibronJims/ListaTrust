const nodemailer = require('nodemailer');

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendOTPDev = async (email, otp, type) => {
    console.log('\n' + '='.repeat(50));
    console.log('🔐 LISTATRUST OTP CODE');
    console.log('='.repeat(50));
    console.log(`📧 Email: ${email}`);
    console.log(`🔑 OTP:   ${otp}`);
    console.log(`📋 Type:  ${type}`);
    console.log('='.repeat(50));
    console.log('⚠️  This code expires in 10 minutes\n');
    return true;
};

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendOTPEmail = process.env.NODE_ENV === 'production' ? 
    async (email, otp, type) => {
        await transporter.sendMail({
            from: process.env.EMAIL_FROM,
            to: email,
            subject: `ListaTrust ${type} Code`,
            html: `<h2>Your ${type} code is: <b>${otp}</b></h2><p>Valid for 10 minutes.</p>`
        });
    } : sendOTPDev;

module.exports = { generateOTP, sendOTPEmail };