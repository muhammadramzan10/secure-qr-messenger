// Client-Side Cryptographic helpers using browser Web Crypto API

// Base64 serialization utilities safe from stack overflows
export function bufToBase64(buf: Uint8Array): string {
  let binary = "";
  const len = buf.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

export function base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Symmetric Encryption & Key Derivation (AES-GCM-256 + PBKDF2)
// ---------------------------------------------------------------------------

export async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", 
    enc.encode(password), 
    "PBKDF2", 
    false, 
    ["deriveKey"]
  );
  return await crypto.subtle.deriveKey(
    { 
      name: "PBKDF2", 
      salt: salt as BufferSource, 
      iterations: 100000, 
      hash: "SHA-256" 
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptText(plaintext: string, password: string): Promise<{
  cipherText: string;
  salt: string;
  iv: string;
  authTag: string;
}> {
  const enc = new TextEncoder();
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  
  const key = await deriveKeyFromPassword(password, saltBytes);
  const ciphered = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBytes as BufferSource }, 
    key, 
    enc.encode(plaintext)
  );
  
  const cipherArr = new Uint8Array(ciphered);
  const cipherBody = cipherArr.slice(0, -16);
  const authTagBytes = cipherArr.slice(-16);
  
  return {
    cipherText: bufToBase64(cipherBody),
    salt: bufToBase64(saltBytes),
    iv: bufToBase64(ivBytes),
    authTag: bufToBase64(authTagBytes),
  };
}

export async function decryptText(
  cipherText: string, 
  salt: string, 
  iv: string, 
  authTag: string, 
  password: string
): Promise<string> {
  const dec = new TextDecoder();
  const saltBytes = base64ToBuf(salt);
  const ivBytes = base64ToBuf(iv);
  const cipherBytes = base64ToBuf(cipherText);
  const authTagBytes = base64ToBuf(authTag);
  
  const combined = new Uint8Array(cipherBytes.length + authTagBytes.length);
  combined.set(cipherBytes); 
  combined.set(authTagBytes, cipherBytes.length);
  
  const key = await deriveKeyFromPassword(password, saltBytes);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes as BufferSource }, 
    key, 
    combined as BufferSource
  );
  
  return dec.decode(decrypted);
}

// ---------------------------------------------------------------------------
// Asymmetric Encryption & Key Exchange (RSA-OAEP-2048)
// ---------------------------------------------------------------------------

export async function generateAsymmetricKeyPair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}> {
  return await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("jwk", key);
  return JSON.stringify(exported);
}

export async function importPublicKey(jwkString: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkString);
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["encrypt"]
  );
}

export async function exportPrivateKey(key: CryptoKey, password: string): Promise<{
  encryptedPrivateKey: string;
  salt: string;
  iv: string;
  authTag: string;
}> {
  const exported = await crypto.subtle.exportKey("jwk", key);
  const jwkString = JSON.stringify(exported);
  const encrypted = await encryptText(jwkString, password);
  return {
    encryptedPrivateKey: encrypted.cipherText,
    salt: encrypted.salt,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
  };
}

export async function importPrivateKey(
  encryptedPrivateKey: string,
  salt: string,
  iv: string,
  authTag: string,
  password: string
): Promise<CryptoKey> {
  const jwkString = await decryptText(encryptedPrivateKey, salt, iv, authTag, password);
  const jwk = JSON.parse(jwkString);
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    true,
    ["decrypt"]
  );
}

// ---------------------------------------------------------------------------
// Hybrid Encryption Envelope (Direct Messaging E2E)
// ---------------------------------------------------------------------------

export async function encryptAsymmetric(
  publicKey: CryptoKey, 
  plaintext: string
): Promise<{
  cipherText: string;
  encryptedKey: string;
  iv: string;
  authTag: string;
}> {
  // 1. Generate an ephemeral 256-bit AES symmetric key
  const aesKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const aesKey = await crypto.subtle.importKey(
    "raw", 
    aesKeyBytes, 
    "AES-GCM", 
    true, 
    ["encrypt"]
  );

  // 2. Symmetrically encrypt the message body using GCM
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphered = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBytes as BufferSource }, 
    aesKey, 
    enc.encode(plaintext)
  );
  
  const cipherArr = new Uint8Array(ciphered);
  const cipherBody = cipherArr.slice(0, -16);
  const authTagBytes = cipherArr.slice(-16);

  // 3. Asymmetrically encrypt the raw AES key using the recipient's RSA public key
  const encryptedAesKeyBuf = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" }, 
    publicKey, 
    aesKeyBytes as BufferSource
  );

  return {
    cipherText: bufToBase64(cipherBody),
    encryptedKey: bufToBase64(new Uint8Array(encryptedAesKeyBuf)),
    iv: bufToBase64(ivBytes),
    authTag: bufToBase64(authTagBytes),
  };
}

export async function decryptAsymmetric(
  privateKey: CryptoKey,
  cipherText: string,
  encryptedKey: string,
  iv: string,
  authTag: string
): Promise<string> {
  // 1. Decrypt the ephemeral AES key bytes using the RSA private key
  const encryptedKeyBytes = base64ToBuf(encryptedKey);
  const aesKeyBytesBuf = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" }, 
    privateKey, 
    encryptedKeyBytes as BufferSource
  );
  const aesKeyBytes = new Uint8Array(aesKeyBytesBuf);

  // 2. Re-import the ephemeral AES key
  const aesKey = await crypto.subtle.importKey(
    "raw", 
    aesKeyBytes, 
    "AES-GCM", 
    true, 
    ["decrypt"]
  );

  // 3. Re-assemble GCM format (ciphertext + tag) and decrypt
  const cipherBytes = base64ToBuf(cipherText);
  const authTagBytes = base64ToBuf(authTag);
  const ivBytes = base64ToBuf(iv);
  
  const combined = new Uint8Array(cipherBytes.length + authTagBytes.length);
  combined.set(cipherBytes);
  combined.set(authTagBytes, cipherBytes.length);

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes as BufferSource }, 
    aesKey, 
    combined as BufferSource
  );
  const dec = new TextDecoder();
  return dec.decode(decryptedBuf);
}
