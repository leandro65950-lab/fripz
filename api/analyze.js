// api/analyze.js
// Fonction serverless Vercel : reçoit une photo, appelle Gemini Vision,
// et renvoie catégorie / marque / couleur / état + titre / description.
// La clé GEMINI_API_KEY est lue depuis les variables d'environnement Vercel
// (JAMAIS écrite dans le code).

export default async function handler(req, res) {
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
    const { image, mimeType } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'Aucune image fournie' });
    }

    // Retirer le préfixe "data:image/...;base64," si présent
    const base64Data = image.includes(',') ? image.split(',')[1] : image;
    const mediaType = mimeType || 'image/jpeg';

    // Instruction donnée à Gemini : analyser l'article et répondre en JSON strict
    const prompt = `Tu es un expert en articles de seconde main pour une marketplace française nommée Fripz.
Analyse la photo de cet article et réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans backticks.
Format exact attendu :
{
  "categorie": "une de: Femmes, Hommes, Enfants, Maison & Déco, Tech, Loisirs, Divertissement, Sport",
  "marque": "la marque si identifiable, sinon 'Sans marque'",
  "couleur": "la couleur principale en français",
  "etat": "une de: Neuf avec étiquette, Très bon état, Bon état, Satisfaisant",
  "titre": "un titre d'annonce court et accrocheur en français (max 60 caractères)",
  "description": "une description vendeuse de 2-3 phrases en
