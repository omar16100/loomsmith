import { describe, expect, it } from "vitest";
import { create_memory_logger, null_logger } from "../src/log.ts";

describe("logger", () => {
  it("records entries with level, message and data", () => {
    const log = create_memory_logger();
    log.info("batch applied", { revision: 1 });
    log.warn("batch rejected");
    expect(log.entries).toEqual([
      { level: "info", message: "batch applied", data: { revision: 1 } },
      { level: "warn", message: "batch rejected", data: null },
    ]);
  });

  it("null logger accepts calls silently", () => {
    expect(() => null_logger.error("ignored", { a: 1 })).not.toThrow();
  });
});
