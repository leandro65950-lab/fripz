// api/analyze.js
// Fonction serverless Vercel (CommonJS) : reçoit jusqu'à 3 photos d'un article,
// appelle Gemini Vision (Gemini 3 Flash), et renvoie
// categorie / marque / couleur / taille / etat / titre / description.
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
    // Selon le runtime, req.body peut arriver en texte : on parse au besoin.
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }

    // On accepte { images: [...] } (jusqu'à 3 photos) ou { image: ... } (compat).
    let images = [];
    if (Array.isArray(body && body.images)) {
      images = body.images;
    } else if (body && body.image) {
      images = [body.image];
    }
    images = images
      .filter(function (x) { return typeof x === 'string' && x.length > 0; })
      .slice(0, 3);

    if (images.length === 0) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    // Chaque photo -> un bloc inline_data pour Gemini.
    const imageParts = images.map(function (img) {
      const base64Data = img.includes(',') ? img.split(',')[1] : img;
      return { inline_data: { mime_type: 'image/jpeg', data: base64Data } };
    });

    // Instruction donnée à Gemini : répondre en JSON strict.
    const prompt =
      'Tu es un expert en articles de seconde main pour une marketplace française nommée Fripz.\n' +
      'Tu reçois ' + images.length + ' photo(s) du MÊME article (par ex. face, dos, étiquette). Analyse-les ensemble.\n' +
      'Sers-toi de la photo de l\'étiquette si présente pour déterminer la marque et la taille.\n' +
      'Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans backticks.\n' +
      'Format exact attendu :\n' +
      '{\n' +
      '  "categorie": "une de: Femmes, Hommes, Enfants, Maison & Déco, Tech, Loisirs, Divertissement, Sport",\n' +
      '  "marque": "la marque si identifiable, sinon \'Sans marque\'",\n' +
      '  "couleur": "la couleur principale en français",\n' +
      '  "taille": "la taille si une étiquette est visible ou identifiable (ex: S, M, L, XL, 38, 40, T2...), sinon \'Non précisée\'",\n' +
      '  "etat": "une de: Neuf avec étiquette, Très bon état, Bon état, Satisfaisant",\n' +
      '  "titre": "un titre d\'annonce court et accrocheur en français (max 60 caractères)",\n' +
      '  "description": "une description vendeuse de 2-3 phrases en français"\n' +
      '}';

    // Modèle : Gemini 3 Flash (intelligence niveau Pro à prix Flash).
    // Nom API exact = gemini-3-flash-preview (sinon erreur 404).
    const MODEL = 'gemini-3-flash-preview';
    const geminiUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL +
      ':generateContent?key=' + apiKey;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }].concat(imageParts)
        }],
        generationConfig: {
          // Force une sortie JSON propre, sans backticks ni blabla.
          responseMimeType: 'application/json',
          // Réflexion légère : assez pour bien analyser, rapide et économique.
          thinkingConfig: { thinkingLevel: 'low' }
        }
      })
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      return res.status(502).json({ error: 'Erreur Gemini', details: errText });
    }

    const data = await geminiResponse.json();

    // Extraire le texte renvoyé (1re "part" qui contient du texte).
    const parts = (data && data.candidates && data.candidates[0] &&
                   data.candidates[0].content && data.candidates[0].content.parts) || [];
    let text = '';
    for (const p of parts) {
      if (p && typeof p.text === 'string' && p.text.trim()) { text = p.text; break; }
    }
    if (!text) {
      return res.status(502).json({ error: 'Réponse Gemini vide', details: JSON.stringify(data).slice(0, 500) });
    }

    // Sécurité : retirer d'éventuels backticks malgré la consigne.
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
