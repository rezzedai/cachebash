/**
 * Task Webhooks Test Suite — Wave 13
 *
 * Tests webhook registration, filtering, dispatch, and delivery logging.
 */

import type { AuthContext } from "../auth/authValidator";
import {
  webhookRegisterHandler,
  webhookListHandler,
  webhookDeleteHandler,
  webhookGetDeliveriesHandler,
  dispatchTaskWebhooks,
} from "../modules/webhook";

// Mock data stores
const mockWebhookDocs: any[] = [];
const mockDeliveryDocs: any[] = [];
let mockDispatchCalls: any[] = [];

// Mock dispatchWebhook from webhookDispatcher
jest.mock("../modules/webhookDispatcher.js", () => ({
  dispatchWebhook: jest.fn(async (subscription: any, event: any, userId: string) => {
    mockDispatchCalls.push({ subscription, event, userId });
    return true; // Simulate successful delivery
  }),
}));

// Mock Firestore
const mockDb = {
  collection: jest.fn((path: string) => {
    if (path.includes("/webhooks")) {
      return {
        add: jest.fn(async (data: any) => {
          const id = `webhook-${mockWebhookDocs.length + 1}`;
          mockWebhookDocs.push({ id, ...data });
          return { id };
        }),
        where: jest.fn((field: string, op: string, value: any) => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: jest.fn(async () => ({
                  docs: mockWebhookDocs.map((d) => ({
                    id: d.id,
                    data: () => d,
                  })),
                  empty: mockWebhookDocs.length === 0,
                })),
              })),
            })),
          })),
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn(async () => ({
                docs: mockWebhookDocs
                  .filter((d) => d[field] === value)
                  .map((d) => ({
                    id: d.id,
                    data: () => d,
                  })),
                empty: mockWebhookDocs.filter((d) => d[field] === value).length === 0,
              })),
            })),
          })),
          get: jest.fn(async () => ({
            docs: mockWebhookDocs
              .filter((d) => d[field] === value)
              .map((d) => ({
                id: d.id,
                data: () => d,
              })),
            empty: mockWebhookDocs.filter((d) => d[field] === value).length === 0,
          })),
        })),
        orderBy: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: jest.fn(async () => ({
              docs: mockWebhookDocs.map((d) => ({
                id: d.id,
                data: () => d,
              })),
              empty: mockWebhookDocs.length === 0,
            })),
          })),
        })),
      };
    }
    if (path.includes("/webhook_deliveries")) {
      return {
        add: jest.fn(async (data: any) => {
          const id = `delivery-${mockDeliveryDocs.length + 1}`;
          mockDeliveryDocs.push({ id, ...data });
          return { id };
        }),
        where: jest.fn((field: string, op: string, value: any) => ({
          where: jest.fn(() => ({
            orderBy: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: jest.fn(async () => ({
                  docs: mockDeliveryDocs.map((d) => ({ data: () => d })),
                  empty: mockDeliveryDocs.length === 0,
                })),
              })),
            })),
          })),
          orderBy: jest.fn(() => ({
            limit: jest.fn(() => ({
              get: jest.fn(async () => ({
                docs: mockDeliveryDocs
                  .filter((d) => d[field] === value)
                  .map((d) => ({ data: () => d })),
                empty: mockDeliveryDocs.filter((d) => d[field] === value).length === 0,
              })),
            })),
          })),
        })),
        orderBy: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: jest.fn(async () => ({
              docs: mockDeliveryDocs.map((d) => ({ data: () => d })),
              empty: mockDeliveryDocs.length === 0,
            })),
          })),
        })),
      };
    }
    return { add: jest.fn(), doc: jest.fn() };
  }),
  doc: jest.fn((path: string) => ({
    get: jest.fn(async () => {
      const id = path.split("/").pop();
      const webhook = mockWebhookDocs.find((d) => d.id === id);
      return {
        exists: !!webhook,
        data: () => webhook,
        id,
      };
    }),
    delete: jest.fn(async () => {
      const id = path.split("/").pop();
      const index = mockWebhookDocs.findIndex((d) => d.id === id);
      if (index >= 0) mockWebhookDocs.splice(index, 1);
    }),
  })),
};

jest.mock("../firebase/client.js", () => ({
  getFirestore: jest.fn(() => mockDb),
  serverTimestamp: jest.fn(() => "MOCK_TIMESTAMP"),
}));

// Auth context for tests
const mockAuth: AuthContext = {
  userId: "test-user-123",
  apiKeyHash: "test-key-hash",
  programId: "basher",
  encryptionKey: Buffer.from("test-key-32-bytes-long-padding!!", "utf-8"),
  capabilities: ["*"],
  rateLimitTier: "internal",
};

describe("Task Webhooks — Wave 13", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWebhookDocs.length = 0;
    mockDeliveryDocs.length = 0;
    mockDispatchCalls = [];
  });

  describe("Registration CRUD", () => {
    it("webhook_register creates a webhook and returns ID", async () => {
      const result = await webhookRegisterHandler(mockAuth, {
        events: ["task.created", "task.completed"],
        callbackUrl: "https://example.com/webhook",
        secret: "my-secret-key",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(true);
      expect(data.webhookId).toBeDefined();
      expect(data.events).toEqual(["task.created", "task.completed"]);
      expect(data.callbackUrl).toBe("https://example.com/webhook");
      expect(data.hasSecret).toBe(true);
      expect(mockWebhookDocs).toHaveLength(1);
      expect(mockWebhookDocs[0].secret).toBe("my-secret-key");
      expect(mockWebhookDocs[0].secretHash).toBeDefined();
    });

    it("webhook_register rejects non-HTTPS callbackUrl", async () => {
      await expect(
        webhookRegisterHandler(mockAuth, {
          events: ["task.created"],
          callbackUrl: "http://example.com/webhook",
        })
      ).rejects.toThrow();
    });

    it("webhook_register stores secret hash alongside secret", async () => {
      const result = await webhookRegisterHandler(mockAuth, {
        events: ["task.created"],
        callbackUrl: "https://example.com/webhook",
        secret: "test-secret",
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.hasSecret).toBe(true);
      expect(mockWebhookDocs[0].secret).toBe("test-secret");
      expect(mockWebhookDocs[0].secretHash).toBeTruthy();
      expect(mockWebhookDocs[0].secretHash).not.toBe("test-secret");
    });

    it("webhook_list returns webhooks without exposing secrets", async () => {
      // Create a webhook first
      await webhookRegisterHandler(mockAuth, {
        events: ["task.created"],
        callbackUrl: "https://example.com/webhook",
        secret: "my-secret",
      });

      const result = await webhookListHandler(mockAuth, { limit: 10 });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.webhooks).toHaveLength(1);
      expect(data.webhooks[0].hasSecret).toBe(true);
      expect(data.webhooks[0].secret).toBeUndefined();
      expect(data.webhooks[0].secretHash).toBeUndefined();
    });

    it("webhook_delete removes a webhook", async () => {
      // Create a webhook
      const createResult = await webhookRegisterHandler(mockAuth, {
        events: ["task.created"],
        callbackUrl: "https://example.com/webhook",
      });
      const createData = JSON.parse(createResult.content[0].text);

      // Delete it
      const deleteResult = await webhookDeleteHandler(mockAuth, {
        webhookId: createData.webhookId,
      });
      const deleteData = JSON.parse(deleteResult.content[0].text);

      expect(deleteData.success).toBe(true);
      expect(mockWebhookDocs).toHaveLength(0);
    });
  });

  describe("Event Dispatch", () => {
    it("dispatchTaskWebhooks queries webhooks and calls dispatchWebhook", async () => {
      // Register a webhook
      mockWebhookDocs.push({
        id: "webhook-1",
        events: ["task.created"],
        callbackUrl: "https://example.com/webhook",
        secret: "test-secret",
        filter: null,
        enabled: true,
        createdBy: "basher",
      });

      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-123",
        task: { id: "task-123", title: "Test task", target: "basher" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(1);
      expect(mockDispatchCalls[0].subscription.id).toBe("webhook-1");
      expect(mockDispatchCalls[0].event.event).toBe("task.created");
      expect(mockDispatchCalls[0].event.taskId).toBe("task-123");
    });

    it("dispatchTaskWebhooks does NOT call dispatchWebhook when no webhooks are registered", async () => {
      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-123",
        task: { id: "task-123", title: "Test task" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(0);
    });

    it("dispatchTaskWebhooks does NOT throw on internal errors", async () => {
      // Force an error by mocking a failure
      const originalDispatch = require("../modules/webhookDispatcher.js").dispatchWebhook;
      require("../modules/webhookDispatcher.js").dispatchWebhook = jest.fn(async () => {
        throw new Error("Network error");
      });

      mockWebhookDocs.push({
        id: "webhook-1",
        events: ["task.created"],
        callbackUrl: "https://example.com/webhook",
        secret: null,
        filter: null,
        enabled: true,
        createdBy: "basher",
      });

      // Should not throw
      await expect(
        dispatchTaskWebhooks("test-user-123", {
          event: "task.created",
          taskId: "task-123",
          task: { id: "task-123" },
          timestamp: new Date().toISOString(),
          tenantId: "test-user-123",
        })
      ).resolves.not.toThrow();

      // Restore
      require("../modules/webhookDispatcher.js").dispatchWebhook = originalDispatch;
    });
  });

  describe("Filter Matching", () => {
    it("Webhook with filter.target only fires for matching tasks", async () => {
      mockWebhookDocs.push({
        id: "webhook-1",
        events: ["task.created"],
        callbackUrl: "https://example.com/webhook",
        secret: null,
        filter: { target: "basher" },
        enabled: true,
        createdBy: "iso",
      });

      // Matching task
      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-1",
        task: { id: "task-1", target: "basher" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(1);
      mockDispatchCalls = [];

      // Non-matching task
      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-2",
        task: { id: "task-2", target: "vector" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(0);
    });

    it("Webhook with filter.source only fires for matching tasks", async () => {
      mockWebhookDocs.push({
        id: "webhook-1",
        events: ["task.created"],
        callbackUrl: "https://example.com/webhook",
        secret: null,
        filter: { source: "iso" },
        enabled: true,
        createdBy: "basher",
      });

      // Matching task
      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-1",
        task: { id: "task-1", source: "iso" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(1);
      mockDispatchCalls = [];

      // Non-matching task
      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-2",
        task: { id: "task-2", source: "vector" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(0);
    });

    it("Webhook with filter.projectId only fires for matching tasks", async () => {
      mockWebhookDocs.push({
        id: "webhook-1",
        events: ["task.created"],
        callbackUrl: "https://example.com/webhook",
        secret: null,
        filter: { projectId: "proj-1" },
        enabled: true,
        createdBy: "basher",
      });

      // Matching task
      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-1",
        task: { id: "task-1", projectId: "proj-1" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(1);
      mockDispatchCalls = [];

      // Non-matching task
      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-2",
        task: { id: "task-2", projectId: "proj-2" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(0);
    });

    it("Webhook with no filter fires for all tasks", async () => {
      mockWebhookDocs.push({
        id: "webhook-1",
        events: ["task.created"],
        callbackUrl: "https://example.com/webhook",
        secret: null,
        filter: null,
        enabled: true,
        createdBy: "basher",
      });

      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-1",
        task: { id: "task-1", target: "any-target", source: "any-source" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(1);
    });

    it("Webhook with multiple filter fields requires ALL to match (AND logic)", async () => {
      mockWebhookDocs.push({
        id: "webhook-1",
        events: ["task.created"],
        callbackUrl: "https://example.com/webhook",
        secret: null,
        filter: { target: "basher", source: "iso" },
        enabled: true,
        createdBy: "vector",
      });

      // All fields match
      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-1",
        task: { id: "task-1", target: "basher", source: "iso" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(1);
      mockDispatchCalls = [];

      // Only target matches
      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-2",
        task: { id: "task-2", target: "basher", source: "vector" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(0);

      // Only source matches
      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-3",
        task: { id: "task-3", target: "vector", source: "iso" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      expect(mockDispatchCalls).toHaveLength(0);
    });
  });

  describe("Delivery Logging", () => {
    it("webhook_get_deliveries returns delivery logs", async () => {
      // Add a mock delivery
      mockDeliveryDocs.push({
        webhookId: "webhook-1",
        event: "task.created",
        taskId: "task-123",
        status: "success",
        statusCode: null,
        attempt: 1,
        timestamp: new Date().toISOString(),
        error: null,
        payload: {},
      });

      const result = await webhookGetDeliveriesHandler(mockAuth, { limit: 10 });
      const data = JSON.parse(result.content[0].text);

      expect(data.success).toBe(true);
      expect(data.deliveries).toHaveLength(1);
      expect(data.deliveries[0].webhookId).toBe("webhook-1");
      expect(data.deliveries[0].status).toBe("success");
    });

    it("Delivery log records success/failure status after dispatch", async () => {
      mockWebhookDocs.push({
        id: "webhook-1",
        events: ["task.created"],
        callbackUrl: "https://example.com/webhook",
        secret: null,
        filter: null,
        enabled: true,
        createdBy: "basher",
      });

      await dispatchTaskWebhooks("test-user-123", {
        event: "task.created",
        taskId: "task-123",
        task: { id: "task-123" },
        timestamp: new Date().toISOString(),
        tenantId: "test-user-123",
      });

      // Wait for async delivery logging
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockDeliveryDocs).toHaveLength(1);
      expect(mockDeliveryDocs[0].webhookId).toBe("webhook-1");
      expect(mockDeliveryDocs[0].event).toBe("task.created");
      expect(mockDeliveryDocs[0].status).toBe("success");
    });
  });
});
