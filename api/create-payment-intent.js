const dotenv = require('dotenv');
dotenv.config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

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
};
