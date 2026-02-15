import crypto from "crypto";

const SALT_PREFIX = "cachebash_e2e_v1_";
const KEY_ITERATIONS = 100000;
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const ALGORITHM = "aes-256-cbc";

export function deriveEncryptionKey(apiKey: string): Buffer {
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const salt = SALT_PREFIX + apiKeyHash.substring(0, 16);
  return crypto.pbkdf2Sync(apiKey, salt, KEY_ITERATIONS, KEY_LENGTH, "sha256");
}

export function encrypt(plaintext: string, keyOrApiKey: string | Buffer): string {
  const key = Buffer.isBuffer(keyOrApiKey) ? keyOrApiKey : deriveEncryptionKey(keyOrApiKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string, keyOrApiKey: string | Buffer): string {
  const key = Buffer.isBuffer(keyOrApiKey) ? keyOrApiKey : deriveEncryptionKey(keyOrApiKey);
  const combined = Buffer.from(ciphertext, "base64");
  if (combined.length < IV_LENGTH + 1) throw new Error("Ciphertext too short");
  const iv = combined.subarray(0, IV_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

export function isEncrypted(text: string | null | undefined): boolean {
  if (!text) return false;
  try {
    const decoded = Buffer.from(text, "base64");
    return decoded.length >= 32;
  } catch {
    return false;
  }
}

export function encryptQuestionData(
  data: { question: string; options?: string[] | null; context?: string | null },
  apiKey: string | Buffer
): { question: string; options: string[] | null; context: string | null; encrypted: boolean } {
  return {
    question: encrypt(data.question, apiKey),
    options: data.options ? data.options.map((opt) => encrypt(opt, apiKey)) : null,
    context: data.context ? encrypt(data.context, apiKey) : null,
    encrypted: true,
  };
}

export function decryptQuestionData(
  data: { question: string; options?: string[] | null; context?: string | null; encrypted?: boolean },
  apiKey: string | Buffer
): { question: string; options: string[] | null; context: string | null } {
  if (!data.encrypted) {
    return { question: data.question, options: data.options || null, context: data.context || null };
  }
  return {
    question: decrypt(data.question, apiKey),
    options: data.options ? data.options.map((opt) => decrypt(opt, apiKey)) : null,
    context: data.context ? decrypt(data.context, apiKey) : null,
  };
}
