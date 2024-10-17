const dotenv = require('dotenv'); // Load dotenv at the top
dotenv.config(); // Load the environment variables

const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Use process.env to access the key

const app = express();

app.use(cors());
app.use(express.json()); // To parse JSON bodies

// Create a PaymentIntent
app.post('/create-payment-intent', async (req, res) => {
    console.log('Received request:', req.body); // Log request body
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
