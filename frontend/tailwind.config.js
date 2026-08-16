/** LRMC's branding-locked palette, for the real CLI build.
 *
 * Mirrors the inline `tailwind.config` the pages carry for the CDN build. The
 * two must agree, and `assetManifest.ts` asserts that they do — a compiled
 * stylesheet built from a different palette than the pages were designed
 * against is a site that looks subtly wrong everywhere and obviously wrong
 * nowhere. */
module.exports = {
  content: ['./**/*.html', './assets/js/*.js'],
  theme: {
    extend: {
      colors: {
        lrmc: { blue: '#1E3A8A', gold: '#D4AF37', slate: '#334155' },
        blue: { 100:'#DBEAFE', 300:'#93C5FD', 500:'#3B82F6', 600:'#2563EB', 700:'#1D4ED8', 800:'#1E3A8A', 900:'#172554' },
        slate:{ 50:'#F8FAFC', 100:'#F1F5F9', 200:'#E2E8F0', 300:'#CBD5E1', 400:'#94A3B8', 500:'#64748B', 700:'#334155', 800:'#1E293B', 900:'#0F172A' },
        emerald:{ 50:'#ECFDF5', 100:'#D1FAE5', 500:'#10B981', 600:'#059669', 700:'#047857' },
        amber:{ 50:'#FFFBEB', 100:'#FEF3C7', 500:'#F59E0B', 600:'#D97706', 700:'#B45309' },
        rose:{ 50:'#FFF1F2', 100:'#FFE4E6', 600:'#E11D48', 700:'#BE123C' },
        gold: { 100:'#FBF6E5', 500:'#D4AF37', 700:'#8A6D1C' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
};
