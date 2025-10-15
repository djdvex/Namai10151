// Tai yra Vercel Serverless funkcija.
// Ji veiks serveryje (backend) ir galės saugiai naudoti jūsų API raktą,
// paimtą iš aplinkos kintamojo (Environment Variable).

// API rakto nuoroda: Aplinkos kintamasis Vercel'e
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent";

// Eksponentinis atsitraukimas (Exponential Backoff)
async function fetchWithRetry(url, options, maxRetries = 5, delay = 1000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return await response.json();
            }

            // Jei klaida yra susijusi su per dideliu užklausų skaičiumi (429) arba serverio klaida (5xx), bandoma iš naujo
            if (response.status === 429 || response.status >= 500) {
                console.error(`Attempt ${i + 1}: Server API error ${response.status}. Retrying...`);
                throw new Error(`API Klaida: ${response.status} - ${await response.text()}`);
            }
            
            // Kitos klaidos (pvz., 400 Bad Request) nėra pakartotinai bandomos
            const errorData = await response.json();
            throw new Error(errorData.error.message || `Klaida: ${response.status}`);

        } catch (error) {
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // Eksponentinis atsitraukimas
            } else {
                throw error; // Paskutinis bandymas nepavyko
            }
        }
    }
}


// Pagrindinė Vercel funkcija
export default async function handler(req, res) {
    // Patikrinti HTTP metodą
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Tik POST metodas leidžiamas' });
    }

    // Patikrinti API raktą
    if (!GEMINI_API_KEY) {
        // Tai reiškia, kad GEMINI_API_KEY nėra nustatytas Vercel aplinkos kintamuosiuose
        console.error('GEMINI_API_KEY nėra nustatytas Vercel ENV kintamuosiuose.');
        return res.status(500).json({ error: 'Trūksta API rakto. Nustatykite GEMINI_API_KEY Vercel ENV kintamuosiuose.' });
    }

    try {
        const { prompt, systemInstruction } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Trūksta užklausos (prompt).' });
        }

        // Sukurti Gemini API užklausos turinį
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            // Įjungti Google Search įrankį
            tools: [{ "google_search": {} }],
        };

        // Pridėti Sistemos instrukciją, jei ji pateikta
        if (systemInstruction) {
            payload.systemInstruction = {
                parts: [{ text: systemInstruction }]
            };
        }

        const urlWithKey = `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`;
        
        // Kviesti Gemini API su saugiu raktu
        const result = await fetchWithRetry(urlWithKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const candidate = result.candidates?.[0];

        if (candidate && candidate.content?.parts?.[0]?.text) {
            const text = candidate.content.parts[0].text;
            
            // Išgauti šaltinius
            let sources = [];
            const groundingMetadata = candidate.groundingMetadata;
            if (groundingMetadata && groundingMetadata.groundingAttributions) {
                sources = groundingMetadata.groundingAttributions
                    .map(attribution => ({
                        uri: attribution.web?.uri,
                        title: attribution.web?.title,
                    }))
                    .filter(source => source.uri && source.title); 
            }

            // Grąžinti atsakymą į naršyklę
            return res.status(200).json({ 
                text: text, 
                sources: sources 
            });

        } else {
            // Klaida, jei Gemini API negrąžino teksto
            return res.status(500).json({ error: 'Gemini API negrąžino tinkamo turinio.', debug: result });
        }

    } catch (error) {
        console.error('Klaida serverless funkcijoje:', error.message);
        return res.status(500).json({ error: `Serverio klaida: ${error.message}` });
    }
}
