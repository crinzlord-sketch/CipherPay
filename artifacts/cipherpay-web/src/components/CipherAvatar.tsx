import React from 'react';

export type AvatarGender = 'male' | 'female' | 'neutral';

function hashSeed(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function avatarGender(value?: unknown): AvatarGender {
  return value === 'male' || value === 'female' ? value : 'neutral';
}

export function avatarDataUrl(seedValue: unknown, genderValue?: unknown): string {
  const seed = hashSeed(String(seedValue ?? 'cipherpay'));
  const gender = avatarGender(genderValue);
  const hue = 252 + (seed % 30);
  const skin = ['#f4c7a1', '#d99a6c', '#b96f45', '#8c5036'][seed % 4];
  const hair = gender === 'female'
    ? ['#241b2f', '#3a241b', '#17151d'][seed % 3]
    : gender === 'male'
      ? ['#17151d', '#30231b', '#20242b'][seed % 3]
      : '#27212e';
  const accent = 'hsl(' + hue + ' 72% 62%)';
  const hairShape = gender === 'female'
    ? '<path d="M22 39c0-13 10-23 22-23s22 10 22 23v18c-4-7-9-10-11-18-8 6-20 8-33 3z" fill="' + hair + '"/><path d="M25 42c-2 14 0 25 7 30l-6 2c-6-8-7-22-1-32z" fill="' + hair + '"/><path d="M59 42c2 14 0 25-7 30l6 2c6-8 7-22 1-32z" fill="' + hair + '"/>'
    : '<path d="M23 40c0-15 9-24 21-24s21 9 21 24c-6-7-12-10-17-11-6 5-15 8-25 8z" fill="' + hair + '"/>';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="' + accent + '"/><stop offset="1" stop-color="#ff9b54"/></linearGradient><radialGradient id="light" cx="30%" cy="20%"><stop stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="shirt" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#171522"/><stop offset="1" stop-color="#40365f"/></linearGradient></defs><rect width="88" height="88" rx="24" fill="url(#bg)"/><circle cx="22" cy="18" r="32" fill="url(#light)"/><ellipse cx="44" cy="88" rx="30" ry="28" fill="url(#shirt)"/><path d="M31 62c3 8 23 8 26 0v12H31z" fill="' + skin + '"/><rect x="25" y="29" width="38" height="35" rx="17" fill="' + skin + '"/><ellipse cx="34" cy="45" rx="2.2" ry="3" fill="#241b1b"/><ellipse cx="54" cy="45" rx="2.2" ry="3" fill="#241b1b"/><path d="M38 55c4 3 8 3 12 0" fill="none" stroke="#7d463b" stroke-width="2" stroke-linecap="round"/>' + hairShape + '<path d="M27 35c6-5 28-5 35 0" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"/><circle cx="68" cy="20" r="5" fill="#fff" fill-opacity=".18"/></svg>';
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

export function CipherAvatar({ src, seed, gender, size = 44, alt = '' }: { src?: string | null; seed?: unknown; gender?: unknown; size?: number; alt?: string }) {
  return <img src={src || avatarDataUrl(seed, gender)} alt={alt} width={size} height={size} className="cp-avatar-image" style={{ width: size, height: size }} />;
}
