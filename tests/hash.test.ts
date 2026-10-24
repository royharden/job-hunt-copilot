import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex, utf8Bytes } from "../supabase/functions/_shared/provenance/hash.ts";

describe("hash", () => {
  // what_bug_this_catches: a hand-written SHA-256 that disagrees with the standard would make server and
  // browser binding hashes meaningless.
  it("matches published SHA-256 vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("encodes UTF-8 including astral characters", () => {
    expect(utf8Bytes("é")).toEqual([0xc3, 0xa9]);
    expect(utf8Bytes("\u{1F600}")).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  // what_bug_this_catches: key-order-dependent serialization would make identical bindings hash differently.
  it("serializes canonically regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"], c: undefined })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});
