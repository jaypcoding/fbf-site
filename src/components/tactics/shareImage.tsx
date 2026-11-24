// Shareable image of a club's formation, composed from its own layout (ShareCard), not a
// screenshot. Rendered to SVG markup, then to a 1080×1350 PNG in the browser. The
// rendering library is loaded only when someone asks for the image.
import { ShareCard, SHARE_H as H, SHARE_W as W, type ShareInput as Input } from './ShareCard';

async function toDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => resolve(null); fr.readAsDataURL(blob); });
  } catch {
    return null; // a crest from a host without CORS: the initials are drawn instead
  }
}

export async function exportFormationImage(input: Input) {
  const [{ renderToStaticMarkup }, logo] = await Promise.all([import('react-dom/server'), toDataUrl(input.team.logo_url)]);
  const markup = renderToStaticMarkup(<ShareCard {...input} logo={logo} />);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('svg')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.getContext('2d')!.drawImage(img, 0, 0, W, H);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
    const a = document.createElement('a');
    const slug = input.team.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    a.href = URL.createObjectURL(png);
    a.download = `fbf-mapa-tatico-${slug || 'clube'}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
