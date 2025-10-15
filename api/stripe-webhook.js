/* * Serverless funkcija: /api/stripe-webhook
 * TVARKO: 
 * 1. Gauna POST užklausas iš Stripe po įvykių.
 * 2. Tikrina sesijos parašą saugumui.
 * 3. Po sėkmingo mokėjimo (checkout.session.completed) atnaujina Supabase kvotą.
 *
 * REIKALINGI ENV KINTAMIEJI:
 * - STRIPE_SECRET_KEY
 * - STRIPE_WEBHOOK_SECRET (Sukuriamas Stripe platformoje)
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
*/

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Inicializuojame Stripe su slaptuoju raktu
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2020-08-27',
});

// Inicializuojame Supabase su Service Role Key (leidžia atnaujinti bet kokius duomenis)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
);

// Naudotojo kvotos dydis
const MESSAGES_TO_ADD = 20;

// Reikia rankiniu būdu išjungti body parser, kad gautume RAW kūną, reikalingą Stripe parašo tikrinimui
export const config = {
    api: {
        bodyParser: false,
    },
};

// Funkcija RAW kūno gavimui
const buffer = (req) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => {
            chunks.push(chunk);
        });
        req.on('end', () => {
            resolve(Buffer.concat(chunks));
        });
        req.on('error', reject);
    });
};


export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const rawBody = await buffer(req);
    const signature = req.headers['stripe-signature'];
    
    // Webhook slaptasis raktas, sukurtas Stripe platformoje (labai svarbus saugumui)
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        // === 1. TIKRINAME STRIPE PARAŠĄ ===
        event = stripe.webhooks.constructEvent(
            rawBody,
            signature,
            webhookSecret
        );
    } catch (err) {
        // Jei parašas netinkamas, grąžiname 400 klaidą
        console.error(`❌ Webhook klaida: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // === 2. APDOROJAME SĖKMINGO MOKĖJIMO ĮVYKĮ ===
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const userId = session.metadata.user_id;

        if (!userId) {
            console.error('❌ Sesijoje nerastas user_id. Kvota nepridėta.');
            return res.status(400).json({ received: true, message: 'User ID missing in metadata.' });
        }

        try {
            // Randame esamą kvotą
            const { data: currentQuota, error: fetchError } = await supabase
                .from('user_quotas')
                .select('remaining_messages')
                .eq('user_id', userId)
                .single();

            const currentRemaining = currentQuota ? currentQuota.remaining_messages : 0;
            const newRemaining = currentRemaining + MESSAGES_TO_ADD;

            // Atnaujiname arba įterpiame naują kvotos įrašą
            const { error: updateError } = await supabase
                .from('user_quotas')
                .upsert(
                    { user_id: userId, remaining_messages: newRemaining },
                    { onConflict: 'user_id' } // Atnaujinti, jei user_id jau egzistuoja
                );

            if (updateError) {
                console.error('❌ Supabase kvotos atnaujinimo klaida:', updateError);
                return res.status(500).json({ received: true, message: 'Database update failed.' });
            }

            console.log(`✅ Kvota atnaujinta. Vartotojui ${userId} pridėta ${MESSAGES_TO_ADD} žinučių.`);
            
        } catch (dbError) {
            console.error('❌ Fatal Database Error:', dbError);
            return res.status(500).json({ received: true, message: 'Internal Database Error.' });
        }
    } 
    
    // Visiems kitiems įvykiams (pvz., apmokėjimas nepavyko) tiesiog grąžiname OK
    res.status(200).json({ received: true });
}
