const dotenv = require('dotenv');
dotenv.config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
    // Add debug logging
    console.log('Request received:', {
        method: req.method,
        url: req.url,
        body: req.body
    });

    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        console.log('Method not allowed:', req.method);
        return res.status(405).json({ 
            error: 'Method not allowed',
            method: req.method,
            allowedMethods: ['POST']
        });
    }

    const { paymentId } = req.body;

    if (!paymentId) {
        return res.status(400).json({ 
            error: 'Payment ID is required' 
        });
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

        // Verify provider email exists
        const providerEmail = paymentIntent.metadata.providerEmail;
        if (!providerEmail) {
            return res.status(400).json({ 
                error: 'Provider email not found in payment metadata',
                metadata: paymentIntent.metadata
            });
        }

        // Create and send receipt
        const invoice = await stripe.invoices.create({
            customer: paymentIntent.customer,
            auto_advance: true,
            collection_method: 'send_invoice',
            metadata: paymentIntent.metadata,
            custom_fields: [
                { name: 'Service', value: paymentIntent.metadata.serviceOffered },
                { name: 'Original Amount (PHP)', value: `${paymentIntent.metadata.originalAmountPHP}` },
                { name: 'Commission Amount (PHP)', value: `${paymentIntent.metadata.commissionAmountPHP}` },
                { name: 'Commission Rate', value: paymentIntent.metadata.commissionRate }
            ]
        });

        await stripe.invoices.finalizeInvoice(invoice.id);
        await stripe.invoices.sendInvoice(invoice.id, {
            email: providerEmail
        });

        res.status(200).json({ 
            message: 'Receipt sent successfully',
            invoiceId: invoice.id,
            sentTo: providerEmail,
            paymentDetails: {
                originalAmount: paymentIntent.metadata.originalAmountPHP,
                commissionAmount: paymentIntent.metadata.commissionAmountPHP,
                totalAmount: paymentIntent.amount / 100, // Convert centavos back to PHP
                serviceOffered: paymentIntent.metadata.serviceOffered,
                paymentDate: paymentIntent.metadata.paymentDate
            }
        });

    } catch (err) {
        console.error('Error sending receipt:', err);
        res.status(500).json({ 
            error: err.message,
            paymentId: paymentId
        });
    }
};