const DB_NAME = 'cipherpay-e2ee';
const STORE = 'keys';
const KEY_ID = 'identity';

type Identity = { privateKey: CryptoKey; publicJwk: JsonWebKey };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open secure key storage.'));
  });
}

async function readPrivateKey(): Promise<CryptoKey | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY_ID);
    req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function savePrivateKey(key: CryptoKey): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(key, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not store secure key.'));
  });
}

function toB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromB64(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function identity(): Promise<Identity> {
  if (!window.crypto?.subtle || !window.indexedDB) throw new Error('This browser does not support secure chat encryption.');
  const existing = await readPrivateKey();
  if (existing) {
    const publicJwk = JSON.parse(localStorage.getItem('cipherpay_e2ee_public') || 'null');
    if (publicJwk) return { privateKey: existing, publicJwk };
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  await savePrivateKey(pair.privateKey);
  localStorage.setItem('cipherpay_e2ee_public', JSON.stringify(publicJwk));
  return { privateKey: pair.privateKey, publicJwk };
}

export async function ensureChatKey(): Promise<JsonWebKey> {
  const me = await identity();
  return me.publicJwk;
}

export async function encryptChatPayload(chatId: number, recipientPublicJwk: JsonWebKey, payload: unknown): Promise<string> {
  const me = await identity();
  const recipientPublic = await crypto.subtle.importKey('jwk', recipientPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipientPublic }, me.privateKey, 256);
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(`CipherPay chat ${chatId}`), info: new TextEncoder().encode('CipherPay E2EE v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return `E2EE1.${toB64(iv)}.${toB64(new Uint8Array(ciphertext))}`;
}

export async function decryptChatPayload(chatId: number, senderPublicJwk: JsonWebKey, packed: string): Promise<any> {
  if (!packed.startsWith('E2EE1.')) return { text: packed };
  const [, ivText, cipherText] = packed.split('.');
  const me = await identity();
  const senderPublic = await crypto.subtle.importKey('jwk', senderPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: senderPublic }, me.privateKey, 256);
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(`CipherPay chat ${chatId}`), info: new TextEncoder().encode('CipherPay E2EE v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivText), }, key, fromB64(cipherText));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
