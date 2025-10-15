// api/chat.js - Tvarko Gemini turinio generavimą, kvotos valdymą ir autentiacijos patikrą.

import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// Patikrinkite, ar API raktas yra prieinamas.
if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set.");
}

// TURI NAUDOTI TIK GEMINI_API_KEY
const gemini = new GoogleGenAI(process.env.GEMINI_API_KEY);

// Supabase Admin klientas (reikalingas kvotos mažinimui ir JWT patikrinimui)
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { prompt, systemInstruction, supabaseToken } = req.body;

    // Patikra: Ar perduotas žetonas iš Front-end?
    if (!supabaseToken) {
        return res.status(401).json({ error: 'Authentication required. Please log in first.' });
    }

    // 1. Patvirtinimas ir vartotojo ID gavimas iš JWT
    let userId;
    try {
        // Tikrinama, ar tokenas yra tinkamas (tai patvirtina, kad vartotojas prisijungęs)
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(supabaseToken);
        
        if (authError) {
             console.error('JWT validation error:', authError.message);
             return res.status(401).json({ error: 'Authentication failed: Invalid token.', details: authError.message });
        }

        userId = user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Authentication failed: User ID not found in token.' });
        }
    } catch (error) {
        console.error('JWT processing error:', error);
        return res.status(401).json({ error: 'Internal token processing error.' });
    }

    // 2. Kvotos patikrinimas
    let remainingMessages;
    try {
        const { data: quotaData, error: quotaError } = await supabaseAdmin
            .from('user_quotas')
            .select('remaining_messages')
            .eq('user_id', userId)
            .single();

        if (quotaError) {
             // Tai gali reikšti, kad vartotojas dar neturi kvotos įrašo
             remainingMessages = 0;
        } else {
             remainingMessages = quotaData?.remaining_messages || 0;
        }

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
        // Svarbu: grąžiname klaidos pranešimą, bet neleidžiame sumažinti kvotos
        return res.status(500).json({ error: 'Gemini API Error: ' + error.message, remaining: remainingMessages });
    }

    // 4. Kvotos sumažinimas (tik sėkmingai sugeneravus)
    try {
        remainingMessages -= 1;
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
