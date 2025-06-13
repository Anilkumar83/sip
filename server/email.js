const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

function sendExpiringProductsEmail(expiringProducts) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: "malothuanilkumar83@gmail.com",
    subject: 'FreshVault: Products Expiring Soon',
    text: `The following products are expiring within 5 days:\n\n${expiringProducts.map(p => `${p.name} (Expires: ${p.expiryDate})`).join('\n')}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
}

module.exports = { sendExpiringProductsEmail };