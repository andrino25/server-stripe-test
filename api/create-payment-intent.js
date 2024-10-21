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
        const { amount, currency, email, providerEmail, serviceOffered } = req.body;

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

            // Create a payment intent with additional metadata
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: currency, // Ensure this is set to 'php'
                customer: customer.id, // Link the payment intent with the customer
                metadata: {
                    providerEmail: providerEmail, // Store provider email
                    serviceOffered: serviceOffered // Store service offered
                }
            });

            // Respond with the client secret, ephemeral key, and customer ID
            res.status(200).json({
                clientSecret: paymentIntent.client_secret,
                ephemeralKey: ephemeralKey.secret, // Include ephemeral key
                customerId: customer.id // Include customer ID
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
