// api/analyze.js
// Fonction serverless Vercel (syntaxe CommonJS) : reçoit une photo,
// appelle Gemini Vision, et renvoie catégorie / marque / couleur / état
// + titre / description.
// La clé GEMINI_API_KEY est lue depuis les variables d'environnement Vercel
// (JAMAIS écrite dans le code).

module.exports = async function handler(req, res) {
  // Autoriser uniquement POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Clé API manquante côté serveur' });
  }

  try {
    // Le front envoie { image: "data:image/jpeg;base64,XXXX", mimeType: "image/jpeg" }
    // Selon le runtime, req.body peut arriver en texte : on parse au besoin.
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const image = body && body.image;
    const mimeType = body && body.mimeType;
    if (!image) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    // Retirer le préfixe "data:image/...;base64," si présent
    const base64Data = image.includes(',') ? image.split(',')[1] : image;
    const mediaType = mimeType || 'image/jpeg';

    // Instruction donnée à Gemini : analyser l'article et répondre en JSON strict
    const prompt = 'Tu es un expert en articles de seconde main pour une marketplace française nommée Fripz.\n' +
      'Analyse la photo de cet article et réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans backticks.\n' +
      'Format exact attendu :\n' +
      '{\n' +
      '  "categorie": "une de: Femmes, Hommes, Enfants, Maison & Déco, Tech, Loisirs, Divertissement, Sport",\n' +
      '  "marque": "la marque si identifiable, sinon \'Sans marque\'",\n' +
      '  "couleur": "la couleur principale en français",\n' +
      '  "etat": "une de: Neuf avec étiquette, Très bon état, Bon état, Satisfaisant",\n' +
      '  "titre": "un titre d\'annonce court et accrocheur en français (max 60 caractères)",\n' +
      '  "description": "une description vendeuse de 2-3 phrases en français"\n' +
      '}';

    // Modèle à jour (gemini-1.5-flash est coupé depuis 2026 -> 404).
    const MODEL = 'gemini-2.5-flash';
    const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + apiKey;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mediaType, data: base64Data } }
          ]
        }],
        // Force une sortie JSON propre, sans backticks ni blabla.
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      return res.status(502).json({ error: 'Erreur Gemini', details: errText });
    }

    const data = await geminiResponse.json();

    // Extraire le texte renvoyé par Gemini (1re "part" contenant du texte).
    const parts = (data && data.candidates && data.candidates[0] &&
                   data.candidates[0].content && data.candidates[0].content.parts) || [];
    let text = '';
    for (const p of parts) {
      if (p && typeof p.text === 'string' && p.text.trim()) { text = p.text; break; }
    }
    if (!text) {
      return res.status(502).json({ error: 'Réponse Gemini vide', details: JSON.stringify(data).slice(0, 500) });
    }

    // Sécurité : retirer d'éventuels backticks ```json ... ``` malgré la consigne.
    const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (e) {
      return res.status(502).json({ error: 'JSON invalide renvoyé par Gemini', raw: cleaned.slice(0, 500) });
    }

    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur', details: String((err && err.message) || err) });
  }
};

// Permet de recevoir des images en base64 plus lourdes.
module.exports.config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};
