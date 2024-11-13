const dotenv = require('dotenv'); // Load dotenv at the top
dotenv.config(); // Load environment variables from .env

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Use process.env for your Stripe secret

// This is the handler function that Vercel will call
module.exports = async (req, res) => {
    console.log("Stripe Secret Key:", process.env.STRIPE_SECRET_KEY); // Log secret key for debugging
    console.log('Request Method:', req.method);
    console.log('Request Body:', req.body);

    if (req.method === 'POST') {
        const { amount, currency, email, providerEmail, serviceOffered } = req.body;

        try {
            // Calculate commission (15%)
            const commissionRate = 0.15;
            const commissionAmount = Math.round(amount * commissionRate);
            const totalAmount = amount + commissionAmount; // Total amount including commission

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
                amount: totalAmount, // Using total amount including commission
                currency: currency,
                customer: customer.id,
                metadata: {
                    providerEmail: providerEmail,
                    serviceOffered: serviceOffered,
                    originalAmount: amount,
                    commissionAmount: commissionAmount,
                    commissionRate: `${commissionRate * 100}%`,
                    paymentDate: new Date().toISOString(),
                    paymentMethod: req.body.paymentMethod || 'card',
                }
            });

            res.status(200).json({
                clientSecret: paymentIntent.client_secret,
                ephemeralKey: ephemeralKey.secret,
                customerId: customer.id,
                paymentId: paymentIntent.id,
                paymentMethod: paymentIntent.metadata.paymentMethod,
                paymentDate: paymentIntent.metadata.paymentDate,
                originalAmount: amount,
                commissionAmount: commissionAmount,
                totalAmount: totalAmount,
                currency: paymentIntent.currency,
                status: paymentIntent.status
            });

        } catch (err) {
            console.error('Error creating payment intent:', err);
            res.status(500).json({ error: err.message });
        }
    } else if (req.method === 'POST' && req.url.endsWith('/send-receipt')) {
        const { paymentId } = req.body;

        if (!paymentId) {
            return res.status(400).json({ 
                error: 'Payment ID is required' 
            });
        }

        try {
            // Retrieve the payment intent to get metadata
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);
            
            if (paymentIntent.status !== 'succeeded') {
                return res.status(400).json({ 
                    error: 'Cannot send receipt for incomplete payment' 
                });
            }

            const providerEmail = paymentIntent.metadata.providerEmail;
            if (!providerEmail) {
                return res.status(400).json({ 
                    error: 'Provider email not found in payment metadata' 
                });
            }

            // Create a receipt using Stripe's invoices
            const invoice = await stripe.invoices.create({
                customer: paymentIntent.customer,
                auto_advance: true,
                collection_method: 'send_invoice',
                metadata: paymentIntent.metadata,
                custom_fields: [
                    { name: 'Service', value: paymentIntent.metadata.serviceOffered },
                    { name: 'Original Amount', value: `${paymentIntent.metadata.originalAmount}` },
                    { name: 'Commission Amount', value: `${paymentIntent.metadata.commissionAmount}` },
                    { name: 'Commission Rate', value: paymentIntent.metadata.commissionRate }
                ]
            });

            await stripe.invoices.finalizeInvoice(invoice.id);

            // Send to provider's email specifically
            await stripe.invoices.sendInvoice(invoice.id, {
                email: providerEmail // Explicitly send to provider's email
            });

            res.status(200).json({ 
                message: 'Receipt sent successfully',
                invoiceId: invoice.id,
                sentTo: providerEmail,
                paymentDetails: {
                    originalAmount: paymentIntent.metadata.originalAmount,
                    commissionAmount: paymentIntent.metadata.commissionAmount,
                    totalAmount: paymentIntent.amount,
                    serviceOffered: paymentIntent.metadata.serviceOffered,
                    paymentDate: paymentIntent.metadata.paymentDate
                }
            });

        } catch (err) {
            console.error('Error sending receipt:', err);
            res.status(500).json({ error: err.message });
        }
    } else {
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
};
