# Navnesøk – testversjon

Internt utgangspunkt for videreutvikling av Navnesøk. Ikke den offisielle tjenesten.

- `index.html` – selve siden
- `api/foretak.js` – live oppslag i Foretaksregisteret (Brreg, åpent API filtrert på registrertIForetaksregisteret)
- `api/domene.js` – live oppslag mot Norid RDAP (anonym tilgang, begrenset kvote)
- `api/varemerke.js` – live varemerkesøk mot Patentstyrets OpenData-API (POST, krever `PATENTSTYRET_API_KEY` i Vercel; simulert uten nøkkel)
