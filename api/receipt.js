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
            private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),  // Ensure correct formatting
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

// Function to send receipt
async function sendReceipt(paymentId) {
    try {
        // Retrieve payment details from Stripe using payment ID
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);

        // Only proceed if the payment is successful
        if (paymentIntent.status !== 'succeeded') {
            console.log(`Payment ${paymentId} not succeeded, skipping receipt`);
            return false;
        }

        const providerEmail = paymentIntent.metadata.providerEmail;
        if (!providerEmail) {
            console.log(`No provider email found for payment ${paymentId}`);
            return false;
        }

        // Create an invoice with detailed information, including metadata fields
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
            description: `Receipt for ${paymentIntent.metadata.serviceOffered || 'Service'}`,
            billing: {
                email: providerEmail // Set the provider email for billing
            }
        });

        // Finalize and send the invoice to the provider's email
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
    console.log(`Booking changed: ${snapshot.key}`, snapshot.val());
    const booking = snapshot.val();

    // Check if booking status is Completed and contains a payment ID
    if (booking.bookingStatus === 'Completed' && booking.bookingPaymentId) {
        console.log(`Attempting to send receipt for booking ${snapshot.key}`);
        try {
            const sent = await sendReceipt(booking.bookingPaymentId);
            console.log(`Receipt sent status for booking ${snapshot.key}:`, sent);

            if (sent) {
                // Update the booking to mark that receipt has been sent (optional)
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

// Manual endpoint to send receipt
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
