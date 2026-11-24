const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmails(value) {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[;,\n]/);
  const emails = [];
  for (const entry of entries) {
    const email = String(entry ?? '').trim().toLowerCase();
    if (!email) continue;
    if (!EMAIL_PATTERN.test(email)) throw new Error(`Ungültige E-Mail-Adresse: ${email}`);
    if (!emails.includes(email)) emails.push(email);
  }
  return emails;
}

export function emailHasAreaAccess(area, email) {
  return normalizeEmails(area?.assignedEmails).includes(String(email ?? '').trim().toLowerCase());
}

function randomHex(bytes = 16) {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Zufallsfunktion im Browser nicht verfügbar.');
  return [...globalThis.crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashSecret(secret, salt) {
  if (!globalThis.crypto?.subtle) throw new Error('Lokale Admin-Prüfung wird von diesem Browser nicht unterstützt.');
  const data = new TextEncoder().encode(`${salt}:${secret}`);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createRecoveryCode() {
  return randomHex(8).toUpperCase().match(/.{1,4}/g).join('-');
}

export async function createAdminConfig(password, recoveryCode) {
  const passwordSalt = randomHex();
  const recoverySalt = randomHex();
  return {
    passwordSalt,
    passwordHash: await hashSecret(password, passwordSalt),
    recoverySalt,
    recoveryHash: await hashSecret(recoveryCode, recoverySalt),
  };
}

export async function verifyAdminPassword(config, password) {
  return (await hashSecret(password, config.passwordSalt)) === config.passwordHash;
}

export async function resetAdminPassword(config, recoveryCode, password) {
  if ((await hashSecret(recoveryCode, config.recoverySalt)) !== config.recoveryHash) return null;
  const nextRecoveryCode = createRecoveryCode();
  return {
    config: await createAdminConfig(password, nextRecoveryCode),
    recoveryCode: nextRecoveryCode,
  };
}
