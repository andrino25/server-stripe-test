const dotenv = require('dotenv');
dotenv.config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const handler = async (req, res) => {
    if (req.method === 'POST') {
        console.log('Received request:', req.body);
        const { amount, currency } = req.body;
        try {
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: currency,
            });
            res.status(200).json({ clientSecret: paymentIntent.client_secret });
        } catch (err) {
            console.error('Error creating payment intent:', err);
            res.status(500).json({ error: err.message });
        }
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
};

export default handler;
