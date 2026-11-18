// Conexión con Supabase (estos dos datos son públicos, se pueden subir a GitHub).
// Supabase → Project Settings → API Keys / Data API.
const EO_CONFIG = {
  supabaseUrl: 'https://ajvbndzdkikacliqzjot.supabase.co',  // p. ej. 'https://abcdefgh.supabase.co'
  supabaseKey: 'sb_publishable_Vb1QnNSYwgtpGQ9Vx3s4WQ_pwrMhBHG',  // clave "Publishable" (sb_publishable_...) o la "anon public"
  sitioUrl: 'https://www.epicoutlet.es',  // dirección principal de la tienda (para Google)
  indexNowKey: 'a5bad2108bf96626153a666c0e0a5bcb',  // clave pública para avisar a Bing y otros buscadores (archivo /a5bad2108bf96626153a666c0e0a5bcb.txt)
  gaId: 'G-L6N99QDY0Z'  // ID de medición de Google Analytics 4 (G-XXXXXXXXXX). Vacío = sin Analytics ni aviso de cookies
};
if (typeof module !== 'undefined' && module.exports) module.exports = EO_CONFIG;
