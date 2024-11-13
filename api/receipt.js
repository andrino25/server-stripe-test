const dotenv = require('dotenv');
dotenv.config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end(); // Handle preflight requests
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { paymentId } = req.body;

    if (!paymentId) {
        return res.status(400).json({ error: 'Payment ID is required' });
    }

    try {
        // Retrieve the payment intent
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);

        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({ 
                error: 'Cannot send receipt for incomplete payment',
                status: paymentIntent.status
            });
        }

        const providerEmail = paymentIntent.metadata.providerEmail;
        if (!providerEmail) {
            return res.status(400).json({ 
                error: 'Provider email not found in payment metadata',
                metadata: paymentIntent.metadata
            });
        }

        // Prepare custom fields with validation
        const customFields = [];
        
        if (paymentIntent.metadata.serviceOffered) {
            customFields.push({ 
                name: 'Service', 
                value: paymentIntent.metadata.serviceOffered 
            });
        }

        if (paymentIntent.metadata.originalAmountPHP) {
            customFields.push({ 
                name: 'Original Amount (PHP)', 
                value: `${paymentIntent.metadata.originalAmountPHP}` 
            });
        }

        if (paymentIntent.metadata.commissionAmountPHP) {
            customFields.push({ 
                name: 'Commission Amount (PHP)', 
                value: `${paymentIntent.metadata.commissionAmountPHP}` 
            });
        }

        if (paymentIntent.metadata.commissionRate) {
            customFields.push({ 
                name: 'Commission Rate', 
                value: paymentIntent.metadata.commissionRate 
            });
        }

        // Create and send receipt
        const invoice = await stripe.invoices.create({
            customer: paymentIntent.customer,
            auto_advance: true,
            collection_method: 'send_invoice',
            metadata: paymentIntent.metadata,
            custom_fields: customFields // Only include fields that exist
        });

        await stripe.invoices.finalizeInvoice(invoice.id);
        await stripe.invoices.sendInvoice(invoice.id, {
            email: providerEmail
        });

        // Calculate response values safely
        const responseDetails = {
            originalAmount: paymentIntent.metadata.originalAmountPHP || 0,
            commissionAmount: paymentIntent.metadata.commissionAmountPHP || 0,
            totalAmount: paymentIntent.amount ? paymentIntent.amount / 100 : 0,
            serviceOffered: paymentIntent.metadata.serviceOffered || 'Not specified',
            paymentDate: paymentIntent.metadata.paymentDate || new Date().toISOString()
        };

        return res.status(200).json({ 
            message: 'Receipt sent successfully',
            invoiceId: invoice.id,
            sentTo: providerEmail,
            paymentDetails: responseDetails
        });

    } catch (err) {
        console.error('Error sending receipt:', err);
        return res.status(500).json({ 
            error: err.message,
            paymentId: paymentId
        });
    }
};
