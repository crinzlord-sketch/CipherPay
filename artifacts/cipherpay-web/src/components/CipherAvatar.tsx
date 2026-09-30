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
  const variant = seed % 18;
  const skinTones = ['#f4c7a1', '#e5ae82', '#d99a6c', '#c98257', '#b96f45', '#9d5d40', '#8c5036', '#70432f'];
  const hairColors = ['#17151d', '#241b2f', '#3a241b', '#30231b', '#20242b', '#4a2f22'];
  const backgrounds = [
    ['#7167ff', '#ff8f70'], ['#3b82f6', '#7c3aed'], ['#06b6d4', '#8b5cf6'],
    ['#f97316', '#ec4899'], ['#10b981', '#3b82f6'], ['#eab308', '#f97316'],
    ['#ef4444', '#8b5cf6'], ['#14b8a6', '#6366f1'], ['#8b5cf6', '#ec4899'],
  ];
  const skin = skinTones[(seed >>> 3) % skinTones.length];
  const hair = hairColors[(seed >>> 7) % hairColors.length];
  const bg = backgrounds[variant % backgrounds.length];
  const faceRx = 17 + ((seed >>> 11) % 4);
  const eyeGap = 16 + ((seed >>> 15) % 5);
  const eyeY = 43 + ((seed >>> 19) % 4);
  const eyeSize = 2 + ((seed >>> 23) % 2) * 0.4;
  const shirt = ['#171522', '#202938', '#30244d', '#173b3b', '#3b2520', '#252525'][(seed >>> 5) % 6];
  const hairStyle = variant % 6;
  const hairPath = hairStyle === 0
    ? '<path d="M23 40c0-15 9-24 21-24s21 9 21 24c-6-7-12-10-17-11-6 5-15 8-25 8z" fill="' + hair + '"/>'
    : hairStyle === 1
      ? '<path d="M21 42c0-17 10-27 23-27s23 10 23 27v18c-4-10-8-15-13-19-8 5-18 7-33 4z" fill="' + hair + '"/>'
      : hairStyle === 2
        ? '<path d="M24 38c2-14 10-21 20-21 11 0 19 7 21 21-7-5-13-7-20-7-7 0-14 2-21 7z" fill="' + hair + '"/><circle cx="24" cy="39" r="5" fill="' + hair + '"/><circle cx="64" cy="39" r="5" fill="' + hair + '"/>'
        : hairStyle === 3
          ? '<path d="M22 43c-2-17 8-28 22-28s24 11 22 28c-5-7-10-11-15-14-7 7-17 10-29 14z" fill="' + hair + '"/>'
          : hairStyle === 4
            ? '<path d="M22 42c0-15 10-25 22-25s22 10 22 25c-5-8-11-12-17-13-7 5-15 7-27 7z" fill="' + hair + '"/><path d="M25 43c-2 13 0 23 6 30l-6 2c-7-9-8-22 0-32z" fill="' + hair + '"/>'
            : '<path d="M24 41c0-15 8-24 20-24 13 0 21 9 21 24-5-5-10-9-16-11-7 6-15 9-25 11z" fill="' + hair + '"/><path d="M25 29c7-8 22-10 34-3" fill="none" stroke="' + hair + '" stroke-width="7" stroke-linecap="round"/>';

  const glasses = variant === 3 || variant === 9 || variant === 15
    ? '<path d="M27 43h12v7H27zM49 43h12v7H49zM39 45h10" fill="none" stroke="#25212b" stroke-width="2" stroke-linejoin="round"/>'
    : '';
  const beard = gender === 'male' && variant % 5 === 0
    ? '<path d="M31 53c3 9 23 9 26 0v7c-3 8-23 8-26 0z" fill="' + hair + '" opacity=".75"/>'
    : '';
  const accessory = variant === 6
    ? '<circle cx="61" cy="56" r="2.4" fill="#f6c344"/>'
    : variant === 12
      ? '<path d="M58 34l5-4" stroke="#f6c344" stroke-width="2" stroke-linecap="round"/>'
      : '';

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 88"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="' + bg[0] + '"/><stop offset="1" stop-color="' + bg[1] + '"/></linearGradient><radialGradient id="light" cx="30%" cy="20%"><stop stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="shirt" x1="0" y1="0" x2="1" y2="1"><stop stop-color="' + shirt + '"/><stop offset="1" stop-color="#4b406b"/></linearGradient></defs><rect width="88" height="88" rx="24" fill="url(#bg)"/><circle cx="22" cy="18" r="32" fill="url(#light)"/><ellipse cx="44" cy="88" rx="30" ry="28" fill="url(#shirt)"/><path d="M31 62c3 8 23 8 26 0v12H31z" fill="' + skin + '"/><rect x="' + (44 - faceRx) + '" y="28" width="' + (faceRx * 2) + '" height="37" rx="' + faceRx + '" fill="' + skin + '"/><ellipse cx="' + (44 - eyeGap) + '" cy="' + eyeY + '" rx="' + eyeSize + '" ry="3" fill="#241b1b"/><ellipse cx="' + (44 + eyeGap) + '" cy="' + eyeY + '" rx="' + eyeSize + '" ry="3" fill="#241b1b"/><path d="M38 55c4 3 8 3 12 0" fill="none" stroke="#7d463b" stroke-width="2" stroke-linecap="round"/>' + hairPath + beard + glasses + accessory + '<path d="M27 35c6-5 28-5 35 0" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="2"/><circle cx="68" cy="20" r="5" fill="#fff" fill-opacity=".18"/></svg>';
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

export function CipherAvatar({ src, seed, gender, size = 44, alt = '' }: { src?: string | null; seed?: unknown; gender?: unknown; size?: number; alt?: string }) {
  return <img src={src || avatarDataUrl(seed, gender)} alt={alt} width={size} height={size} className="cp-avatar-image" style={{ width: size, height: size }} />;
}
