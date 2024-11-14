const dotenv = require('dotenv');
dotenv.config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, onChildChanged, get, update } = require('firebase/database');

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

// Add Firebase listener for booking changes
onChildChanged(bookingsRef, async (snapshot) => {
    console.log('🔵 Booking changed detected:', snapshot.key);
    const booking = snapshot.val();

    // Check if status is Completed and has payment ID
    if (booking.bookingStatus === 'Completed' && booking.bookingPaymentId) {
        console.log('🟢 Processing completed booking:', snapshot.key);
        try {
            const sent = await sendReceipt(booking.bookingPaymentId);
            if (sent) {
                // Update booking with receipt status
                const bookingRef = ref(database, `bookings/${snapshot.key}`);
                await update(bookingRef, {
                    receiptSent: true,
                    receiptSentDate: new Date().toISOString()
                });
                console.log('✅ Receipt sent and booking updated:', snapshot.key);
            }
        } catch (err) {
            console.error('❌ Error processing booking:', snapshot.key, err);
        }
    }
});

async function sendReceipt(paymentId) {
    console.log('🟡 Starting receipt send process for payment:', paymentId);
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

        // Create customer for the provider
        console.log('🟡 Creating customer for:', providerEmail);
        let customer = await stripe.customers.create({
            email: providerEmail,
            metadata: { isProvider: true }
        });

        // Create and send invoice
        console.log('🟡 Creating invoice...');
        const invoice = await stripe.invoices.create({
            customer: customer.id,
            collection_method: 'send_invoice',
            days_until_due: 30,
            custom_fields: [
                { name: 'Service', value: paymentIntent.metadata.serviceOffered || 'Service' },
                { name: 'Payment Date', value: paymentIntent.metadata.paymentDate || new Date().toISOString() },
                { name: 'Original Amount', value: `PHP ${paymentIntent.metadata.originalAmountPHP || (paymentIntent.amount / 100)}` },
                { name: 'Payment ID', value: paymentId }
            ],
            description: `Receipt for ${paymentIntent.metadata.serviceOffered || 'Service'}`
        });

        await stripe.invoices.finalizeInvoice(invoice.id);
        await stripe.invoices.sendInvoice(invoice.id);

        console.log('✅ Receipt sent successfully to:', providerEmail);
        return true;
    } catch (err) {
        console.error('❌ Error sending receipt:', err);
        return false;
    }
}

// Handle both manual requests and booking status changes
module.exports = async (req, res) => {
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
