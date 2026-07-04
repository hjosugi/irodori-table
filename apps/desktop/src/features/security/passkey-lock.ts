export type PasskeyAlgorithm = "ES256" | "RS256";

export type PasskeyCredentialRecord = {
  schemaVersion: 1;
  id: string;
  publicKey: string;
  algorithm: PasskeyAlgorithm;
  createdAt: number;
  label: string;
  userHandle: string;
};

export type PasskeyAvailability = {
  supported: boolean;
  platformAuthenticator: boolean | null;
  reason?: string;
};

const passkeyRecordSchemaVersion = 1;
const es256Algorithm = -7;
const rs256Algorithm = -257;
const challengeBytes = 32;
const userHandleBytes = 32;
const defaultTimeoutMs = 60_000;

export async function checkPasskeyAvailability(): Promise<PasskeyAvailability> {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      supported: false,
      platformAuthenticator: null,
      reason: "window-unavailable",
    };
  }
  if (
    !("PublicKeyCredential" in window) ||
    typeof navigator.credentials?.create !== "function" ||
    typeof navigator.credentials?.get !== "function"
  ) {
    return {
      supported: false,
      platformAuthenticator: null,
      reason: "webauthn-unavailable",
    };
  }

  const credentialConstructor = window.PublicKeyCredential;
  const canCheckPlatform =
    typeof credentialConstructor.isUserVerifyingPlatformAuthenticatorAvailable ===
    "function";
  if (!canCheckPlatform) {
    return {
      supported: true,
      platformAuthenticator: null,
    };
  }

  try {
    const platformAuthenticator =
      await credentialConstructor.isUserVerifyingPlatformAuthenticatorAvailable();
    return {
      supported: true,
      platformAuthenticator,
    };
  } catch {
    return {
      supported: true,
      platformAuthenticator: null,
      reason: "platform-check-failed",
    };
  }
}

export async function registerPasskeyCredential(
  label = "Irodori Table",
): Promise<PasskeyCredentialRecord> {
  assertWebAuthnAvailable();
  const challenge = randomBytes(challengeBytes);
  const userHandle = randomBytes(userHandleBytes);
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: bytesToArrayBuffer(challenge),
      rp: { name: "Irodori Table" },
      user: {
        id: bytesToArrayBuffer(userHandle),
        name: "irodori-local",
        displayName: "Irodori local user",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: es256Algorithm },
        { type: "public-key", alg: rs256Algorithm },
      ],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: defaultTimeoutMs,
      attestation: "none",
    },
  });
  const publicKeyCredential = assertPublicKeyCredential(credential);
  const response =
    publicKeyCredential.response as AuthenticatorAttestationResponse & {
      getPublicKey?: () => ArrayBuffer | null;
      getPublicKeyAlgorithm?: () => number;
    };
  const publicKey = response.getPublicKey?.();
  const publicKeyAlgorithm = response.getPublicKeyAlgorithm?.();
  if (!publicKey || typeof publicKeyAlgorithm !== "number") {
    throw new Error("passkey public key export is unavailable");
  }
  const algorithm = passkeyAlgorithmFromCose(publicKeyAlgorithm);
  return {
    schemaVersion: passkeyRecordSchemaVersion,
    id: base64UrlEncode(publicKeyCredential.rawId),
    publicKey: base64UrlEncode(publicKey),
    algorithm,
    createdAt: Date.now(),
    label,
    userHandle: base64UrlEncode(userHandle),
  };
}

export async function authenticatePasskeyCredential(
  credentialRecord: PasskeyCredentialRecord,
): Promise<void> {
  assertWebAuthnAvailable();
  const challenge = randomBytes(challengeBytes);
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: bytesToArrayBuffer(challenge),
      allowCredentials: [
        {
          type: "public-key",
          id: bytesToArrayBuffer(base64UrlDecode(credentialRecord.id)),
        },
      ],
      userVerification: "required",
      timeout: defaultTimeoutMs,
    },
  });
  const publicKeyCredential = assertPublicKeyCredential(credential);
  const response =
    publicKeyCredential.response as AuthenticatorAssertionResponse;
  const clientData = parseClientData(response.clientDataJSON);
  if (clientData.type !== "webauthn.get") {
    throw new Error("passkey assertion had an unexpected type");
  }
  if (clientData.challenge !== base64UrlEncode(challenge)) {
    throw new Error("passkey challenge did not match");
  }
  if (
    typeof window !== "undefined" &&
    typeof clientData.origin === "string" &&
    clientData.origin !== window.location.origin
  ) {
    throw new Error("passkey origin did not match this app");
  }
  const verified = await verifyPasskeyAssertion(
    credentialRecord,
    response.authenticatorData,
    response.clientDataJSON,
    response.signature,
  );
  if (!verified) {
    throw new Error("passkey signature could not be verified");
  }
}

export function normalizePasskeyCredentialRecord(
  value: unknown,
): PasskeyCredentialRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.schemaVersion !== passkeyRecordSchemaVersion) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.publicKey !== "string" ||
    typeof value.createdAt !== "number" ||
    typeof value.label !== "string" ||
    typeof value.userHandle !== "string"
  ) {
    return null;
  }
  if (value.algorithm !== "ES256" && value.algorithm !== "RS256") {
    return null;
  }
  return {
    schemaVersion: passkeyRecordSchemaVersion,
    id: value.id,
    publicKey: value.publicKey,
    algorithm: value.algorithm,
    createdAt: value.createdAt,
    label: value.label,
    userHandle: value.userHandle,
  };
}

export function base64UrlEncode(input: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function derEcdsaSignatureToRaw(
  signature: Uint8Array,
  coordinateLength = 32,
): Uint8Array {
  let offset = 0;
  if (signature[offset] !== 0x30) {
    throw new Error("invalid ECDSA signature sequence");
  }
  offset += 1;
  const sequenceLength = readDerLength(signature, offset);
  offset = sequenceLength.nextOffset;
  if (offset + sequenceLength.length !== signature.length) {
    throw new Error("invalid ECDSA signature length");
  }
  const r = readDerInteger(signature, offset);
  offset = r.nextOffset;
  const s = readDerInteger(signature, offset);
  if (s.nextOffset !== signature.length) {
    throw new Error("invalid ECDSA signature trailing data");
  }
  const raw = new Uint8Array(coordinateLength * 2);
  raw.set(leftPadCoordinate(r.value, coordinateLength), 0);
  raw.set(leftPadCoordinate(s.value, coordinateLength), coordinateLength);
  return raw;
}

async function verifyPasskeyAssertion(
  credentialRecord: PasskeyCredentialRecord,
  authenticatorData: ArrayBuffer,
  clientDataJSON: ArrayBuffer,
  signature: ArrayBuffer,
): Promise<boolean> {
  const clientDataHash = await crypto.subtle.digest("SHA-256", clientDataJSON);
  const signedData = concatBytes(
    new Uint8Array(authenticatorData),
    new Uint8Array(clientDataHash),
  );
  const publicKey = base64UrlDecode(credentialRecord.publicKey);
  if (credentialRecord.algorithm === "ES256") {
    const key = await crypto.subtle.importKey(
      "spki",
      bytesToArrayBuffer(publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const rawSignature = derEcdsaSignatureToRaw(new Uint8Array(signature));
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      bytesToArrayBuffer(rawSignature),
      bytesToArrayBuffer(signedData),
    );
  }
  const key = await crypto.subtle.importKey(
    "spki",
    bytesToArrayBuffer(publicKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    signature,
    bytesToArrayBuffer(signedData),
  );
}

function assertWebAuthnAvailable() {
  if (
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !("PublicKeyCredential" in window) ||
    typeof navigator.credentials?.create !== "function" ||
    typeof navigator.credentials?.get !== "function" ||
    typeof crypto?.subtle?.verify !== "function"
  ) {
    throw new Error("passkey is not available in this runtime");
  }
}

function assertPublicKeyCredential(
  credential: Credential | null,
): PublicKeyCredential {
  if (!credential || credential.type !== "public-key") {
    throw new Error("passkey operation did not return a public key credential");
  }
  return credential as PublicKeyCredential;
}

function passkeyAlgorithmFromCose(value: number): PasskeyAlgorithm {
  if (value === es256Algorithm) {
    return "ES256";
  }
  if (value === rs256Algorithm) {
    return "RS256";
  }
  throw new Error(`unsupported passkey algorithm: ${value}`);
}

function parseClientData(input: ArrayBuffer): {
  type?: string;
  challenge?: string;
  origin?: string;
} {
  const decoded = new TextDecoder().decode(input);
  const parsed = JSON.parse(decoded) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("passkey client data was not an object");
  }
  return parsed;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const combined = new Uint8Array(first.length + second.length);
  combined.set(first, 0);
  combined.set(second, first.length);
  return combined;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function readDerLength(bytes: Uint8Array, offset: number) {
  const first = bytes[offset];
  if (first === undefined) {
    throw new Error("missing DER length");
  }
  if ((first & 0x80) === 0) {
    return { length: first, nextOffset: offset + 1 };
  }
  const byteCount = first & 0x7f;
  if (byteCount === 0 || byteCount > 2) {
    throw new Error("unsupported DER length");
  }
  let length = 0;
  for (let index = 0; index < byteCount; index += 1) {
    const next = bytes[offset + 1 + index];
    if (next === undefined) {
      throw new Error("truncated DER length");
    }
    length = (length << 8) | next;
  }
  return { length, nextOffset: offset + 1 + byteCount };
}

function readDerInteger(bytes: Uint8Array, offset: number) {
  if (bytes[offset] !== 0x02) {
    throw new Error("missing DER integer");
  }
  const length = readDerLength(bytes, offset + 1);
  const start = length.nextOffset;
  const end = start + length.length;
  if (end > bytes.length) {
    throw new Error("truncated DER integer");
  }
  return {
    value: bytes.slice(start, end),
    nextOffset: end,
  };
}

function leftPadCoordinate(value: Uint8Array, length: number): Uint8Array {
  let trimmed = value;
  while (trimmed.length > 0 && trimmed[0] === 0) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.length > length) {
    throw new Error("ECDSA coordinate is too long");
  }
  const output = new Uint8Array(length);
  output.set(trimmed, length - trimmed.length);
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
