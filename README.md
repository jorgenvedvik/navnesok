# Navnesøk – testversjon

Internt utgangspunkt for videreutvikling av Navnesøk. Ikke den offisielle tjenesten.

- `index.html` – selve siden
- `api/foretak.js` – live oppslag i Enhetsregisteret (Brreg, åpent API)
- `api/domene.js` – live oppslag mot Norid RDAP (anonym tilgang, begrenset kvote)
- `api/varemerke.js` – venter på tilgang til Patentstyrets API; simulert inntil `PATENTSTYRET_API_URL` og `PATENTSTYRET_API_KEY` er satt i Vercel
