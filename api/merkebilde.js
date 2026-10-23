// Viser merkebildet for kombinerte merker og figurmerker.
// Bildet hentes fra Patentstyret på serveren, slik at API-nøkkelen ikke havner i nettleseren.
// Bare adresser hos patentstyret.no tillates, så funksjonen ikke kan brukes som en åpen mellomstasjon.

const TILLATT = /^https:\/\/([a-z0-9-]+\.)*patentstyret\.no\//i;

export default async function handler(req, res) {
  const url = String(req.query.url || '');
  if (!TILLATT.test(url) || url.length > 1000) return res.status(400).json({ feil: 'Ugyldig bildeadresse' });

  const nokkel = process.env.PATENTSTYRET_API_KEY;
  try {
    const svar = await fetch(url, { headers: nokkel ? { 'Ocp-Apim-Subscription-Key': nokkel } : {} });
    const type = svar.headers.get('content-type') || '';
    if (!svar.ok || !/^image\//i.test(type)) return res.status(404).json({ feil: 'Fant ikke bildet' });
    const data = Buffer.from(await svar.arrayBuffer());
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=86400, stale-while-revalidate=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(data);
  } catch {
    return res.status(502).json({ feil: 'Kunne ikke hente bildet' });
  }
}
