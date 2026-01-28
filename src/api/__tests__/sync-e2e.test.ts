/**
 * E2E tests for sync client/server communication.
 *
 * These tests verify the full sync workflow between an iOS client
 * and the desktop sync server.
 *
 * To run these tests, you need:
 * 1. The sync server running on localhost:17950
 * 2. A known auth token set via environment variable
 *
 * Run with:
 *   SYNC_SERVER_URL=http://localhost:17950 SYNC_AUTH_TOKEN=your-token npm test -- sync-e2e
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createSyncClient, SyncError, type SyncClient } from "../sync-client";

// Skip tests if environment not configured
const SYNC_SERVER_URL = process.env.SYNC_SERVER_URL || "";
const SYNC_AUTH_TOKEN = process.env.SYNC_AUTH_TOKEN || "";
const RUN_E2E = SYNC_SERVER_URL && SYNC_AUTH_TOKEN;

describe.skipIf(!RUN_E2E)("Sync Server E2E Tests", () => {
  let client: SyncClient;

  beforeAll(() => {
    client = createSyncClient({
      serverUrl: SYNC_SERVER_URL,
      authToken: SYNC_AUTH_TOKEN,
    });
  });

  afterAll(() => {
    client.disconnect();
  });

  describe("Connection", () => {
    it("should connect successfully with valid credentials", async () => {
      await expect(client.connect()).resolves.not.toThrow();
      expect(client.status).toBe("connected");
    });

    it("should fail to connect with invalid token", async () => {
      const badClient = createSyncClient({
        serverUrl: SYNC_SERVER_URL,
        authToken: "invalid-token",
      });

      await expect(badClient.connect()).rejects.toThrow();
      badClient.disconnect();
    });
  });

  describe("Health Check", () => {
    it("should return health status", async () => {
      const response = await fetch(`${SYNC_SERVER_URL}/api/health`, {
        headers: { Authorization: `Bearer ${SYNC_AUTH_TOKEN}` },
      });
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.version).toBeDefined();
    });
  });

  describe("Repository Operations", () => {
    it("should list repositories", async () => {
      const repos = await client.listRepos();
      expect(Array.isArray(repos)).toBe(true);
      // May be empty if no repos registered
    });
  });

  describe("Taxonomy", () => {
    it("should get trust taxonomy", async () => {
      const response = await fetch(`${SYNC_SERVER_URL}/api/taxonomy`, {
        headers: { Authorization: `Bearer ${SYNC_AUTH_TOKEN}` },
      });
      expect(response.ok).toBe(true);

      const taxonomy = await response.json();
      expect(Array.isArray(taxonomy)).toBe(true);
    });
  });

  describe("Server Info", () => {
    it("should get server info", async () => {
      const response = await fetch(`${SYNC_SERVER_URL}/api/server/info`, {
        headers: { Authorization: `Bearer ${SYNC_AUTH_TOKEN}` },
      });
      expect(response.ok).toBe(true);

      const info = await response.json();
      expect(info.version).toBeDefined();
      expect(typeof info.client_count).toBe("number");
    });

    it("should list connected clients", async () => {
      const response = await fetch(`${SYNC_SERVER_URL}/api/server/clients`, {
        headers: { Authorization: `Bearer ${SYNC_AUTH_TOKEN}` },
      });
      expect(response.ok).toBe(true);

      const clients = await response.json();
      expect(Array.isArray(clients)).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("should return 401 for missing auth", async () => {
      const response = await fetch(`${SYNC_SERVER_URL}/api/repos`);
      expect(response.status).toBe(401);
    });

    it("should return 401 for wrong auth", async () => {
      const response = await fetch(`${SYNC_SERVER_URL}/api/repos`, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(response.status).toBe(401);
    });

    it("should return 400 for invalid repo ID", async () => {
      const response = await fetch(
        `${SYNC_SERVER_URL}/api/repos/not-valid-base64!`,
        {
          headers: { Authorization: `Bearer ${SYNC_AUTH_TOKEN}` },
        },
      );
      expect(response.status).toBe(400);
    });
  });
});

describe.skipIf(!RUN_E2E)("Sync Client Unit Tests", () => {
  describe("createSyncClient", () => {
    it("should create client with config", () => {
      const testClient = createSyncClient({
        serverUrl: "http://localhost:17950",
        authToken: "test-token",
      });

      expect(testClient).toBeDefined();
      expect(testClient.status).toBe("disconnected");
      testClient.disconnect();
    });
  });

  describe("SyncError", () => {
    it("should create error with status code", () => {
      const error = new SyncError(404, "Test error");
      expect(error.message).toBe("Test error");
      expect(error.status).toBe(404);
      expect(error.name).toBe("SyncError");
    });
  });
});
