const dotenv = require('dotenv'); // Load dotenv at the top
dotenv.config(); // Load environment variables from .env

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Use process.env for your Stripe secret

// This is the handler function that Vercel will call
module.exports = async (req, res) => {
    console.log('Request Method:', req.method);
    console.log('Request Body:', req.body); // Log request body for debugging, but be cautious with sensitive information

    if (req.method === 'POST') {
        // Handle the POST request
        console.log('Received request:', req.body); // Log request for debugging
        const { amount, currency } = req.body;

        try {
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: currency,
            });
            console.log('Payment Intent created successfully:', paymentIntent.id); // Log successful creation of payment intent
            
            res.status(200).json({
                clientSecret: paymentIntent.client_secret,
            });
        } catch (err) {
            console.error('Error creating payment intent:', err); // Log the error for debugging
            res.status(500).json({ error: err.message });
        }
    } else {
        // Handle any other HTTP method (GET, etc.)
        res.setHeader('Allow', ['POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
};
