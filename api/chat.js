
Štai **`api/chat.js`** kodas kaip **paprastas tekstas** (tikrai nesutrumpinsiu!):

---

## 2. Serverless funkcija: `api/chat.js` (Pilnas tekstas)

Šį kodą išsaugokite kaip **`api/chat.js`** aplanke **`api/`**.

```javascript
/* * Serverless funkcija: /api/chat
 * TVARKO: 
 * 1. Naudotojo autentifikavimą per Supabase sesijos žetoną.
 * 2. Kvotos (remaining_messages) patikrinimą ir atėmimą Supabase duombazėje.
 * 3. Gemini API kvietimą su Google paieškos įrankiu (grounding).
 *
 * REIKALINGI ENV KINTAMIEJI:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY (slaptasis)
 * - GEMINI_API_KEY
*/

import { createClient } from '@supabase/supabase-js';

// Vercel naudoja modulį 'node-fetch', tad importuojame jį.
import fetch from 'node-fetch'; 

// Konfigūracija
const GEMINI_API_URL = '[https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent](https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent)';
const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20';

// Inicijuojame Supabase su Service Role Key (tik Serverless aplinkoje)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
);

export default async function handler(req, res) {
    // Tikriname HTTP metodą
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { prompt, systemInstruction, supabaseToken } = req.body;

    if (!prompt || !supabaseToken) {
        return res.status(400).json({ error: 'Missing prompt or authentication token.' });
    }

    let userId = null;

    try {
        // === 1. AUTENTIFIKACIJA PER SUPABASE (SERVISE ROLE KEY) ===
        // Naudojame 'service_role' raktą, kad patikrintume žetoną be prisijungimo per jį.
        // Ši funkcija yra saugiausias būdas nustatyti vartotojo ID serveryje.
        const { data: userData, error: authError } = await supabase.auth.getUser(supabaseToken);

        if (authError || !userData.user) {
            console.error('Supabase Auth Error:', authError ? authError.message : 'User not found');
            return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
        }

        userId = userData.user.id;

        // === 2. KVOTOS PATIKRINIMAS SUPABASE ===
        const { data: quotaData, error: quotaError } = await supabase
            .from('user_quotas')
            .select('remaining_messages')
            .eq('user_id', userId)
            .single();

        if (quotaError && quotaError.code !== 'PGRST116') { // PGRST116 reiškia, kad eilutė nerasta (naujas vartotojas)
            console.error('Quota Fetch Error:', quotaError);
            return res.status(500).json({ error: 'Could not check quota in database.' });
        }

        const remainingMessages = quotaData ? quotaData.remaining_messages : 0;
        
        // Patikriname, ar kvota yra pakankama (daugiau nei 0)
        if (remainingMessages <= 0) {
            return res.status(403).json({ 
                error: 'Quota exceeded. Please buy more messages.', 
                remaining: 0
            });
        }

        // === 3. GEMINI API KVETIMAS ===
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
             return res.status(500).json({ error: 'Server configuration error: Gemini API Key is missing.' });
        }

        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            
            // Įjungia Google Search (grounding)
            tools: [{ "google_search": {} }], 
            
            // Nustato Gemini persona (System Instruction)
            systemInstruction: {
                parts: [{ text: systemInstruction || "You are a helpful and professional assistant." }]
            },
        };

        // Rekomenduojama: naudojame tik 'gemini-2.5-flash-preview-05-20' modelį.
        const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

        const geminiResponse = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error('Gemini API Error:', errorText);
            return res.status(geminiResponse.status).json({ error: 'Gemini API call failed.', details: errorText });
        }

        const result = await geminiResponse.json();
        const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "Could not generate content.";
        
        // === 4. KVOTOS ATĖMIMAS SUPABASE ===
        const newRemaining = remainingMessages - 1;

        if (quotaData) {
            // Vartotojas jau yra duombazėje, atnaujiname likusias žinutes
            await supabase
                .from('user_quotas')
                .update({ remaining_messages: newRemaining })
                .eq('user_id', userId);
        } else {
            // Naujas vartotojas, įterpiame pradinius duomenis (pvz., jei duodate nemokamą startą)
            await supabase
                .from('user_quotas')
                .insert([{ user_id: userId, remaining_messages: newRemaining }]);
        }


        // Sėkmingas atsakas
        return res.status(200).json({ 
            text: generatedText, 
            remaining: newRemaining 
        });

    } catch (error) {
        console.error('Fatal Server Error:', error);
        return res.status(500).json({ error: 'Internal server error during processing.' });
    }
}


