export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const apiKey = process.env.GOOGLE_PLACES_SERVER_KEY;
  if (!apiKey) return res.status(503).json({ error: "GOOGLE_PLACES_SERVER_KEY não configurada." });

  const id = String(req.query.id || "").trim();
  if (!id || id.length > 300 || !/^[A-Za-z0-9_\-]+$/.test(id)) {
    return res.status(400).json({ error: "Place ID inválido." });
  }

  try {
    const upstream = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount,googleMapsUri"
      }
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      const message = data?.error?.message || "Erro retornado pelo Google Places.";
      return res.status(upstream.status).json({ error: message });
    }

    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json(data);
  } catch {
    return res.status(502).json({ error: "Não foi possível carregar os detalhes do estabelecimento." });
  }
}
