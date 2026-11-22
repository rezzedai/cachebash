import { world } from "./harness/load";
import { callTool } from "./harness/client";
import { probe } from "./harness/registry";
import { mint } from "./harness/mint";
import { denied } from "./harness/judge";
import { emulatorDb, sha256 } from "./harness/emulator";
import * as crypto from "crypto";
import type { World, WorldCredential } from "./harness/world";

/**
 * SA (security): registering an OAuth service account (client_credentials) mints a credential with the
 * oauth-service capability set. Before the fix any API key could register one. Now:
 *  - POST /register with client_credentials needs a Bearer that literally holds fleet.admin ("*" does not count)
 *  - GET/DELETE /oauth/service-accounts need literal fleet.admin for API keys
 *  - the token carries the oauth-service set intersected with its creator's capabilities
 *  - each mint re-reads the creator key: a narrowed creator narrows the token, a revoked or hash-less creator refuses the mint
 * Registrations per server are capped at 10/hour/IP (DCR rate limit): this file makes 9.
 */

const post = (w: World, path: string, bearer: string | null, body: unknown, form = false) =>
  fetch(`${w.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) as any }));

const registerSa = (w: World, bearer: string | null, name: string) =>
  post(w, "/register", bearer, { client_name: name, grant_types: ["client_credentials"] });

const tokenFor = (w: World, clientId: string, secret: string) =>
  post(w, "/token", null, { grant_type: "client_credentials", client_id: clientId, client_secret: secret, scope: "mcp:full" }, true);

/** The credential a cbo_ access token presents on /v1/mcp. */
const asToken = (base: WorldCredential, token: string): WorldCredential => ({ ...base, key: token });

/** register as `key`, mint a token if registered, call dispatch_create_task (a dispatch.write tool) with it. */
async function escalate(w: World, key: WorldCredential, name: string) {
  const reg = await registerSa(w, key.key, name);
  if (reg.status !== 201) return { registerStatus: reg.status, tokenIssued: false, dispatchWriteSucceeded: false };
  const tok = await tokenFor(w, reg.json.client_id, reg.json.client_secret);
  if (tok.status !== 200) return { registerStatus: reg.status, tokenIssued: false, dispatchWriteSucceeded: false };
  const r = await callTool(w, asToken(key, tok.json.access_token), "dispatch_create_task", { title: `sa-${name}`, target: "beta", source: "oauth-service", instructions: "sa" });
  return { registerStatus: reg.status, tokenIssued: true, dispatchWriteSucceeded: !denied(r) };
}

describe("SA service-account registration", () => {
  probe("SA.register_needs_fleet_admin", async () => {
    const w = world();
    const relayOnly = await mint(w, "alpha", "probe-sa-relay", ["relay.write"]);
    expect(await escalate(w, relayOnly, "sa-relay-only")).toEqual({ registerStatus: 403, tokenIssued: false, dispatchWriteSucceeded: false });
  });

  probe("SA.register_wildcard_not_enough", async () => {
    const w = world();
    const wild = await mint(w, "alpha", "probe-sa-wild", ["*"]);
    expect(await escalate(w, wild, "sa-wild")).toEqual({ registerStatus: 403, tokenIssued: false, dispatchWriteSucceeded: false });
  });

  probe("SA.manage_needs_fleet_admin", async () => {
    const w = world();
    const relayOnly = await mint(w, "alpha", "probe-sa-manage", ["relay.write"]);
    const wild = await mint(w, "alpha", "probe-sa-manage-wild", ["*"]);
    const call = (k: WorldCredential, method: string, path: string) =>
      fetch(`${w.baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${k.key}` } }).then((r) => r.status);
    expect({
      listRelay: await call(relayOnly, "GET", "/oauth/service-accounts"),
      listWild: await call(wild, "GET", "/oauth/service-accounts"),
      revokeRelay: await call(relayOnly, "DELETE", "/oauth/service-accounts/does-not-matter"),
      revokeWild: await call(wild, "DELETE", "/oauth/service-accounts/does-not-matter"),
    }).toEqual({ listRelay: 403, listWild: 403, revokeRelay: 403, revokeWild: 403 });
  });

  probe("SA.token_capped_to_creator", async () => {
    const w = world();
    // creator holds fleet.admin and dispatch.read, not dispatch.write
    const creator = await mint(w, "alpha", "probe-sa-cap", ["fleet.admin", "dispatch.read"]);
    const reg = await registerSa(w, creator.key, "sa-capped");
    expect(reg.status).toBe(201);
    const tok = await tokenFor(w, reg.json.client_id, reg.json.client_secret);
    expect(tok.status).toBe(200);
    const t = asToken(creator, tok.json.access_token);
    const write = await callTool(w, t, "dispatch_create_task", { title: "sa-cap", target: "beta", source: "oauth-service", instructions: "sa" });
    expect(denied(write)).toBe(true);
    const read = await callTool(w, t, "dispatch_get_tasks", { requires_action: null });
    expect(denied(read)).toBe(false); // control: a capability the creator holds still works
  });

  probe("SA.token_without_creator_list_has_none", async () => {
    const w = world();
    // a service-account token doc with no capability list (written straight into the emulator)
    const token = "cbo_" + crypto.randomBytes(24).toString("hex");
    await emulatorDb().doc(`oauthTokens/${sha256(token)}`).set({
      tokenHash: sha256(token), tokenPrefix: "cbo_", type: "access", clientId: "sa-nolist", userId: w.tenants.A,
      scope: "mcp:full", grantedScopes: ["mcp:full"], programId: "oauth-service", familyId: null,
      createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), revokedAt: null, active: true, parentRefreshTokenHash: null,
    });
    const r = await callTool(w, asToken(w.creds.admin, token), "dispatch_create_task", { title: "sa-nolist", target: "beta", source: "oauth-service", instructions: "sa" });
    expect(denied(r)).toBe(true);
  });

  probe("SA.token_capped_to_current_creator", async () => {
    const w = world();
    // creator registers while holding fleet.admin + dispatch.write + dispatch.read, then loses dispatch.write
    const creator = await mint(w, "alpha", "probe-sa-narrow", ["fleet.admin", "dispatch.write", "dispatch.read"]);
    const reg = await registerSa(w, creator.key, "sa-narrowed");
    expect(reg.status).toBe(201);
    await emulatorDb().doc(`keyIndex/${creator.keyHash}`).update({ capabilities: ["fleet.admin", "dispatch.read"] });
    const tok = await tokenFor(w, reg.json.client_id, reg.json.client_secret);
    expect(tok.status).toBe(200);
    const t = asToken(creator, tok.json.access_token);
    const write = await callTool(w, t, "dispatch_create_task", { title: "sa-narrow", target: "beta", source: "oauth-service", instructions: "sa" });
    expect(denied(write)).toBe(true);
    const read = await callTool(w, t, "dispatch_get_tasks", { requires_action: null });
    expect(denied(read)).toBe(false); // control: a capability the creator still holds works
  });

  probe("SA.revoked_creator_mint_refused", async () => {
    const w = world();
    const creator = await mint(w, "alpha", "probe-sa-revoked", ["fleet.admin", "dispatch.write"]);
    const reg = await registerSa(w, creator.key, "sa-revoked-creator");
    expect(reg.status).toBe(201);
    await emulatorDb().doc(`keyIndex/${creator.keyHash}`).update({ active: false, revokedAt: new Date() });
    const tok = await tokenFor(w, reg.json.client_id, reg.json.client_secret);
    expect(tok.status).toBeGreaterThanOrEqual(400);
    expect(tok.status).toBeLessThan(500);
    expect(tok.json.access_token).toBeUndefined();
  });

  probe("SA.client_without_creator_hash_mint_refused", async () => {
    const w = world();
    // a client doc from before the fix: creatorCapabilities snapshot present, no creator key hash
    const clientId = "sa-nohash-" + crypto.randomBytes(4).toString("hex");
    const secret = "cbs_" + crypto.randomBytes(32).toString("hex");
    await emulatorDb().doc(`oauthClients/${clientId}`).set({
      clientId, clientName: "sa-nohash", grantTypes: ["client_credentials"], isServiceAccount: true,
      clientSecretHash: sha256(secret), userId: w.tenants.A, creatorCapabilities: ["fleet.admin", "dispatch.write"],
    });
    const tok = await tokenFor(w, clientId, secret);
    expect(tok.status).toBeGreaterThanOrEqual(400);
    expect(tok.status).toBeLessThan(500);
    expect(tok.json.access_token).toBeUndefined();
  });

  test("SA.register_needs_fleet_admin control: a fleet.admin key registers a service account and its token works", async () => {
    const w = world();
    const reg = await registerSa(w, w.creds.admin.key, "sa-admin");
    expect(reg.status).toBe(201);
    const tok = await tokenFor(w, reg.json.client_id, reg.json.client_secret);
    expect(tok.status).toBe(200);
    const t = asToken(w.creds.admin, tok.json.access_token);
    const write = await callTool(w, t, "dispatch_create_task", { title: "sa-admin", target: "beta", source: "oauth-service", instructions: "sa" });
    expect(denied(write)).toBe(false);
    const list = await fetch(`${w.baseUrl}/oauth/service-accounts`, { headers: { Authorization: `Bearer ${w.creds.admin.key}` } });
    expect(list.status).toBe(200); // control for SA.manage_needs_fleet_admin
  });

  test("SA.register_needs_fleet_admin control: authorization_code DCR with no Bearer still works", async () => {
    const w = world();
    const r = await post(w, "/register", null, { client_name: "sa-public", redirect_uris: ["https://example.com/cb"], grant_types: ["authorization_code"] });
    expect(r.status).toBe(201);
  });
});
