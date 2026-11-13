// Dev-only helper: regenerates the PNG app icons in public/icons (needs Playwright).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#1b7f3b"/>
  <g transform="translate(256 256) scale(${pad ? 0.72 : 0.95}) translate(-256 -256)">
    <path d="M256 96a160 160 0 1 0 152 110" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round"/>
    <path d="M372 92l44 118-124-20z" fill="#fff"/>
    <text x="256" y="330" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="200" fill="#fff">₹</text>
  </g></svg>`;
const browser = await chromium.launch();
for (const [name, size, pad] of [['icon-192', 192, false], ['icon-512', 512, false], ['icon-maskable-512', 512, true]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg(pad).replace('<svg', `<svg width="${size}" height="${size}"`)}</body>`);
  await page.screenshot({ path: `public/icons/${name}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
