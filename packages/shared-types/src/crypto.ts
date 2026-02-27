import * as crypto from 'node:crypto';

/**
 * Falken Protocol: Secure Key Management Utilities
 * Implements AES-256-GCM encryption/decryption for hosted agent keys.
 */

/**
 * Encrypts a private key using AES-256-GCM.
 * @param privateKey The raw hex private key to encrypt.
 * @param masterKey The master encryption key (must be 32 chars).
 * @returns A formatted string: "iv:authTag:encryptedData"
 */
export function encryptAgentKey(privateKey: string, masterKey: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm', 
    Buffer.from(masterKey.slice(0, 32)), 
    iv
  );
  
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an agent's private key into RAM.
 * @param encryptedBlob The formatted string from the database.
 * @param masterKey The master encryption key (must be 32 chars).
 * @returns The raw private key string.
 */
export function decryptAgentKey(encryptedBlob: string, masterKey: string): string {
  const [ivHex, authTagHex, encryptedDataHex] = encryptedBlob.split(':');

  if (!ivHex || !authTagHex || !encryptedDataHex) {
    throw new Error('Invalid encrypted key format.');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encryptedData = Buffer.from(encryptedDataHex, 'hex');

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm', 
    Buffer.from(masterKey.slice(0, 32)), 
    iv
  );

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, undefined, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
