const dotenv = require('dotenv'); // Load dotenv at the top
dotenv.config(); // Load environment variables from .env

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Use process.env for your Stripe secret

// At the start of your file, add URL parsing
const url = require('url');

// This is the handler function that Vercel will call
module.exports = async (req, res) => {
    // Parse the URL to handle different endpoints
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    console.log("Stripe Secret Key:", process.env.STRIPE_SECRET_KEY); // Log secret key for debugging
    console.log('Request Method:', req.method);
    console.log('Request Body:', req.body);

    if (req.method === 'POST' && path === '/api/create-payment-intent') {
        const { amount, currency, email, providerEmail, serviceOffered } = req.body;

        // Validate currency
        if (currency.toLowerCase() !== 'php') {
            return res.status(400).json({ 
                error: 'Only PHP currency is supported' 
            });
        }

        try {
            // Convert amount to centavos if needed (multiply by 100)
            const amountInCentavos = Math.round(amount * 100);
            
            // Calculate commission (15%)
            const commissionRate = 0.15;
            const commissionAmountCentavos = Math.round(amountInCentavos * commissionRate);
            const totalAmountCentavos = amountInCentavos + commissionAmountCentavos;

            // Create or retrieve a customer
            const customer = await stripe.customers.create({
                email: email
            });

            // Create an ephemeral key for the customer
            const ephemeralKey = await stripe.ephemeralKeys.create(
                { customer: customer.id },
                { apiVersion: '2022-11-15' }
            );

            // Create a payment intent with commission details in metadata
            const paymentIntent = await stripe.paymentIntents.create({
                amount: totalAmountCentavos,
                currency: 'php',
                customer: customer.id,
                metadata: {
                    providerEmail: providerEmail,
                    serviceOffered: serviceOffered,
                    originalAmount: amountInCentavos,
                    commissionAmount: commissionAmountCentavos,
                    commissionRate: `${commissionRate * 100}%`,
                    paymentDate: new Date().toISOString(),
                    paymentMethod: req.body.paymentMethod || 'card',
                    // Store original amounts in PHP for readability
                    originalAmountPHP: amount,
                    commissionAmountPHP: amount * commissionRate,
                    totalAmountPHP: amount + (amount * commissionRate)
                }
            });

            res.status(200).json({
                clientSecret: paymentIntent.client_secret,
                ephemeralKey: ephemeralKey.secret,
                customerId: customer.id,
                paymentId: paymentIntent.id,
                paymentMethod: paymentIntent.metadata.paymentMethod,
                paymentDate: paymentIntent.metadata.paymentDate,
                // Return amounts in PHP for easier reading
                originalAmount: amount,
                commissionAmount: amount * commissionRate,
                totalAmount: amount + (amount * commissionRate),
                currency: 'php',
                status: paymentIntent.status
            });

        } catch (err) {
            console.error('Error creating payment intent:', err);
            res.status(500).json({ error: err.message });
        }
    } else if (req.method === 'POST' && path === '/api/create-payment-intent/send-receipt') {
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
    } else {
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
};
