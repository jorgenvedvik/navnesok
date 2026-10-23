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

/* ---------- Fuzzy søk ----------
   Equinir skal finne Equinor. Vi vet ikke nøyaktig hvordan Patentstyrets API matcher tekst,
   så vi gjør flere søk samtidig (hele navnet + avkortede stammer, med og uten *),
   og avgjør selv hvor like treffene er. */

// Grov lydnormalisering for norsk/engelsk skrivemåte: Fjelbriz ≈ Fjellbris, Kafé ≈ Cafe
function lyd(s) {
  return normaliser(s.normalize('NFD').replace(/[̀-ͯ]/g, ''))
    .replace(/æ/g, 'e').replace(/ø/g, 'o').replace(/å/g, 'o').replace(/aa/g, 'o')
    .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'kv').replace(/q/g, 'k')
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's')
    .replace(/w/g, 'v').replace(/th/g, 't').replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1'); // doble bokstaver teller som én
}

// Damerau–Levenshtein (ombytte av to naboer teller som én endring)
function avstand(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const k = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + k);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}

// Hvor mange endringer tåler et navn før det ikke lenger regnes som «nesten likt»
const toleranse = len => (len <= 3 ? 0 : len <= 7 ? 1 : len <= 11 ? 2 : 3);

/* Sammenligner søkt navn med et registrert merke.
   Returnerer { likhet: 'lik' | 'nesten' | 'inneholder' | 'ulik', avvik, grunn } */
export function sammenlign(sokt, merke) {
  const a = normaliser(sokt), b = normaliser(merke);
  if (!a || !b) return { likhet: 'ulik' };
  if (a === b) return { likhet: 'lik', avvik: 0 };
  const la = lyd(sokt), lb = lyd(merke);
  if (la && la === lb) return { likhet: 'nesten', avvik: 0, grunn: 'Uttales likt' };
  const tol = toleranse(Math.min(a.length, b.length));
  const dTekst = avstand(a, b), dLyd = avstand(la, lb);
  const d = Math.min(dTekst, dLyd);
  if (d <= tol && Math.abs(a.length - b.length) <= tol) {
    const grunn = dTekst <= tol
      ? (dTekst === 1 ? '1 bokstav forskjell' : `${dTekst} bokstaver forskjell`)
      : 'Ligner i lyd';
    return { likhet: 'nesten', avvik: d, grunn };
  }
  // Merket inneholder hele det søkte navnet (eller omvendt), f.eks. EQUINOR ENERGY
  const ord = s => String(s).toLowerCase().split(/[^a-z0-9æøå]+/).filter(Boolean);
  if (a.length >= 4 && (ord(merke).includes(a) || b.startsWith(a))) return { likhet: 'inneholder', avvik: b.length - a.length, grunn: 'Inneholder navnet' };
  if (b.length >= 4 && (ord(sokt).includes(b) || a.startsWith(b))) return { likhet: 'inneholder', avvik: a.length - b.length, grunn: 'Navnet ditt inneholder merket' };
  // Ett av ordene i merket er nesten likt det søkte navnet: EQUINOR ASA vs Equinir
  const naermesteOrd = Math.min(...ord(merke).map(o => Math.min(avstand(a, o), avstand(la, lyd(o)))));
  if (a.length >= 5 && naermesteOrd <= toleranse(a.length)) return { likhet: 'nesten', avvik: naermesteOrd, grunn: 'Ett ord ligner' };
  return { likhet: 'ulik', avvik: d };
}

// Søkestrenger vi sender til API-et. Avkortede stammer fanger opp endringer på slutten av navnet,
// og * prøves i tilfelle API-et støtter jokertegn. Ukjente/ugyldige søk ignoreres stille.
function sporringer(navn) {
  const ren = navn.trim();
  const s = new Set([ren]);
  const bokstaver = ren.replace(/\s+/g, ' ');
  if (bokstaver.length >= 5) {
    const stamme = bokstaver.slice(0, Math.max(4, Math.ceil(bokstaver.length * 0.6)));
    s.add(stamme);
    s.add(stamme + '*');
  }
  const forsteOrd = bokstaver.split(' ')[0];
  if (forsteOrd !== bokstaver && forsteOrd.length >= 4) s.add(forsteOrd);
  return [...s].slice(0, 4);
}

async function sok(nokkel, tekst) {
  const svar = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': nokkel, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ trademarkText: tekst, pageSize: 20, pageNumber: 0 })
  });
  if (svar.status === 404) return { tekst, data: null, saker: [] };
  if (!svar.ok) {
    const t = await svar.text().catch(() => '');
    throw new Error(`Patentstyret svarte ${svar.status} ${t.slice(0, 200)}`);
  }
  const data = await svar.json();
  return { tekst, data, saker: finnSaker(data) };
}

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
    const sp = sporringer(navn);
    // Hovedsøket må lykkes; de ekstra fuzzy-søkene får feile uten at hele svaret feiler
    const [hoved, ...ekstra] = await Promise.allSettled(sp.map(t => sok(nokkel, t)));
    if (hoved.status === 'rejected') throw hoved.reason;
    const svar = [hoved.value, ...ekstra.filter(r => r.status === 'fulfilled').map(r => r.value)];

    // Slå sammen og fjern duplikater
    const idFor = t => t.soknadsnr || t.regnr || `${t.merke}|${t.klasser.join(',')}`;
    const fraHoved = new Set(hoved.value.saker.map(s => idFor(tilTreff(s))));
    const sett = new Map();
    for (const { saker } of svar) for (const sak of saker) {
      const t = tilTreff(sak);
      const id = idFor(t);
      if (!sett.has(id)) sett.set(id, t);
    }

    const RANG = { lik: 0, nesten: 1, inneholder: 2, ulik: 3 };
    const treff = [...sett.values()]
      .map(t => {
        const aktiv = !t.status || AKTIV.test(t.status);
        const s = sammenlign(navn, t.merke);
        return { ...t, id: idFor(t), aktiv, likhet: s.likhet, avvik: s.avvik ?? 99, grunn: s.grunn || '',
          vurdering: !aktiv ? 'ulovlig' : s.likhet === 'lik' ? 'opptatt' : 'konflikt' };
      })
      // Treff fra stamme-søkene som ikke ligner nok, er bare støy. Treff fra hovedsøket beholdes som før.
      .filter(t => t.likhet !== 'ulik' || fraHoved.has(t.id))
      .sort((a, b) => (a.aktiv === b.aktiv ? 0 : a.aktiv ? -1 : 1) || RANG[a.likhet] - RANG[b.likhet] || a.avvik - b.avvik);

    const status = treff.some(t => t.vurdering === 'opptatt') ? 'opptatt'
      : treff.some(t => t.vurdering === 'konflikt') ? 'konflikt' : 'ledig';
    const fuzzy = treff.filter(t => t.aktiv && (t.likhet === 'nesten' || t.likhet === 'inneholder')).length;

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      simulert: false,
      status,
      antallTotalt: Math.max(finnTotal(hoved.value.data, 0), treff.length),
      antallLignende: fuzzy,
      treff, // klassevurderingen gjøres i nettleseren
      ...(req.query.debug === '1' ? {
        radata: hoved.value.data,
        sporringer: svar.map(s => ({ tekst: s.tekst, antall: s.saker.length })),
        feiledeSporringer: ekstra.filter(r => r.status === 'rejected').map(r => String(r.reason?.message || r.reason))
      } : {})
    });
  } catch (err) {
    return res.status(502).json({ feil: 'Kunne ikke hente fra Patentstyret', detalj: err.message });
  }
}
