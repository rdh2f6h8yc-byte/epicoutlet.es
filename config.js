// Conexión con Supabase (estos dos datos son públicos, se pueden subir a GitHub).
// Supabase → Project Settings → API Keys / Data API.
const EO_CONFIG = {
  supabaseUrl: '',  // p. ej. 'https://abcdefgh.supabase.co'
  supabaseKey: ''   // clave "Publishable" (sb_publishable_...) o la "anon public"
};
if (typeof module !== 'undefined' && module.exports) module.exports = EO_CONFIG;
