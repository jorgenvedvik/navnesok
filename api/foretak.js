// Slår opp foretaksnavn i Foretaksregisteret (Brønnøysundregistrene).
// Brreg har ett åpent søke-API for alle enheter. Vi filtrerer på
// registrertIForetaksregisteret=true, slik at bare foretak i Foretaksregisteret
// (AS, ASA, ANS, DA, NUF osv.) tas med. Ingen nøkkel trengs.

const SELSKAPSFORMER = /\b(as|asa|ans|da|ba|sa|enk|nuf|stiftelse|holding)\b/g;
const normaliser = s => s.toLowerCase().replace(SELSKAPSFORMER, '').replace(/[^a-z0-9æøå]/g, '');

export default async function handler(req, res) {
  const navn = String(req.query.navn || '').trim();
  if (!navn || navn.length > 100) {
    return res.status(400).json({ feil: 'Ugyldig navn' });
  }

  try {
    const url = p => `https://data.brreg.no/enhetsregisteret/api/enheter?${new URLSearchParams(p)}`;
    const hent = p => fetch(url(p), { headers: { Accept: 'application/json' } });
    // To søk samtidig: Foretaksregisteret (avgjør status) og alle enheter (tilleggsinfo)
    const [svar, alleSvar] = await Promise.all([
      hent({ navn, registrertIForetaksregisteret: 'true', size: '10' }),
      hent({ navn, size: '20' }).catch(() => null)
    ]);
    if (!svar.ok) throw new Error(`Brreg svarte ${svar.status}`);
    const data = await svar.json();
    const alleData = alleSvar && alleSvar.ok ? await alleSvar.json().catch(() => null) : null;

    const mal = normaliser(navn);
    const foretak = (data._embedded?.enheter || []).map(e => ({
      navn: e.navn,
      orgnr: e.organisasjonsnummer,
      form: e.organisasjonsform?.beskrivelse || '',
      registrert: e.registreringsdatoForetaksregisteret || '',
      slettet: Boolean(e.slettedato),
      avvikling: Boolean(e.konkurs || e.underAvvikling || e.underTvangsavviklingEllerTvangsopplosning),
      lik: normaliser(e.navn) === mal
    }));

    const like = foretak.filter(e => e.lik && !e.slettet);
    const status = like.length ? 'opptatt' : foretak.length ? 'konflikt' : 'ledig';

    // Andre enheter med samme navn som IKKE står i Foretaksregisteret (f.eks. enkeltpersonforetak, foreninger).
    // Påvirker ikke status – vises bare som informasjon.
    const andre = (alleData?._embedded?.enheter || [])
      .filter(e => !e.registrertIForetaksregisteret && !e.slettedato && normaliser(e.navn) === mal)
      .map(e => ({ navn: e.navn, orgnr: e.organisasjonsnummer, form: e.organisasjonsform?.beskrivelse || '' }));

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      status,
      antallTotalt: data.page?.totalElements ?? foretak.length,
      treff: foretak.slice(0, 3),
      andre: { antall: andre.length, eksempler: andre.slice(0, 3) }
    });
  } catch (err) {
    return res.status(502).json({ feil: 'Kunne ikke hente fra Foretaksregisteret', detalj: err.message });
  }
}
