const ALLOWED_TYPES = new Set([
  "restaurant","gym","beauty_salon","real_estate_agency","medical_clinic",
  "pet_store","hotel","store","travel_agency","car_repair"
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const apiKey = process.env.GOOGLE_PLACES_SERVER_KEY;
  if (!apiKey) return res.status(503).json({ error: "GOOGLE_PLACES_SERVER_KEY não configurada." });

  const { lat, lng, radius, includedType } = req.body || {};
  const nLat = Number(lat);
  const nLng = Number(lng);
  const nRadius = Math.min(50000, Math.max(50, Number(radius) || 3000));

  if (!Number.isFinite(nLat) || nLat < -90 || nLat > 90 || !Number.isFinite(nLng) || nLng < -180 || nLng > 180) {
    return res.status(400).json({ error: "Centro da busca inválido." });
  }
  if (!ALLOWED_TYPES.has(includedType)) {
    return res.status(400).json({ error: "Categoria não suportada." });
  }

  try {
    const upstream = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.primaryTypeDisplayName"
      },
      body: JSON.stringify({
        includedTypes: [includedType],
        maxResultCount: 20,
        rankPreference: "POPULARITY",
        locationRestriction: {
          circle: {
            center: { latitude: nLat, longitude: nLng },
            radius: nRadius
          }
        }
      })
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      const message = data?.error?.message || "Erro retornado pelo Google Places.";
      return res.status(upstream.status).json({ error: message });
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({ places: data.places || [] });
  } catch {
    return res.status(502).json({ error: "Não foi possível consultar o Google Places." });
  }
}
