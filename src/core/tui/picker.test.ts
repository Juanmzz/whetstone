import { describe, expect, it } from "vitest";
import { openPicker, pressPicker, renderPicker, type PickerState } from "./picker.js";

const OPTIONS = [
  { value: "a", label: "A", detail: "what A does" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
];

const open = (picked: readonly string[] = []): PickerState =>
  openPicker("pick", "why you are being asked", OPTIONS, picked);

const at = (s: PickerState, keys: string[]): PickerState =>
  keys.reduce((acc, k) => pressPicker(acc, k).state, s);

describe("pressPicker", () => {
  it("toggles the option under the cursor", () => {
    expect(at(open(), ["space"]).picked).toEqual(["a"]);
    expect(at(open(), ["space", "space"]).picked).toEqual([]);
  });

  it("clamps the cursor rather than wrapping it", () => {
    expect(at(open(), ["up"]).cursor).toBe(0);
    expect(at(open(), ["down", "down", "down", "down"]).cursor).toBe(2);
  });

  it("answers in the order the screen showed, not the order they were ticked", () => {
    // The first pick with an adapter is the one that drafts, so an answer that
    // depended on click order would be a decision nobody could predict.
    const s = at(open(), ["down", "down", "space", "up", "up", "space"]);
    expect(pressPicker(s, "return").action).toEqual({ kind: "done", picked: ["a", "c"] });
  });

  it("finishes on enter and on ctrl-d, because both mean `go on` here", () => {
    for (const key of ["return", "ctrl-d"]) {
      expect(pressPicker(at(open(), ["space"]), key).action).toEqual({
        kind: "done",
        picked: ["a"],
      });
    }
  });

  it("finishes with nothing picked, which is a legitimate answer", () => {
    expect(pressPicker(open(), "return").action).toEqual({ kind: "done", picked: [] });
  });

  it("cancels on escape without answering", () => {
    expect(pressPicker(open(), "escape").action).toEqual({ kind: "cancel" });
  });

  it("opens with what it was given already ticked", () => {
    expect(open(["b"]).picked).toEqual(["b"]);
  });
});

describe("renderPicker", () => {
  it("shows a mark against what is picked", () => {
    expect(renderPicker(open(["a"])).join("\n")).toMatch(/\[x\] A/);
    expect(renderPicker(open(["a"])).join("\n")).toMatch(/\[ \] B/);
  });

  it("says what the option under the cursor does, and only that one", () => {
    const screen = renderPicker(open()).join("\n");
    expect(screen).toContain("what A does");
  });

  it("says why the question is being asked at all", () => {
    expect(renderPicker(open()).join("\n")).toContain("why you are being asked");
  });

  it("documents every key that does something", () => {
    const legend = renderPicker(open()).join("\n");
    for (const key of ["space", "enter", "esc"]) expect(legend).toContain(key);
  });

  it("keeps every line inside a default terminal", () => {
    for (const line of renderPicker(open())) expect(line.length).toBeLessThanOrEqual(80);
  });
});
