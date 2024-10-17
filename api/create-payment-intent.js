const dotenv = require('dotenv'); // Load dotenv at the top
dotenv.config(); // Load environment variables from .env

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Use process.env for your Stripe secret

// This is the handler function that Vercel will call
module.exports = async (req, res) => {
    console.log("Stripe Secret Key:", process.env.STRIPE_SECRET_KEY); // Log secret key for debugging
    console.log('Request Method:', req.method);
    console.log('Request Body:', req.body);

    if (req.method === 'POST') {
        // Handle the POST request
        console.log('Received request:', req.body); // Log request for debugging
        const { amount, currency } = req.body;
        try {
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: currency,
            });
            res.status(200).json({
                clientSecret: paymentIntent.client_secret,
            });
        } catch (err) {
            console.error('Error creating payment intent:', err);
            res.status(500).json({ error: err.message });
        }
    } else {
        // Handle any other HTTP method (GET, etc.)
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
};
