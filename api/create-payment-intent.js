const dotenv = require('dotenv'); // Load dotenv at the top
dotenv.config(); // Load environment variables from .env

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Use process.env for your Stripe secret

// This is the handler function that Vercel will call
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        // Handle the POST request
        console.log('Received request:', req.body); // Log request for debugging
        const { amount, currency } = req.body;

        // Check if amount and currency are provided
        if (!amount || !currency) {
            return res.status(400).json({ error: 'Amount and currency are required.' });
        }

        try {
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: currency,
            });

            // Send a friendly response along with the clientSecret
            res.status(200).json({
                message: 'Payment intent created successfully!',
                clientSecret: paymentIntent.client_secret,
            });
        } catch (err) {
            console.error('Error creating payment intent:', err);
            res.status(500).json({ error: 'An error occurred while creating the payment intent. Please try again later.' });
        }
    } else {
        // Handle any other HTTP method (GET, etc.)
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
};
