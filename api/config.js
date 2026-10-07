export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.GOOGLE_MAPS_BROWSER_KEY || "";
  if (!key) {
    return res.status(503).json({ error: "GOOGLE_MAPS_BROWSER_KEY não configurada." });
  }
  return res.status(200).json({ googleMapsBrowserKey: key });
}
