// chat.js - Tvarko Gemini turinio generavimą ir kvotos valdymą.

// Reikalingi kintamieji Vercel aplinkoje: 
// GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// Inicializuojame klientus naudodami aplinkos kintamuosius
const gemini = new GoogleGenAI(process.env.GEMINI_API_KEY);

// NAUDOJAMAS SUPABASE ADMIN KLIENTAS, NES REIKALINGOS RAŠYMO TEISĖS
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { prompt, systemInstruction, supabaseToken } = req.body;

    if (!prompt || !supabaseToken) {
        return res.status(400).json({ error: 'Missing prompt or authentication token.' });
    }
    
    // 1. Patvirtinimas ir vartotojo ID gavimas iš JWT
    let userId;
    try {
        // Naudojamas Service Role Key gauti vartotojo duomenims iš Front-end token'o
        const { data: { user } } = await supabaseAdmin.auth.getUser(supabaseToken);
        userId = user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Invalid or expired user token.' });
        }
    } catch (error) {
        console.error('JWT validation error:', error);
        return res.status(401).json({ error: 'Authentication failed.' });
    }

    // 2. Kvotos patikrinimas
    let remainingMessages;
    try {
        const { data: quotaData, error: quotaError } = await supabaseAdmin
            .from('user_quotas')
            .select('remaining_messages')
            .eq('user_id', userId)
            .single();

        remainingMessages = quotaData?.remaining_messages || 0;

        if (remainingMessages <= 0) {
            return res.status(403).json({ error: 'Quota exceeded. Please buy more messages.', remaining: 0 });
        }
    } catch (error) {
        console.error('Quota check error:', error);
        return res.status(500).json({ error: 'Internal server error during quota check.' });
    }

    // 3. Generuojame turinį su Gemini
    let generatedText = '';
    try {
        const response = await gemini.models.generateContent({
            model: "gemini-2.5-flash-preview-05-20",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                systemInstruction: { parts: [{ text: systemInstruction }] },
                tools: [{ google_search: {} }],
            }
        });
        generatedText = response.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';

    } catch (error) {
        console.error('Gemini API Error:', error.message);
        // Negrąžiname kvotos klaidos atveju
        return res.status(500).json({ error: 'Gemini API Error: ' + error.message, remaining: remainingMessages });
    }

    // 4. Kvotos sumažinimas (tik sėkmingai sugeneravus)
    try {
        remainingMessages -= 1;
        // Naudojame .update() vietoj .insert(), kad atnaujintume esamą kvotą
        await supabaseAdmin
            .from('user_quotas')
            .update({ remaining_messages: remainingMessages })
            .eq('user_id', userId);

    } catch (error) {
        console.error('Quota decrement error:', error);
        // Klaida sumažinant kvotą vis tiek leidžia grąžinti tekstą
    }

    // 5. Sėkmingas atsakymas
    res.status(200).json({ 
        text: generatedText,
        remaining: remainingMessages
    });
}
