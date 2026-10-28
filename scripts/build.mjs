import { cp, mkdir, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const base = (process.env.API_BASE_URL ?? '').replace(/\/$/, '');
if (base && (new URL(base).protocol !== 'https:' || new URL(base).pathname !== '/' || new URL(base).search || new URL(base).hash)) throw new Error('API_BASE_URL must be an HTTPS origin, such as https://attendance.example.com');
await mkdir(new URL('dist/', root), { recursive: true });
await cp(new URL('public/', root), new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/config.js', root), `window.ATTENDANCE_CONFIG = ${JSON.stringify({ apiBase: base, practice: !base })};\n`);
await writeFile(new URL('dist/.nojekyll', root), '');
console.log(base ? 'Static site built with configured backend.' : 'Static practice site built (synthetic data only); configure API_BASE_URL to connect a live backend.');
