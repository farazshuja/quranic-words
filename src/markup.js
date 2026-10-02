import {marked} from '../vendor/marked.js';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
marked.use({renderer:{html:({text}) => escapeHtml(text)}});
export function parseUrdu(text) { return marked.parse(text); }
