/* Eden staff site configuration.
 *
 * The Supabase "publishable" key is designed to be public. What a signed-in person can
 * do is decided by the database rules (supabase/schema.sql) and their role in the
 * staff table, not by this file. Never put a secret key or a password here.
 */
window.EDEN_STAFF_CONFIG = {
  supabase: {
    url: 'https://qmblccwyxbpvziiwrlne.supabase.co',
    key: 'sb_publishable_Nbp1K_Co8tDVB-jNjBRs3w_D40qm4Mg'
  },
  // The public website, for the "View website" button.
  publicSite: 'https://edencny.com/',
  // Where guests' catering questionnaire links point. Change to https://edencny.com/ once edencny.com
  // points to the new website (and SITE_URL in wrangler.jsonc too).
  guestSite: 'https://eden-website.richard-a-strub.workers.dev/'
};
