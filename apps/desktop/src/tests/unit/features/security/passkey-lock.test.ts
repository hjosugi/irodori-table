import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  derEcdsaSignatureToRaw,
  normalizePasskeyCredentialRecord,
} from "@/features/security/passkey-lock";

describe("passkey lock helpers", () => {
  it("round-trips base64url without padding", () => {
    const input = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = base64UrlEncode(input);

    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect([...base64UrlDecode(encoded)]).toEqual([...input]);
  });

  it("converts DER ECDSA signatures to fixed-width raw signatures", () => {
    const der = new Uint8Array([
      0x30, 0x0a, 0x02, 0x03, 0x00, 0x7f, 0x01, 0x02, 0x03, 0x00, 0x80, 0x02,
    ]);

    const raw = derEcdsaSignatureToRaw(der, 4);

    expect([...raw]).toEqual([0x00, 0x00, 0x7f, 0x01, 0x00, 0x00, 0x80, 0x02]);
  });

  it("normalizes only current passkey credential records", () => {
    const record = {
      schemaVersion: 1,
      id: "credential",
      publicKey: "key",
      algorithm: "ES256",
      createdAt: 123,
      label: "Irodori Table",
      userHandle: "user",
    };

    expect(normalizePasskeyCredentialRecord(record)).toEqual(record);
    expect(
      normalizePasskeyCredentialRecord({ ...record, algorithm: "EdDSA" }),
    ).toBeNull();
    expect(
      normalizePasskeyCredentialRecord({ ...record, schemaVersion: 2 }),
    ).toBeNull();
  });
});
