// api/create-checkout-session.js - Sukuria Stripe Checkout sesiją kvotos pirkimui.

// Reikalingi aplinkos kintamieji:
// - STRIPE_SECRET_KEY
// - VITE_STRIPE_PRICE_PREMIUM (naudojamas čia)
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Inicializuojame Stripe su Secret Key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Supabase Admin klientas (naudojamas tik vartotojo atpažinimui)
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Jūsų Stripe kainos ID (patikrinkite, ar jis teisingas!)
// Šis kintamasis yra Vercel nustatymuose, bet jį naudojame čia tiesiogiai.
const PRODUCT_PRICE_ID = process.env.VITE_STRIPE_PRICE_PREMIUM;

// Jūsų programos URL, kuris bus naudojamas sėkmingam ir atšauktam mokėjimui
const HOST_URL = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : 'http://localhost:3000'; // Pakeiskite į savo lokalią aplinką, jei testuojate

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { supabaseToken } = req.body;

    // Patikrinimas: Ar perduotas žetonas iš Front-end?
    if (!supabaseToken) {
        return res.status(401).json({ error: 'Authentication required. Please log in first.' });
    }

    let userId;
    let userEmail;
    try {
        // Patikriname vartotojo autentifikaciją
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(supabaseToken);
        
        if (authError || !user) {
             return res.status(401).json({ error: 'Authentication failed: Invalid token.' });
        }

        userId = user.id;
        userEmail = user.email;

    } catch (error) {
        console.error('JWT processing error:', error);
        return res.status(401).json({ error: 'Internal token processing error.' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: PRODUCT_PRICE_ID,
                    quantity: 1,
                },
            ],
            mode: 'payment',
            // Sukuriame unikalius Stripe kliento metaduomenis (būtina webhook'ui!)
            metadata: {
                user_id: userId,
            },
            // Nurodome vartotojo el. paštą apmokėjimui
            customer_email: userEmail, 
            success_url: `${HOST_URL}/?success=true`,
            cancel_url: `${HOST_URL}/?canceled=true`,
        });

        // Grąžiname Stripe sesijos URL
        res.status(200).json({ url: session.url });

    } catch (error) {
        console.error('Stripe Checkout Error:', error.message);
        // Pranešame klaidos tipą atgal į Front-end
        res.status(500).json({ 
            error: 'Failed to create Stripe Checkout session.',
            details: error.message 
        });
    }
}
