// Slår opp foretaksnavn i Enhetsregisteret (Brønnøysundregistrene).
// Åpent API, ingen nøkkel: https://data.brreg.no/enhetsregisteret/api/dokumentasjon/no/index.html

const SELSKAPSFORMER = /\b(as|asa|ans|da|ba|sa|enk|nuf|stiftelse|holding)\b/g;

function normaliser(s) {
  return s.toLowerCase().replace(SELSKAPSFORMER, '').replace(/[^a-z0-9æøå]/g, '');
}

export default async function handler(req, res) {
  const navn = String(req.query.navn || '').trim();
  if (!navn || navn.length > 100) {
    return res.status(400).json({ feil: 'Ugyldig navn' });
  }

  try {
    const url = `https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(navn)}&size=10`;
    const svar = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!svar.ok) throw new Error(`Brreg svarte ${svar.status}`);
    const data = await svar.json();

    const mal = normaliser(navn);
    const enheter = (data._embedded?.enheter || []).map(e => ({
      navn: e.navn,
      orgnr: e.organisasjonsnummer,
      form: e.organisasjonsform?.beskrivelse || '',
      slettet: Boolean(e.slettedato),
      lik: normaliser(e.navn) === mal
    }));

    const like = enheter.filter(e => e.lik && !e.slettet);
    const status = like.length ? 'opptatt' : enheter.length ? 'konflikt' : 'ledig';

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      status,
      antallTotalt: data.page?.totalElements ?? enheter.length,
      treff: enheter.slice(0, 5)
    });
  } catch (err) {
    return res.status(502).json({ feil: 'Kunne ikke hente fra Enhetsregisteret', detalj: err.message });
  }
}
