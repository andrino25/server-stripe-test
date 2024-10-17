const dotenv = require('dotenv'); // Load dotenv at the top
dotenv.config(); // Load the environment variables

const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Use the key after loading dotenv

const app = express();

app.use(cors());
app.use(express.json()); // To parse JSON bodies

// Create a PaymentIntent
app.post('/api/create-payment-intent', async (req, res) => {
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
        res.status(500).json({ error: err.message });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
