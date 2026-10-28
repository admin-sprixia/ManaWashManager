/**
 * WhatsApp Flows encrypt every request to our endpoint: the body is AES-128-GCM, and its key comes
 * wrapped with our RSA public key (registered with Meta for the business number). We answer with
 * the same AES key and the request's IV with every bit flipped. Private key:
 * WHATSAPP_FLOW_PRIVATE_KEY (PKCS#8 PEM; line breaks may be written as \n).
 */

export interface EncryptedFlowRequest {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

let cached: { pem: string; key: Promise<CryptoKey> } | null = null;

function privateKey(pem: string): Promise<CryptoKey> {
  if (cached?.pem === pem) return cached.key;
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const key = crypto.subtle.importKey('pkcs8', fromBase64(body), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  cached = { pem, key };
  return key;
}

/** The request's JSON, and how to encrypt our answer to it. Throws if it can't be decrypted. */
export async function decryptFlowRequest(
  body: EncryptedFlowRequest,
  pem: string,
): Promise<{ request: unknown; encryptReply: (reply: unknown) => Promise<string> }> {
  const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, await privateKey(pem), fromBase64(body.encrypted_aes_key));
  const aes = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const iv = fromBase64(body.initial_vector);
  // The 16-byte GCM tag sits at the end of the data, as WebCrypto expects.
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, fromBase64(body.encrypted_flow_data));
  const request: unknown = JSON.parse(new TextDecoder().decode(plain));
  const flipped = iv.map((b) => b ^ 0xff);
  return {
    request,
    encryptReply: async (reply) => {
      const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: flipped }, aes, new TextEncoder().encode(JSON.stringify(reply)));
      return toBase64(new Uint8Array(sealed));
    },
  };
}
