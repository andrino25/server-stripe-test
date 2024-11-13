const dotenv = require('dotenv'); // Load dotenv at the top
dotenv.config(); // Load environment variables from .env

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Use process.env for your Stripe secret

// This is the handler function that Vercel will call
module.exports = async (req, res) => {
    console.log("Stripe Secret Key:", process.env.STRIPE_SECRET_KEY); // Log secret key for debugging
    console.log('Request Method:', req.method);
    console.log('Request Body:', req.body);

    if (req.method === 'POST') {
        console.log('Received request:', req.body); // Log request for debugging
        
        // Destructure additional parameters
        const { amount, currency, email, providerEmail, serviceOffered, serviceAmount, commissionAmount, commissionRate } = req.body;

        try {
            // Create or retrieve a customer
            const customer = await stripe.customers.create({
                email: email // Use the email from the request body
            });

            // Create an ephemeral key for the customer
            const ephemeralKey = await stripe.ephemeralKeys.create(
                { customer: customer.id },
                { apiVersion: '2022-11-15' } // Specify the API version
            );

            // Create a payment intent with commission details in metadata
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: currency,
                customer: customer.id,
                metadata: {
                    providerEmail: providerEmail,
                    serviceOffered: serviceOffered,
                    serviceAmount: serviceAmount,
                    commissionAmount: commissionAmount,
                    commissionRate: `${commissionRate * 100}%`,
                    paymentDate: new Date().toISOString(), // Add payment date
                    paymentMethod: req.body.paymentMethod || 'card', // Add payment method
                }
            });

            // Respond with additional payment details
            res.status(200).json({
                clientSecret: paymentIntent.client_secret,
                ephemeralKey: ephemeralKey.secret,
                customerId: customer.id,
                paymentId: paymentIntent.id,
                paymentMethod: paymentIntent.metadata.paymentMethod,
                paymentDate: paymentIntent.metadata.paymentDate,
                amount: paymentIntent.amount,
                currency: paymentIntent.currency,
                status: paymentIntent.status
            });
        } catch (err) {
            console.error('Error creating payment intent:', err);
            res.status(500).json({ error: err.message });
        }
    } else {
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
};
