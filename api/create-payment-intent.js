const dotenv = require('dotenv'); // Load dotenv at the top
dotenv.config(); // Load environment variables from .env

const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Use process.env for your Stripe secret

const app = express();

app.use(cors()); // Allow cross-origin requests
app.use(express.json()); // Parse incoming JSON requests

app.get('/', (req, res) => {
    res.send('Stripe Payment API is running!');
});

// Create a PaymentIntent
app.post('/create-payment-intent', async (req, res) => {
    console.log('Received request:', req.body); // Log request for debugging
    const { amount, currency } = req.body;
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: currency,
        });
        res.send({
            clientSecret: paymentIntent.client_secret,
        });
    } catch (err) {
        console.error('Error creating payment intent:', err);
        res.status(500).json({ error: err.message });
    }
});

// Start the server on localhost at port 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
