import { describe, expect, it } from "vitest";
import { all_harnesses, in_scope } from "../src/model/scope.ts";

describe("scope", () => {
  it("keeps the shared all_harnesses default from being mutated by a caller", () => {
    expect(() => {
      // @ts-expect-error: exercising a runtime mutation attempt on the frozen shared default
      all_harnesses.harness_ids = ["h1"];
    }).toThrow();
    expect(all_harnesses.harness_ids).toBeNull();
    expect(in_scope(all_harnesses, "anything")).toBe(true);
  });
});
