import crypto from 'node:crypto';
import { decodeEncryptionKey, env } from '../config/env.js';

export const ENCRYPTED_TOKEN_PREFIX = 'enc:v1:';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;
const BASE64URL_PART_REGEX = /^[A-Za-z0-9_-]*$/;

export class TokenDecryptionError extends Error {
  constructor(message = 'Falha ao descriptografar token OAuth do Google.') {
    super(message);
    this.name = 'TokenDecryptionError';
  }
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(ENCRYPTED_TOKEN_PREFIX);
}

function resolveKey(rawKey: string = env.GOOGLE_TOKEN_ENCRYPTION_KEY): Buffer {
  const key = decodeEncryptionKey(rawKey);
  if (!key) {
    throw new TokenDecryptionError('Chave de criptografia de token OAuth inválida.');
  }
  return key;
}

/**
 * Cifra um segredo em texto puro com AES-256-GCM (IV aleatório de 12 bytes e
 * auth tag de 16 bytes) no formato `enc:v1:<iv>:<tag>:<ciphertext>` (partes em
 * base64url).
 */
export function encryptSecret(plainText: string, rawKey?: string): string {
  const key = resolveKey(rawKey);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_TOKEN_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

/**
 * Descriptografa um valor cifrado no formato `enc:v1:<iv>:<tag>:<ciphertext>`.
 * Valores legados sem o prefixo `enc:v1:` são devolvidos como estão (texto puro),
 * exceto quando começam com `enc:` em formato desconhecido/corrompido.
 * Nunca inclui o valor do token ou da chave na mensagem de erro.
 */
export function decryptSecret(storedValue: string, rawKey?: string): string {
  if (!storedValue.startsWith(ENCRYPTED_TOKEN_PREFIX)) {
    if (storedValue.startsWith('enc:')) {
      throw new TokenDecryptionError();
    }
    return storedValue;
  }

  const payload = storedValue.slice(ENCRYPTED_TOKEN_PREFIX.length);
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new TokenDecryptionError();
  }

  const [ivB64, tagB64, ciphertextB64] = parts;
  if (
    !ivB64 ||
    !tagB64 ||
    !BASE64URL_PART_REGEX.test(ivB64) ||
    !BASE64URL_PART_REGEX.test(tagB64) ||
    !BASE64URL_PART_REGEX.test(ciphertextB64)
  ) {
    throw new TokenDecryptionError();
  }

  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ciphertext = Buffer.from(ciphertextB64, 'base64url');

  if (
    iv.length !== IV_LENGTH_BYTES ||
    tag.length !== AUTH_TAG_LENGTH_BYTES ||
    iv.toString('base64url') !== ivB64 ||
    tag.toString('base64url') !== tagB64 ||
    ciphertext.toString('base64url') !== ciphertextB64
  ) {
    throw new TokenDecryptionError();
  }

  const key = resolveKey(rawKey);

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new TokenDecryptionError();
  }
}
