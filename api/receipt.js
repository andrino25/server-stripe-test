const dotenv = require('dotenv');
dotenv.config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { paymentId } = req.body;

    if (!paymentId) {
        return res.status(400).json({ error: 'Payment ID is required' });
    }

    try {
        // Get payment details
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);

        if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({ 
                error: 'Cannot send receipt for incomplete payment'
            });
        }

        const providerEmail = paymentIntent.metadata.providerEmail;
        if (!providerEmail) {
            return res.status(400).json({ 
                error: 'Provider email not found in metadata'
            });
        }

        // Create invoice with send_invoice collection method
        const invoice = await stripe.invoices.create({
            customer: paymentIntent.customer,
            collection_method: 'send_invoice',
            days_until_due: 30,
            custom_fields: [
                { name: 'Service', value: paymentIntent.metadata.serviceOffered || 'Service' },
                { name: 'Amount', value: `PHP ${paymentIntent.amount / 100}` }
            ]
        });

        // Finalize and send
        await stripe.invoices.finalizeInvoice(invoice.id);
        await stripe.invoices.sendInvoice(invoice.id);

        return res.status(200).json({ 
            message: 'Receipt sent successfully',
            sentTo: providerEmail
        });

    } catch (err) {
        console.error('Error:', err);
        return res.status(500).json({ error: err.message });
    }
};
