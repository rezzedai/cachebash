/**
 * GitHub Webhook Handler — Inbound sync from GitHub to CacheBash.
 * Verifies HMAC-SHA256 signature, handles issues.closed and pull_request.merged.
 */

import http from "http";
import crypto from "crypto";
import { getFirestore } from "../firebase/client.js";

function sendJson(res: http.ServerResponse, status: number, data: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifySignature(secret: string, body: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Find admin userId from env or first active session */
async function getAdminUserId(): Promise<string | null> {
  if (process.env.ADMIN_USER_ID) return process.env.ADMIN_USER_ID;
  return null;
}

/** Find task by githubIssueNumber across user's tasks */
async function findTaskByIssueNumber(userId: string, issueNumber: number): Promise<{ id: string; data: FirebaseFirestore.DocumentData } | null> {
  const db = getFirestore();
  const snapshot = await db
    .collection(`tenants/${userId}/tasks`)
    .where("githubIssueNumber", "==", issueNumber)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, data: doc.data() };
}

/** Complete a task by ID */
async function completeTask(userId: string, taskId: string): Promise<void> {
  const db = getFirestore();
  const taskRef = db.doc(`tenants/${userId}/tasks/${taskId}`);
  const doc = await taskRef.get();
  if (!doc.exists) return;

  const data = doc.data()!;
  if (data.status === "done") return; // already done

  await taskRef.update({
    status: "done",
    completedAt: new Date(),
    lastHeartbeat: null,
  });
  console.log(`[GitHub Webhook] Task ${taskId} completed via webhook`);
}

/** Parse "Closes owner/repo#N" from PR body */
function parseClosesIssueNumbers(body: string | null): number[] {
  if (!body) return [];
  const repo = process.env.GITHUB_REPO || "owner/repo";
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:closes|fixes|resolves)\\s+${escaped}#(\\d+)`, "gi");
  const numbers: number[] = [];
  let match;
  while ((match = pattern.exec(body)) !== null) {
    numbers.push(parseInt(match[1], 10));
  }
  return numbers;
}

export async function handleGithubWebhook(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return sendJson(res, 503, { error: "Webhook not configured" });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-hub-signature-256"] as string | undefined;

  if (!verifySignature(secret, rawBody, signature)) {
    return sendJson(res, 401, { error: "Invalid signature" });
  }

  const userId = await getAdminUserId();
  if (!userId) {
    return sendJson(res, 500, { error: "Admin user not configured" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON" });
  }

  const event = req.headers["x-github-event"] as string;

  try {
    if (event === "issues" && (payload as any).action === "closed") {
      const issueNumber = (payload as any).issue?.number;
      if (issueNumber) {
        const task = await findTaskByIssueNumber(userId, issueNumber);
        if (task) {
          await completeTask(userId, task.id);
        }
      }
    } else if (event === "pull_request" && (payload as any).action === "closed" && (payload as any).pull_request?.merged) {
      const prBody = (payload as any).pull_request?.body || "";
      const issueNumbers = parseClosesIssueNumbers(prBody);
      for (const num of issueNumbers) {
        const task = await findTaskByIssueNumber(userId, num);
        if (task) {
          await completeTask(userId, task.id);
        }
      }
    }

    sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error("[GitHub Webhook] Error processing event:", err);
    sendJson(res, 500, { error: "Internal error" });
  }
}
