// api/analyze.js
// Fonction serverless Vercel (CommonJS) : reçoit jusqu'à 3 photos d'un article
// + l'arborescence des catégories Fripz, appelle Gemini Vision (Gemini 3 Flash),
// et renvoie les champs de la fiche (catégorie / sous-catégorie / type / etc.).

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API manquante côté serveur' });

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }

    let images = [];
    if (Array.isArray(body && body.images)) images = body.images;
    else if (body && body.image) images = [body.image];
    images = images
      .filter(function (x) { return typeof x === 'string' && x.length > 0; })
      .slice(0, 3);

    if (images.length === 0) return res.status(400).json({ error: 'Aucune image fournie' });

    const imageParts = images.map(function (img) {
      const base64Data = img.includes(',') ? img.split(',')[1] : img;
      return { inline_data: { mime_type: 'image/jpeg', data: base64Data } };
    });

    // Arborescence catégories envoyée par le site (categorie -> sous-cat -> [types]).
    let taxonomyText = '';
    if (body && body.taxonomy && typeof body.taxonomy === 'object') {
      try { taxonomyText = JSON.stringify(body.taxonomy); } catch (e) { taxonomyText = ''; }
    }

    const taxoBlock = taxonomyText
      ? '\nVoici l\'arborescence EXACTE des catégories du site (format JSON : categorie -> sous_categorie -> [types]) :\n' +
        taxonomyText + '\n' +
        'Tu DOIS choisir "categorie", "sous_categorie" et "type_article" en recopiant EXACTEMENT les chaînes de cette arborescence ' +
        '(y compris les emojis présents dans les sous-catégories, ex: "👠 Chaussures"). ' +
        'Le type_article doit appartenir à la liste de la sous_categorie choisie. ' +
        'Si tu ne peux pas déterminer un niveau, laisse-le en chaîne vide "".\n'
      : '';

    const prompt =
      'Tu es un expert en articles de seconde main pour une marketplace française nommée Fripz.\n' +
      'Tu reçois ' + images.length + ' photo(s) du MÊME article (par ex. face, dos, étiquette). Analyse-les ensemble.\n' +
      'Sers-toi de la photo de l\'étiquette si présente pour déterminer la marque et la taille.\n' +
      taxoBlock +
      'Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans backticks.\n' +
      'Format exact attendu :\n' +
      '{\n' +
      '  "categorie": "une catégorie de l\'arborescence (Femmes, Hommes, Enfants, Sport, Maison, Électronique, Loisirs, Divertissement)",\n' +
      '  "sous_categorie": "la sous-catégorie EXACTE de l\'arborescence (avec emoji), ou """,\n' +
      '  "type_article": "le type EXACT dans la sous-catégorie choisie, ou """,\n' +
      '  "marque": "la marque si identifiable, sinon \'Sans marque\'",\n' +
      '  "couleur": "exactement une de: Noir, Blanc, Gris, Beige, Marron, Rouge, Rose, Orange, Jaune, Vert, Bleu, Bleu marine, Violet, Doré, Argenté, Multicolore",\n' +
      '  "taille": "la taille si une étiquette est visible (ex: S, M, L, XL, 38, 40...), sinon \'Non précisée\'",\n' +
      '  "etat": "exactement une de: Neuf avec étiquette, Neuf sans étiquette, Très bon état, Bon état, Satisfaisant",\n' +
      '  "titre": "un titre d\'annonce court et accrocheur en français (max 60 caractères)",\n' +
      '  "description": "une description vendeuse de 2-3 phrases en français"\n' +
      '}';

    const MODEL = 'gemini-2.5-flash';
    const geminiUrl =
      'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL +
      ':generateContent?key=' + apiKey;

    const geminiResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }].concat(imageParts) }],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();

    }

    const data = await geminiResponse.json();
    const parts = (data && data.candidates && data.candidates[0] &&
                   data.candidates[0].content && data.candidates[0].content.parts) || [];
    let text = '';
    for (const p of parts) {
      if (p && typeof p.text === 'string' && p.text.trim()) { text = p.text; break; }
    }
    if (!text) {
      return res.status(502).json({ error: 'Réponse Gemini vide', details: JSON.stringify(data).slice(0, 500) });
    }

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

module.exports.config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};
