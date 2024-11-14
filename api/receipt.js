const dotenv = require('dotenv');
dotenv.config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const db = admin.database();

// Function to send receipt
async function sendReceipt(paymentId) {
    try {
        // Get payment details
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);

        if (paymentIntent.status !== 'succeeded') {
            console.log(`Payment ${paymentId} not succeeded, skipping receipt`);
            return;
        }

        const providerEmail = paymentIntent.metadata.providerEmail;
        if (!providerEmail) {
            console.log(`No provider email found for payment ${paymentId}`);
            return;
        }

        // Create invoice with detailed information
        const invoice = await stripe.invoices.create({
            customer: paymentIntent.customer,
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

        // Finalize and send
        await stripe.invoices.finalizeInvoice(invoice.id);
        await stripe.invoices.sendInvoice(invoice.id);

        console.log(`Receipt sent successfully to ${providerEmail} for payment ${paymentId}`);
        return true;
    } catch (err) {
        console.error(`Error sending receipt for payment ${paymentId}:`, err);
        return false;
    }
}

// Listen for changes in bookings
const bookingsRef = db.ref('bookings');

bookingsRef.on('child_changed', async (snapshot) => {
    const booking = snapshot.val();
    
    // Check if booking status is Completed and has a payment ID
    if (booking.bookingStatus === 'Completed' && booking.bookingPaymentId) {
        console.log(`Processing completed booking: ${snapshot.key}`);
        
        try {
            // Send receipt
            const sent = await sendReceipt(booking.bookingPaymentId);
            
            if (sent) {
                // Update booking to mark receipt as sent (optional)
                await snapshot.ref.update({
                    receiptSent: true,
                    receiptSentDate: new Date().toISOString()
                });
            }
        } catch (err) {
            console.error(`Error processing booking ${snapshot.key}:`, err);
        }
    }
});

// Keep the original endpoint for manual receipt sending
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { paymentId } = req.body;

    if (!paymentId) {
        return res.status(400).json({ error: 'Payment ID is required' });
    }

    try {
        const sent = await sendReceipt(paymentId);
        
        if (sent) {
            return res.status(200).json({ 
                message: 'Receipt sent successfully'
            });
        } else {
            return res.status(400).json({ 
                error: 'Failed to send receipt'
            });
        }
    } catch (err) {
        console.error('Error:', err);
        return res.status(500).json({ error: err.message });
    }
};
