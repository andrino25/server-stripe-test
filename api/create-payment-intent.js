// api/create-payment-intent.js
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

    const { amount, currency, email, providerEmail, serviceOffered } = req.body;

    if (currency.toLowerCase() !== 'php') {
        return res.status(400).json({ 
            error: 'Only PHP currency is supported' 
        });
    }

    try {
        const amountInCentavos = Math.round(amount * 100);
        const commissionRate = 0.15;
        const commissionAmountCentavos = Math.round(amountInCentavos * commissionRate);
        const totalAmountCentavos = amountInCentavos + commissionAmountCentavos;

        const customer = await stripe.customers.create({ email: email });
        const ephemeralKey = await stripe.ephemeralKeys.create(
            { customer: customer.id },
            { apiVersion: '2022-11-15' }
        );

        const paymentIntent = await stripe.paymentIntents.create({
            amount: totalAmountCentavos,
            currency: 'php',
            customer: customer.id,
            metadata: {
                providerEmail: providerEmail,
                serviceOffered: serviceOffered,
                commissionAmount: commissionAmountCentavos,
                commissionRate: `${commissionRate * 100}%`,
                paymentDate: new Date().toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                }),
                paymentMethod: req.body.paymentMethod || 'card',
                originalAmountPHP: amount,
                providerReceievedPHP: amount - (amount * commissionRate),
                totalAmountPHP: amount + (amount * commissionRate)
            }            
        });

        res.status(200).json({
            clientSecret: paymentIntent.client_secret,
            ephemeralKey: ephemeralKey.secret,
            customerId: customer.id,
            providerEmail: paymentIntent.metadata.providerEmail,
            paymentId: paymentIntent.id,
            paymentMethod: paymentIntent.metadata.paymentMethod,
            paymentDate: paymentIntent.metadata.paymentDate,
            originalAmount: amount,
            totalAmount: amount + (amount * commissionRate),
            currency: 'php',
            status: paymentIntent.status
        });

    } catch (err) {
        console.error('Error creating payment intent:', err);
        res.status(500).json({ error: err.message });
    }
};
