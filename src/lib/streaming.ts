// Streaming platforms of the match narrators (streamers): labels, channel
// normalisation and the embedded player address. Twitch, YouTube and Kick.
export type StreamPlatform = 'TWITCH' | 'YOUTUBE' | 'KICK';

export const STREAM_PLATFORMS: { value: StreamPlatform; label: string; hint: string }[] = [
  { value: 'TWITCH', label: 'Twitch', hint: 'Login do canal (ex.: fbfoficial) ou link twitch.tv/…' },
  { value: 'YOUTUBE', label: 'YouTube', hint: 'ID do canal (começa com UC…) ou link youtube.com/channel/UC…' },
  { value: 'KICK', label: 'Kick', hint: 'Nome do canal (ex.: fbfoficial) ou link kick.com/…' },
];

export const platformLabel = (p: string) => STREAM_PLATFORMS.find((x) => x.value === p)?.label ?? p;

const RULES: Record<StreamPlatform, { hosts: string[]; pattern: RegExp; example: string }> = {
  // Twitch logins: 4-25 letters, digits or underscore
  TWITCH: { hosts: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'], pattern: /^[A-Za-z0-9_]{2,25}$/, example: 'fbfoficial' },
  // YouTube channel id used by the live embed
  YOUTUBE: { hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com'], pattern: /^UC[A-Za-z0-9_-]{22}$/, example: 'UCxxxxxxxxxxxxxxxxxxxxxx' },
  // Kick channel slugs: letters, digits, underscore or hyphen
  KICK: { hosts: ['kick.com', 'www.kick.com'], pattern: /^[A-Za-z0-9_-]{2,30}$/, example: 'fbfoficial' },
};

export type ChannelResult = { ok: true; channel: string } | { ok: false; message: string };

/** Accepts the channel name/id or a link to the channel and returns the identifier to store. */
export function normalizeChannel(platform: StreamPlatform, input: string): ChannelResult {
  const rule = RULES[platform];
  let text = String(input ?? '').trim().replace(/^@/, '');
  if (!text) return { ok: false, message: 'Informe o canal.' };
  const looksLikeUrl = /^[a-z]+:\/\//i.test(text) || rule.hosts.some((h) => text.toLowerCase().startsWith(`${h}/`));
  if (looksLikeUrl) {
    let url: URL;
    try { url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`); } catch { return { ok: false, message: 'Link do canal inválido.' }; }
    if (!rule.hosts.includes(url.hostname.toLowerCase())) return { ok: false, message: `Este link não é do ${platformLabel(platform)}.` };
    const parts = url.pathname.split('/').filter(Boolean);
    text = platform === 'YOUTUBE' ? (parts[0] === 'channel' ? parts[1] ?? '' : '') : (parts[0] ?? '');
    if (platform === 'YOUTUBE' && !text) return { ok: false, message: 'Use o link no formato youtube.com/channel/UC… (o player ao vivo precisa do ID do canal).' };
    text = text.replace(/^@/, '');
  }
  if (!rule.pattern.test(text)) return { ok: false, message: `Canal inválido para ${platformLabel(platform)} (ex.: ${rule.example}).` };
  return { ok: true, channel: platform === 'YOUTUBE' ? text : text.toLowerCase() };
}

/** Address of the embedded live player. */
export function embedUrl(platform: string, channel: string, hostname: string): string {
  const c = encodeURIComponent(channel);
  if (platform === 'TWITCH') return `https://player.twitch.tv/?channel=${c}&parent=${encodeURIComponent(hostname)}`;
  if (platform === 'KICK') return `https://player.kick.com/${c}`;
  return `https://www.youtube.com/embed/live_stream?channel=${c}`;
}

/** True when the stored identifier is valid for the platform (nothing else is ever embedded). */
export function isValidChannel(platform: string, channel: string): boolean {
  const rule = RULES[platform as StreamPlatform];
  return Boolean(rule && typeof channel === 'string' && rule.pattern.test(channel));
}

/** Address of the embedded player of the mini player: starts muted (no sound until the visitor turns it on). */
export function mutedEmbedUrl(platform: string, channel: string, hostname: string): string {
  const c = encodeURIComponent(channel);
  if (platform === 'TWITCH') return `https://player.twitch.tv/?channel=${c}&parent=${encodeURIComponent(hostname)}&muted=true&autoplay=true`;
  if (platform === 'KICK') return `https://player.kick.com/${c}?muted=true&autoplay=true`;
  return `https://www.youtube.com/embed/live_stream?channel=${c}&autoplay=1&mute=1`;
}

/** Public page of the channel. */
export function channelUrl(platform: string, channel: string): string {
  const c = encodeURIComponent(channel);
  if (platform === 'TWITCH') return `https://www.twitch.tv/${c}`;
  if (platform === 'KICK') return `https://kick.com/${c}`;
  return `https://www.youtube.com/channel/${c}`;
}
