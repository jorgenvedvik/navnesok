// Varemerkesøk mot Patentstyret.
// Krever tilgang til Patentstyrets API. Legg inn i Vercel under
// Settings → Environment Variables:
//   PATENTSTYRET_API_URL  – endepunktet for varemerkesøk
//   PATENTSTYRET_API_KEY  – nøkkelen dere får tildelt
// Så lenge disse mangler, svarer funksjonen at den er simulert,
// og nettsiden viser oppdiktede resultater i stedet.

export default async function handler(req, res) {
  const navn = String(req.query.navn || '').trim();
  if (!navn || navn.length > 100) {
    return res.status(400).json({ feil: 'Ugyldig navn' });
  }

  const url = process.env.PATENTSTYRET_API_URL;
  const nokkel = process.env.PATENTSTYRET_API_KEY;
  if (!url || !nokkel) {
    return res.status(200).json({ simulert: true });
  }

  // TODO: Tilpass når vi vet hvordan Patentstyrets API ser ut
  // (parameternavn, autentisering og svarformat).
  try {
    const svar = await fetch(`${url}?q=${encodeURIComponent(navn)}`, {
      headers: { 'Ocp-Apim-Subscription-Key': nokkel, Accept: 'application/json' }
    });
    if (!svar.ok) throw new Error(`Patentstyret svarte ${svar.status}`);
    const data = await svar.json();
    return res.status(200).json({ simulert: false, ra: data });
  } catch (err) {
    return res.status(502).json({ feil: 'Kunne ikke hente fra Patentstyret', detalj: err.message });
  }
}
