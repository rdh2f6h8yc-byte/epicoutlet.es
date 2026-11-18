// Conexión con Supabase (estos dos datos son públicos, se pueden subir a GitHub).
// Supabase → Project Settings → API Keys / Data API.
const EO_CONFIG = {
  supabaseUrl: 'https://ajvbndzdkikacliqzjot.supabase.co',  // p. ej. 'https://abcdefgh.supabase.co'
  supabaseKey: 'sb_publishable_Vb1QnNSYwgtpGQ9Vx3s4WQ_pwrMhBHG'   // clave "Publishable" (sb_publishable_...) o la "anon public"
};
if (typeof module !== 'undefined' && module.exports) module.exports = EO_CONFIG;
