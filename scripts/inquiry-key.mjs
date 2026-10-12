// Runs during Cloudflare's build (wrangler.jsonc → build.command). Copies the INQUIRY_KEY that was saved under
// Settings → Build → Variables and secrets into the worker, so the key works from either place in Cloudflare.
// The generated file is never committed (.gitignore) and never served as a web page (.assetsignore).
import { writeFileSync } from 'node:fs';
const key = String(process.env.INQUIRY_KEY || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
writeFileSync(new URL('../inquiry-key.generated.js', import.meta.url), '// generated at build time; do not commit\nexport default ' + JSON.stringify(key) + ';\n');
console.log(key ? 'Inquiry key from build settings: included (' + key.length + ' characters).' : 'No INQUIRY_KEY in build settings (using the runtime secret, if any).');
