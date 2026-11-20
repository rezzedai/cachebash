import type { World, WorldCredential } from "./world";

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");

/**
 * A Firebase ID token the Auth emulator would mint: an unsigned JWT (alg "none"). The server under test runs with
 * FIREBASE_AUTH_EMULATOR_HOST set (harness/server.ts), so firebase-admin's verifyIdToken accepts it without a network
 * call and the credential goes through validateFirebaseToken exactly as the phone's does: programId "mobile", the
 * mobile default capabilities, `apiKeyHash` "firebase:<uid>". `uid` is the tenant the token reads.
 */
export function firebaseCred(w: World, uid: string, claims: { email?: string; emailVerified?: boolean } = {}): WorldCredential {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: `https://securetoken.google.com/${w.projectId}`,
    aud: w.projectId,
    sub: uid,
    user_id: uid,
    iat: now - 5,
    auth_time: now - 5,
    exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: "password" },
  };
  if (claims.email) {
    payload.email = claims.email;
    payload.email_verified = claims.emailVerified ?? false;
  }
  const key = `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`;
  return { name: "scoped", tenant: "A", tenantUid: uid, programId: "mobile", capabilities: [], key, keyHash: `firebase:${uid}` };
}
