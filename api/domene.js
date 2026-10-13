// Sjekker .no-domener mot Norids RDAP-tjeneste.
// Anonym tilgang: maks 10 oppslag/min og 3000 HEAD-oppslag per døgn per IP.
// https://teknisk.norid.no/en/integrere-mot-norid/rdap-tjenesten/
import { domainToASCII } from 'node:url';

function lagDomene(navn) {
  const slug = navn.toLowerCase().trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9æøåàáäéèêëóòôöüčđŋšŧžǎ-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug;
}

export default async function handler(req, res) {
  const navn = String(req.query.navn || '');
  const slug = lagDomene(navn);
  const domene = `${slug}.no`;

  if (slug.length < 2 || slug.length > 63) {
    return res.status(200).json({ domene, status: 'ulovlig', melding: 'Domenenavn må ha mellom 2 og 63 tegn.' });
  }

  const ascii = domainToASCII(domene);
  if (!ascii) {
    return res.status(200).json({ domene, status: 'ulovlig', melding: 'Navnet inneholder tegn som ikke er tillatt.' });
  }

  try {
    const svar = await fetch(`https://rdap.norid.no/domain/${ascii}`, { method: 'HEAD' });

    if (svar.status === 429) {
      return res.status(200).json({ domene, status: 'ukjent', melding: 'Norids oppslagsgrense er nådd. Prøv igjen om litt.' });
    }

    const status = svar.status === 200 ? 'opptatt' : svar.status === 404 ? 'ledig' : 'ukjent';
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      domene,
      status,
      melding: status === 'ledig' ? 'Ikke registrert. Kan likevel være sperret for registrering.' : ''
    });
  } catch (err) {
    return res.status(502).json({ domene, feil: 'Kunne ikke hente fra Norid', detalj: err.message });
  }
}
