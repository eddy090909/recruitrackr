import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, getSetting, setDb } from "@/lib/db";
import type { RawEmail } from "@/lib/classify";

const gmail = vi.hoisted(() => ({ listCandidateIds: vi.fn(), fetchEmails: vi.fn() }));
vi.mock("@/lib/gmail", () => gmail);

const { runSync } = await import("@/lib/sync");

const email = (id: string): RawEmail => ({
  gmailId: id,
  threadId: `t-${id}`,
  subject: "Thank you for applying to Acme",
  sender: "Acme Careers <jobs@acme.com>",
  date: new Date().toISOString(),
  body: "Thank you for applying to Acme. We have received your application.",
});

beforeEach(async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("MAX_EMAILS_PER_SYNC", "2");
  setDb(await createDb("memory"));
  gmail.listCandidateIds.mockReset().mockResolvedValue(["a", "b", "c"]);
  gmail.fetchEmails.mockReset().mockImplementation(async (ids: string[]) => ids.map(email));
});

describe("runSync backlog", () => {
  it("searches Gmail once and works through the saved backlog over several runs", async () => {
    expect(await runSync()).toMatchObject({ fetched: 2, remaining: 1 });
    expect(await getSetting("last_sync_at")).toBeNull();
    expect(await runSync()).toMatchObject({ fetched: 1, remaining: 0 });
    expect(gmail.listCandidateIds).toHaveBeenCalledTimes(1);
    expect(gmail.fetchEmails.mock.calls).toEqual([[["a", "b"]], [["c"]]]);
    expect(await getSetting("last_sync_at")).not.toBeNull();
  });

  it("keeps the backlog when fetching fails, so nothing is lost or searched again", async () => {
    gmail.fetchEmails.mockRejectedValueOnce(new Error("rate limited"));
    await expect(runSync()).rejects.toThrow("rate limited");
    expect(JSON.parse((await getSetting("sync_backlog"))!)).toEqual(["a", "b", "c"]);
    expect(await runSync()).toMatchObject({ fetched: 2, remaining: 1 });
    expect(gmail.listCandidateIds).toHaveBeenCalledTimes(1);
  });
});
