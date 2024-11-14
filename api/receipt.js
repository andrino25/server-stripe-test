const dotenv = require('dotenv');
dotenv.config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            type: process.env.FIREBASE_TYPE,
            project_id: process.env.FIREBASE_PROJECT_ID,
            private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
            private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
            client_id: process.env.FIREBASE_CLIENT_ID,
            auth_uri: process.env.FIREBASE_AUTH_URI,
            token_uri: process.env.FIREBASE_TOKEN_URI,
            auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
            client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const db = admin.database();

const bookingsRef = db.ref('bookings');

// Add Firebase listener for booking changes
bookingsRef.on('child_changed', async (snapshot) => {
    console.log('🔵 Booking changed detected:', snapshot.key);
    const booking = snapshot.val();

    // Check if status is Completed and has payment ID
    if (booking.bookingStatus === 'Completed' && booking.bookingPaymentId) {
        console.log('🟢 Processing completed booking:', snapshot.key);
        try {
            const sent = await sendReceipt(booking.bookingPaymentId);
            if (sent) {
                // Update booking with receipt status
                await snapshot.ref.update({
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
            const bookingRef = db.ref(`bookings/${bookingId}`);
            const snapshot = await bookingRef.once('value');
            const booking = snapshot.val();

            if (booking && booking.bookingStatus === 'Completed' && booking.bookingPaymentId) {
                console.log('🟢 Processing completed booking:', bookingId);
                const sent = await sendReceipt(booking.bookingPaymentId);
                
                if (sent) {
                    await bookingRef.update({
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
