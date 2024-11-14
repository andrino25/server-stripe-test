const dotenv = require('dotenv');
dotenv.config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, onChildChanged, get, update } = require('firebase/database');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');

// Your Firebase configuration
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
            const doc = new PDFDocument();
            const chunks = [];

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));

            // Add receipt content
            doc.fontSize(20).text('Payment Receipt', { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(`Date: ${new Date().toLocaleDateString()}`);
            doc.text(`Receipt No: ${paymentIntent.id}`);
            doc.moveDown();
            doc.text(`Service: ${paymentIntent.metadata.serviceOffered || 'Service'}`);
            doc.text(`Amount Paid: PHP ${paymentIntent.metadata.originalAmountPHP || (paymentIntent.amount / 100)}`);
            doc.text(`Payment Date: ${paymentIntent.metadata.paymentDate || new Date().toISOString()}`);
            doc.text(`Status: Payment Successful`);
            doc.moveDown();
            doc.text('Thank you for using our service!', { align: 'center' });

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
        console.log('📌 Retrieved payment intent:', {
            status: paymentIntent.status,
            email: paymentIntent.metadata.providerEmail,
            amount: paymentIntent.amount
        });

        if (paymentIntent.status !== 'succeeded') {
            console.log('❌ Payment not succeeded:', paymentId);
            return false;
        }

        const providerEmail = paymentIntent.metadata.providerEmail;
        if (!providerEmail) {
            console.log('❌ No provider email found:', paymentId);
            return false;
        }

        // Generate PDF receipt
        console.log('🟡 Generating receipt PDF...');
        const pdfBuffer = await generateReceipt(paymentIntent);

        // Send email with PDF attachment
        console.log('🟡 Sending receipt email...');
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

// Scan all bookings function
async function scanBookings() {
    try {
        const snapshot = await get(ref(database, 'bookings'));
        const bookings = snapshot.val();

        for (const [bookingId, booking] of Object.entries(bookings)) {
            if (booking.bookingStatus === 'Completed' && 
                booking.bookingPaymentId && 
                !booking.receiptSent) {
                
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
        }
    } catch (err) {
        console.error('❌ Error scanning bookings:', err);
    }
}

// Listen for changes
onChildChanged(bookingsRef, async (snapshot) => {
    const booking = snapshot.val();
    if (booking.bookingStatus === 'Completed' && 
        booking.bookingPaymentId && 
        !booking.receiptSent) {
        
        console.log('🟢 Processing completed booking:', snapshot.key);
        const sent = await sendReceipt(booking.bookingPaymentId);
        
        if (sent) {
            const bookingRef = ref(database, `bookings/${snapshot.key}`);
            await update(bookingRef, {
                receiptSent: true,
                receiptSentDate: new Date().toISOString()
            });
            console.log('✅ Receipt sent and booking updated:', snapshot.key);
        }
    }
});

// API endpoint
module.exports = async (req, res) => {
    if (req.method === 'GET') {
        // Trigger manual scan of all bookings
        await scanBookings();
        return res.status(200).json({ message: 'Scan completed' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { paymentId, bookingId, type } = req.body;

        // If it's a booking status change
        if (type === 'bookingStatusChange' && bookingId) {
            console.log('🔵 Processing booking status change:', bookingId);
            
            // Get the booking data
            const bookingRef = ref(database, `bookings/${bookingId}`);
            const snapshot = await get(bookingRef);
            const booking = snapshot.val();

            if (booking && booking.bookingStatus === 'Completed' && booking.bookingPaymentId) {
                console.log('🟢 Processing completed booking:', bookingId);
                const sent = await sendReceipt(booking.bookingPaymentId);
                
                if (sent) {
                    await update(bookingRef, {
                        receiptSent: true,
                        receiptSentDate: new Date().toISOString()
                    });
                    return res.status(200).json({ 
                        message: 'Receipt sent successfully for booking'
                    });
                }
            }
        }
        // If it's a manual receipt send
        else if (paymentId) {
            const sent = await sendReceipt(paymentId);
            if (sent) {
                return res.status(200).json({ 
                    message: 'Receipt sent successfully'
                });
            }
        }

        return res.status(400).json({ 
            error: 'Failed to send receipt'
        });

    } catch (err) {
        console.error('Error:', err);
        return res.status(500).json({ error: err.message });
    }
};
