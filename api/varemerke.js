// Varemerkesøk mot Patentstyrets API (developer.patentstyret.no).
// Data følger WIPO ST.97 (JSON). Nøkkel får man selv via "Sign up" → "Products".
//
// Legg inn i Vercel under Settings → Environment Variables:
//   PATENTSTYRET_API_KEY  – abonnementsnøkkelen fra profilen din
//   PATENTSTYRET_API_URL  – endepunktet for varemerkesøk. Bruk {navn} der søkeordet skal stå,
//                           f.eks. https://.../trademarks/search?text={navn}
//                           (uten {navn} legges ?q=<navn> til automatisk)
// Så lenge disse mangler, svarer funksjonen at den er simulert.

const hent = (obj, sti) => sti.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tekst = v => (v && typeof v === 'object' && '$' in v ? v.$ : v);

function finnSaker(data) {
  // Svaret kan være én sak, en liste med saker eller en liste pakket i et felt.
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data.trademarkApplication) return [data];
  for (const v of Object.values(data)) if (Array.isArray(v)) return v;
  return [];
}

function tilTreff(sak) {
  const app = sak.trademarkApplication || sak;
  const tm = hent(app, 'trademarkBag.trademark')?.[0] || {};
  const klasser = (hent(tm, 'goodsServicesBag.goodsServices') || [])
    .map(g => hent(g, 'classDescriptionBag.classDescription')?.[0]?.classNumber)
    .filter(Boolean);
  const eier =
    tekst(hent(app, 'holderBag.holder')?.[0]?.contact?.contactTypeChoiceSequence?.name?.entityName?.transliterationName?.[0]) ||
    tekst(hent(tm, 'applicantBag.applicant')?.[0]?.contact?.contactTypeChoiceSequence?.name?.entityName?.transliterationName?.[0]) || '';
  return {
    merke: tekst(hent(tm, 'markRepresentation.markReproduction.wordMarkSpecification.markVerbalElementText')) || '(figurmerke)',
    soknadsnr: hent(tm, 'trademarkTypeChoice1.applicationNumber')?.[0]?.applicationNumberText || '',
    regnr: hent(tm, 'trademarkTypeChoice1.registrationNumber') || '',
    status: tm.markCurrentStatusCode || '',
    klasser,
    eier,
    url: app.caseUrl || ''
  };
}

const normaliser = s => String(s).toLowerCase().replace(/[^a-z0-9æøå]/g, '');
const AKTIV = /registered|pending|filed|published|opposition|registrert|under/i;

export default async function handler(req, res) {
  const navn = String(req.query.navn || '').trim();
  if (!navn || navn.length > 100) return res.status(400).json({ feil: 'Ugyldig navn' });

  const mal = process.env.PATENTSTYRET_API_URL;
  const nokkel = process.env.PATENTSTYRET_API_KEY;
  if (!mal || !nokkel) return res.status(200).json({ simulert: true });

  const url = mal.includes('{navn}')
    ? mal.replace('{navn}', encodeURIComponent(navn))
    : `${mal}${mal.includes('?') ? '&' : '?'}q=${encodeURIComponent(navn)}`;

  try {
    const svar = await fetch(url, {
      headers: { 'Ocp-Apim-Subscription-Key': nokkel, Accept: 'application/json' }
    });
    if (svar.status === 404) return res.status(200).json({ simulert: false, status: 'ledig', treff: [] });
    if (!svar.ok) throw new Error(`Patentstyret svarte ${svar.status}`);

    const treff = finnSaker(await svar.json()).map(tilTreff);
    const n = normaliser(navn);
    treff.forEach(t => {
      const aktiv = !t.status || AKTIV.test(t.status);
      t.vurdering = !aktiv ? 'ulovlig' : normaliser(t.merke) === n ? 'opptatt' : 'konflikt';
    });
    const status = treff.some(t => t.vurdering === 'opptatt') ? 'opptatt'
      : treff.some(t => t.vurdering === 'konflikt') ? 'konflikt' : 'ledig';

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ simulert: false, status, antallTotalt: treff.length, treff: treff.slice(0, 5) });
  } catch (err) {
    return res.status(502).json({ feil: 'Kunne ikke hente fra Patentstyret', detalj: err.message });
  }
}
