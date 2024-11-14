const dotenv = require('dotenv');
dotenv.config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, onChildChanged, update } = require('firebase/database');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

// Firebase configuration
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Reference to bookings
const bookingsRef = ref(database, 'bookings');

// Initialize nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

async function generateReceipt(paymentIntent) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));

            doc.image('api/image.png', 50, 45, { width: 100 }).moveDown();
            doc.fontSize(20).text('PAYMENT RECEIPT', { align: 'center' }).moveDown();
            doc.moveTo(50, 160).lineTo(550, 160).stroke().moveDown();

            doc.fontSize(12);
            const leftX = 50;
            const rightX = 300;

            doc.text('Receipt Details:', leftX, 180, { bold: true }).moveDown(0.5);
            doc.text(`Receipt No: ${paymentIntent.id}`, leftX).moveDown(0.5);
            doc.text(`Date: ${new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })}`, leftX).moveDown(0.5);
            doc.text(`Payment Status: Successful`, leftX).moveDown(2);

            doc.text('Service Details:', leftX, doc.y, { bold: true }).moveDown(0.5);
            doc.text(`Service: ${paymentIntent.metadata.serviceOffered || 'Service'}`, leftX).moveDown(0.5);
            doc.text(`Provider: ${paymentIntent.metadata.providerName || 'Provider'}`, leftX).moveDown(0.5);

            doc.rect(50, doc.y, 500, 100).stroke();
            const paymentY = doc.y + 20;

            doc.text('Payment Details:', leftX + 10, paymentY, { bold: true }).moveDown(0.5);
            doc.text(`Amount Paid:`, leftX + 10).text(`PHP ${paymentIntent.metadata.originalAmountPHP || (paymentIntent.amount / 100)}`, rightX).moveDown(0.5);
            doc.text(`Payment Date:`, leftX + 10).text(`${paymentIntent.metadata.paymentDate || new Date().toISOString()}`, rightX).moveDown(0.5);
            doc.text(`Payment Method:`, leftX + 10).text('Credit Card', rightX).moveDown(2);

            doc.fontSize(10)
               .text('Thank you for your business!', { align: 'center' }).moveDown(0.5);
            doc.text('For any questions, please contact support@yourcompany.com', { align: 'center' }).moveDown(0.5);
            doc.text('This is a computer-generated receipt and requires no signature.', { align: 'center', italics: true });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

async function sendReceipt(paymentId) {
    console.log('🟡 Starting receipt process for payment:', paymentId);
    try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);
        if (paymentIntent.status !== 'succeeded') return false;

        const providerEmail = paymentIntent.metadata.providerEmail;
        if (!providerEmail) return false;

        const pdfBuffer = await generateReceipt(paymentIntent);

        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: providerEmail,
            subject: 'Payment Receipt',
            text: `Thank you for using our service. Please find your payment receipt attached.`,
            attachments: [{
                filename: 'receipt.pdf',
                content: pdfBuffer,
                contentType: 'application/pdf'
            }]
        });

        console.log('✅ Receipt sent successfully to:', providerEmail);
        return true;
    } catch (err) {
        console.error('❌ Error sending receipt:', err);
        return false;
    }
}

// Real-time listener for booking changes
onChildChanged(bookingsRef, async (snapshot) => {
    const bookingId = snapshot.key;
    const booking = snapshot.val();

    if (booking.bookingStatus === 'Completed' && booking.bookingPaymentId && !booking.receiptSent) {
        console.log('🟢 Processing completed booking:', bookingId);
        const sent = await sendReceipt(booking.bookingPaymentId);

        if (sent) {
            const bookingRef = ref(database, `bookings/${bookingId}`);
            await update(bookingRef, {
                receiptSent: true,
                receiptSentDate: new Date().toISOString()
            });
            console.log('✅ Receipt sent and booking updated:', bookingId);
        }
    }
});

console.log('🚀 Server is up and listening for booking status changes');
