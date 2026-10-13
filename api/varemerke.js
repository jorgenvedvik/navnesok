// Varemerkesøk mot Patentstyrets API (developer.patentstyret.no).
// Data følger WIPO ST.97 (JSON). Nøkkel får man selv via "Sign up" → "Products".
//
// Produkt: OpenData-external. Endepunkt: POST /register/Trademark/v1/search/json
// Legg inn i Vercel under Settings → Environment Variables:
//   PATENTSTYRET_API_KEY  – primærnøkkelen fra profilen din
// Så lenge nøkkelen mangler, svarer funksjonen at den er simulert.

const API_URL = process.env.PATENTSTYRET_API_URL ||
  'https://api.patentstyret.no/external/opendata/register/Trademark/v1/search/json';

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

function finnTotal(data, fallback) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fallback;
  for (const k of ['totalCount', 'totalHits', 'total', 'totalItems', 'totalNumberOfHits', 'count']) {
    if (typeof data[k] === 'number') return data[k];
  }
  return fallback;
}

export default async function handler(req, res) {
  const navn = String(req.query.navn || '').trim();
  if (!navn || navn.length > 100) return res.status(400).json({ feil: 'Ugyldig navn' });

  const nokkel = process.env.PATENTSTYRET_API_KEY;
  if (!nokkel) return res.status(200).json({ simulert: true });

  try {
    const svar = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': nokkel,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ trademarkText: navn, pageSize: 20, pageNumber: 0 })
    });
    if (svar.status === 404) return res.status(200).json({ simulert: false, status: 'ledig', antallTotalt: 0, treff: [] });
    if (!svar.ok) {
      const tekst = await svar.text().catch(() => '');
      throw new Error(`Patentstyret svarte ${svar.status} ${tekst.slice(0, 200)}`);
    }

    const data = await svar.json();
    const saker = finnSaker(data);
    const n = normaliser(navn);
    const treff = saker.map(tilTreff).map(t => {
      const aktiv = !t.status || AKTIV.test(t.status);
      return { ...t, aktiv, vurdering: !aktiv ? 'ulovlig' : normaliser(t.merke) === n ? 'opptatt' : 'konflikt' };
    });
    // Like og aktive merker først
    const rang = { opptatt: 0, konflikt: 1, ulovlig: 2 };
    treff.sort((a, b) => rang[a.vurdering] - rang[b.vurdering]);

    const status = treff.some(t => t.vurdering === 'opptatt') ? 'opptatt'
      : treff.some(t => t.vurdering === 'konflikt') ? 'konflikt' : 'ledig';

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      simulert: false,
      status,
      antallTotalt: finnTotal(data, treff.length),
      treff, // alle treff på første side; klassevurderingen gjøres i nettleseren
      ...(req.query.debug === '1' ? { radata: data } : {})
    });
  } catch (err) {
    return res.status(502).json({ feil: 'Kunne ikke hente fra Patentstyret', detalj: err.message });
  }
}
