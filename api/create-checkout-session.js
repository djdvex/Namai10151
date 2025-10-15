/* * Serverless funkcija: /api/create-checkout-session
 * TVARKO: 
 * 1. Sukuria naują Stripe apmokėjimo sesiją.
 * 2. Peradresuoja naudotoją į Stripe apmokėjimo puslapį.
 *
 * REIKALINGI ENV KINTAMIEJI:
 * - STRIPE_SECRET_KEY (Slaptasis raktas, prasideda sk_...)
 * - SUPABASE_URL (Naudojamas kaip sėkmės/atšaukimo nukreipimas)
 *
 * SVARBU: Reikia rankiniu būdu nustatyti 'priceId' su jūsų Stripe produkto ID.
*/

import Stripe from 'stripe';

// Stripe inicijuojamas naudojant slaptąjį raktą iš aplinkos kintamųjų.
// Jį turite nustatyti Vercel'e kaip STRIPE_SECRET_KEY
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2020-08-27',
});

// PAKEISTI: Šį ID turite pakeisti savo Stripe produkto/kainos ID!
const priceId = 'price_1P8c7fRZ2qJz4j0lKxR4gKzG'; // Pavyzdys: 20 žinučių paketas

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Gauname user_id iš kliento. Šis ID bus naudojamas Stripe Webhook'e.
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'Missing user identifier for checkout.' });
    }

    try {
        // Naudojame SUPABASE_URL kaip bazinę nuorodą (pvz., https://dinamai1015.vercel.app)
        const baseUrl = process.env.SUPABASE_URL.replace(/(\.co|\.app).*$/, '$1') // Šaliname portą, jei jis yra lokalus
        const successUrl = `${req.headers.origin}/?session_id={CHECKOUT_SESSION_ID}&success=true`;
        const cancelUrl = `${req.headers.origin}/?canceled=true`;
        
        // Saugiau naudoti tikrąjį domeno URL
        // const successUrl = `${baseUrl}/?session_id={CHECKOUT_SESSION_ID}&success=true`;
        // const cancelUrl = `${baseUrl}/?canceled=true`;


        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: successUrl,
            cancel_url: cancelUrl,
            
            // Perduodame vartotojo ID į Stripe sesiją. Jį Webhook'as naudos kvotos pridėjimui.
            metadata: {
                user_id: userId,
                package: '20_MESSAGES' 
            },

            // Pasirenkamas: jei vartotojas prisijungęs per el. paštą, Stripe gali jį užpildyti automatiškai.
            // customer_email: 'vartotojo@email.com', 
        });

        // Sėkmingai sukurta sesija, grąžiname URL, kad nukreiptume naudotoją į Stripe
        res.status(200).json({ url: session.url });

    } catch (error) {
        console.error('Stripe Checkout Creation Error:', error);
        res.status(500).json({ error: 'Could not create Stripe checkout session.', details: error.message });
    }
}

