const dotenv = require('dotenv');
dotenv.config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, onChildChanged, get, update } = require('firebase/database');
const PDFDocument = require('pdfkit');
const path = require('path');
const nodemailer = require('nodemailer');
const axios = require('axios');

// Your Firebase configuration
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Reference to bookings
const bookingsRef = ref(database, 'bookings');

// Initialize nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

async function generateReceipt(paymentIntent, isProvider = false) {
    return new Promise(async (resolve, reject) => {
        try {
            const doc = new PDFDocument({
                size: 'A4',
                margin: 50
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));

            // Fetch image from Google Drive
            try {
                const imageUrl = 'https://drive.google.com/uc?export=view&id=1ne2-uU0H9W3OZTSymeO8nMbiZPc_Fhd4';
                const response = await axios.get(imageUrl, {
                    responseType: 'arraybuffer'
                });
                
                // Add the image to the PDF
                doc.image(response.data, 50, 45, { width: 150 })
                   .moveDown();
            } catch (imageError) {
                console.error('❌ Error loading logo:', imageError);
                // Continue without logo if there's an error
                doc.moveDown(2);
            }

            // Add receipt header
            doc.fontSize(20)
               .text('PAYMENT RECEIPT', { align: 'center' })
               .moveDown();

            // Add horizontal line
            doc.moveTo(50, 160)
               .lineTo(550, 160)
               .stroke()
               .moveDown();

            // Receipt details in a more structured format
            doc.fontSize(12);

            // Left column
            const leftX = 50;
            const rightX = 300;
            
            doc.text('Receipt Details:', leftX, 180, { bold: true })
               .moveDown(0.5);
            
            doc.text(`Receipt No: ${paymentIntent.id}`, leftX)
               .moveDown(0.5);
            
            doc.text(`Date: ${new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })}`, leftX)
               .moveDown(0.5);

            doc.text(`Payment Status: Successful`, leftX)
               .moveDown(2);

            // Service details
            doc.text('Service Details:', leftX, doc.y, { bold: true })
               .moveDown(0.5);
            
            doc.text(`Service: ${paymentIntent.metadata.serviceOffered || 'Service'}`, leftX)
               .moveDown(0.5);
            
            doc.text(`Provider: ${paymentIntent.metadata.providerEmail || 'Provider'}`, leftX)
               .moveDown(0.5);

            doc.text(`Client: ${paymentIntent.customer?.email || 'Client'}`, leftX)
               .moveDown(0.5);

            // Payment details in a box
            doc.rect(50, doc.y, 500, 100).stroke();
            const paymentY = doc.y + 20;

            doc.text('Payment Details:', leftX + 10, paymentY, { bold: true })
               .moveDown(0.5);

            // Different amount label and value based on recipient
            if (isProvider) {
                doc.text(`Amount Received: PHP ${paymentIntent.metadata.providerReceievedPHP || (paymentIntent.amount / 100)}`, leftX + 10)
                   .moveDown(0.5);
            } else {
                doc.text(`Amount Paid: PHP ${paymentIntent.metadata.totalAmountPHP || (paymentIntent.amount / 100)}`, leftX + 10)
                   .moveDown(0.5);
            }

            doc.text(`Payment Date: ${paymentIntent.metadata.paymentDate || new Date().toISOString()}`, leftX + 10)
               .moveDown(0.5);

            doc.text(`Payment Method: Credit Card`, leftX + 10)
               .moveDown(0.5);

            // Footer
            doc.fontSize(10)
               .text('Thank you for your business!', { align: 'center' })
               .moveDown(0.5);
            
            doc.text('For any questions, please contact peopleconnect@company.com', { align: 'center' })
               .moveDown(0.5);

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

async function sendReceipt(paymentId) {
    console.log('🟡 Starting receipt process for payment:', paymentId);
    try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentId, {
            expand: ['customer']
        });
        
        console.log('📌 Retrieved payment intent:', {
            status: paymentIntent.status,
            providerEmail: paymentIntent.metadata.providerEmail,
            customerEmail: paymentIntent.customer?.email,
            amount: paymentIntent.amount
        });

        if (paymentIntent.status !== 'succeeded') {
            console.log('❌ Payment not succeeded:', paymentId);
            return false;
        }

        const providerEmail = paymentIntent.metadata.providerEmail;
        const customerEmail = paymentIntent.customer?.email;

        if (!providerEmail || !customerEmail) {
            console.log('❌ Missing email addresses:', { providerEmail, customerEmail });
            return false;
        }

        // Generate two different PDF receipts
        console.log('🟡 Generating receipt PDFs...');
        const customerPdfBuffer = await generateReceipt(paymentIntent, false);
        const providerPdfBuffer = await generateReceipt(paymentIntent, true);

        // Send email to both provider and customer
        console.log('🟡 Sending receipt emails...');
        await Promise.all([
            // Send to provider with provider receipt
            transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: providerEmail,
                subject: 'Payment Receipt',
                text: `Thank you for providing your service. Please find your payment receipt attached.`,
                attachments: [{
                    filename: 'receipt.pdf',
                    content: providerPdfBuffer,
                    contentType: 'application/pdf'
                }]
            }),
            // Send to customer with customer receipt
            transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: customerEmail,
                subject: 'Payment Receipt',
                text: `Thank you for using our service. Please find your payment receipt attached.`,
                attachments: [{
                    filename: 'receipt.pdf',
                    content: customerPdfBuffer,
                    contentType: 'application/pdf'
                }]
            })
        ]);

        console.log('✅ Receipt sent successfully to:', { providerEmail, customerEmail });
        return true;
    } catch (err) {
        console.error('❌ Error sending receipt:', err);
        return false;
    }
}

// Scan all bookings function
async function scanBookings() {
    try {
        console.log('🔍 Starting booking scan...');
        const snapshot = await get(ref(database, 'bookings'));
        const bookings = snapshot.val();
        
        if (!bookings) {
            console.log('ℹ️ No bookings found');
            return;
        }

        console.log(`📦 Found ${Object.keys(bookings).length} total bookings`);

        for (const [bookingId, booking] of Object.entries(bookings)) {
            console.log(`\n🔍 Checking booking: ${bookingId}`);
            
            if (booking.bookingStatus === 'Completed' && 
                booking.bookingPaymentId && 
                !booking.receiptSent) {
                
                console.log('🟢 Processing completed booking:', bookingId);
                const sent = await sendReceipt(booking.bookingPaymentId);
                
                if (sent) {
                    const bookingRef = ref(database, `bookings/${bookingId}`);
                    await update(bookingRef, {
                        receiptSent: true,
                        receiptSentDate: new Date().toISOString()
                    });
                    console.log('✅ Receipt sent and booking updated:', bookingId);
                }
            }
        }
        
        console.log('\n✅ Scan completed');
    } catch (err) {
        console.error('❌ Error scanning bookings:', err);
    }
}

// Simplified API endpoint for manual scanning
module.exports = async (req, res) => {
    if (req.method === 'GET') {
        try {
            console.log('🔍 Starting manual booking scan...');
            await scanBookings();
            return res.status(200).json({ 
                message: 'Scan completed successfully' 
            });
        } catch (err) {
            console.error('❌ Error during scan:', err);
            return res.status(500).json({ 
                error: 'Failed to scan bookings',
                details: err.message 
            });
        }
    }
    return res.status(405).json({ error: 'Method not allowed' });
};