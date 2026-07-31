const nodemailer = require('nodemailer');

// Create a reusable transporter connection pool
const transporter = nodemailer.createTransport({
  service: 'gmail', // Standard configuration for Gmail
  pool: true,
  maxConnections: 5,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

const sendEmail = async (options) => {
  // Define the email options
  const mailOptions = {
    from: `ExamHub <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    html: options.message,
  };

  // Send the email
  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;
