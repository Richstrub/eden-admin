/* Eden staff site: reads an OpenTable email (Business Insights or a reservations summary) and takes out what
 * pre-shift needs: the headline numbers, the reservations (time, party size, name, notes, tags) and the rest of the
 * email as readable sections. Phone numbers and email addresses are removed. Nothing here talks to the network.
 * It's written to be forgiving, because OpenTable can change how its emails look. */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™' };
function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
  });
}
export function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table|section|header|footer|ul|ol)>/gi, '\n').replace(/<(p|div|tr|li|h[1-6]|table)[^>]*>/gi, '\n');
  s = s.replace(/<\/t[dh]>/gi, '\t').replace(/<[^>]+>/g, '');
  s = decodeEntities(s).replace(/ /g, ' ').replace(/\r/g, '');
  return s.split('\n').map(l => l.replace(/[ \t]+/g, m => (m.indexOf('\t') !== -1 ? '  ·  ' : ' ')).replace(/^(\s*·\s*)+|(\s*·\s*)+$/g, '').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
// guests' contact details never leave the email
export function scrub(t) {
  return String(t || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[phone]')
    .replace(/https?:\/\/\S+/g, '');
}
const NOISE = /unsubscribe|privacy policy|terms of (use|service)|manage (your )?(email|preferences|notifications)|view (this email )?in (your )?browser|©|all rights reserved|download the app|app store|google play|opentable, inc|sent (to|from) |you('re| are) receiving|^\[(email|phone)\]$|^---------- forwarded message|^(from|to|date|subject|cc):\s/i;
const TIME = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?\s?m\.?\b/i;
const SIZE = /\b(?:party of|pp|ppl|ptys?|table for)\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:guests?|people|ppl|pax|covers?|persons?|diners?|top)\b|\((\d{1,3})\)/i;
const TAGS = [['VIP', /\bvip\b/i], ['Birthday', /birthday|bday/i], ['Anniversary', /anniversar/i], ['Allergy', /allerg|gluten|celiac|nut[- ]free|shellfish|dairy|vegan|vegetarian|dietary/i],
  ['Regular', /\bregular\b|repeat|frequent|\d+(st|nd|rd|th)? visit/i], ['First visit', /first[- ]time|first visit|new guest/i], ['Celebration', /celebrat|engagement|proposal|graduation|promotion/i],
  ['Large party', /large party/i], ['High chair', /high ?chair|booster/i], ['Accessibility', /wheelchair|accessib|mobility/i], ['Private event', /private (dining|event|room)|buyout/i]];
function tagsOf(s) { return TAGS.filter(t => t[1].test(s)).map(t => t[0]); }
function to24(m) { let H = +m[1] % 12; if (/p/i.test(m[3])) H += 12; return String(H).padStart(2, '0') + ':' + (m[2] || '00'); }
const STAT_WORDS = /^(covers?|guests?|reservations?|bookings?|parties|no[- ]shows?|cancell?ations?|walk[- ]ins?|vips?|seated|booked|first[- ]time( guests?| diners?)?|repeat( guests?| diners?)?|regulars?|reviews?|average rating|rating|turn time|average party size|large parties|special occasions?|online reservations?|phone reservations?)$/i;

export function parseOpenTable(input) {
  const html = input.html || '', subject = String(input.subject || '');
  let text = input.text && !html ? String(input.text) : htmlToText(html || input.text || '');
  text = scrub(text);
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !NOISE.test(l) && !/^[·|•\-–—_=*\s]+$/.test(l));
  // the numbers: "42 covers", "Covers: 42", or a label line followed by a number line
  const stats = [], seen = {};
  const addStat = (label, value) => {
    label = label.replace(/[:\s]+$/, '').trim(); const key = label.toLowerCase().replace(/s$/, '');
    if (!label || seen[key] || stats.length >= 12) return; seen[key] = 1; stats.push({ label: label[0].toUpperCase() + label.slice(1), value: String(value).trim() });
  };
  lines.forEach((l, i) => {
    let m;
    if ((m = /^([A-Za-z][A-Za-z' /-]{2,32}?)(?::|\s+·)?\s+([\d,.]+%?|\$[\d,.]+)$/.exec(l)) && STAT_WORDS.test(m[1].trim())) addStat(m[1], m[2]);
    else if ((m = /^([\d,]+)\s+([A-Za-z][A-Za-z' -]{2,30})$/.exec(l)) && STAT_WORDS.test(m[2].trim())) addStat(m[2], m[1]);
    else if (STAT_WORDS.test(l) && lines[i + 1] && /^([\d,.]+%?|\$[\d,.]+)$/.test(lines[i + 1])) addStat(l, lines[i + 1]);
    else if (/^([\d,.]+%?)$/.test(l) && lines[i + 1] && STAT_WORDS.test(lines[i + 1]) && !(lines[i - 1] && STAT_WORDS.test(lines[i - 1]))) addStat(lines[i + 1], l);
  });
  // the reservations: any line (or line plus the next one or two) with a time and a party size
  const list = [];
  for (let i = 0; i < lines.length && list.length < 200; i++) {
    const l = lines[i], tm = TIME.exec(l);
    if (!tm) continue;
    let block = l, used = 0;
    if (!SIZE.test(block)) { for (let k = 1; k <= 2 && i + k < lines.length; k++) { if (TIME.test(lines[i + k])) break; block += '  ·  ' + lines[i + k]; used = k; if (SIZE.test(lines[i + k])) break; } }
    const sz = SIZE.exec(block);
    if (!sz) continue;
    const size = +(sz[1] || sz[2] || sz[3]);
    if (!(size >= 1 && size <= 400)) continue;
    let rest = block.replace(tm[0], ' ').replace(sz[0], ' ').replace(/\s*·\s*/g, ' · ').replace(/\s{2,}/g, ' ').replace(/^[\s·,|–-]+|[\s·,|–-]+$/g, '');
    const parts = rest.split(/\s*·\s*|\s+[–—-]\s+|\s*\|\s*/).map(x => x.trim()).filter(Boolean);
    const NAME = /^([A-Z][\w'’.-]*,\s*[A-Z][\w'’.-]*|[A-Z][\w'’.-]*(\s+[A-Z][\w'’.-]*){0,3}\.?)$/;
    const name = parts.length && NAME.test(parts[0]) && !tagsOf(parts[0]).length ? parts.shift() : '';
    const notes = parts.join(' · ');
    list.push({ time: to24(tm), size, name, notes: notes.slice(0, 400), tags: tagsOf(block) });
    i += used;
  }
  list.sort((a, b) => a.time.localeCompare(b.time));
  // the rest, as readable sections under their headings
  const sections = []; let cur = null;
  const isHead = (l, next) => l.length <= 48 && !/[.:;,!?]$/.test(l) && !TIME.test(l) && !/\d{2,}/.test(l) && (/^[A-Z0-9 &'’/-]{4,}$/.test(l) || (/^[A-Z][a-z]+( [A-Za-z&'’]+){0,5}$/.test(l) && next && next.length > l.length));
  lines.forEach((l, i) => {
    if (isHead(l, lines[i + 1])) { cur = { title: l.replace(/\s+/g, ' '), lines: [] }; sections.push(cur); return; }
    if (!cur) { cur = { title: '', lines: [] }; sections.push(cur); }
    if (cur.lines.length < 60) cur.lines.push(l.slice(0, 500));
  });
  const covers = list.reduce((n, r) => n + r.size, 0);
  return {
    stats, list, covers,
    large: list.filter(r => r.size >= 8).length,
    flagged: list.filter(r => r.tags.length).length,
    sections: sections.filter(s => s.lines.length).slice(0, 30),
    text: lines.join('\n').slice(0, 20000),
    subject: scrub(subject).slice(0, 200)
  };
}
