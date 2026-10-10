import crypto from 'node:crypto';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

// A software authenticator for tests. It builds real WebAuthn payloads (ES256, fmt none).

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export type Keys = { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject };

export function newKeys(): Keys {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
}

function sha256(data: Uint8Array | string): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

function counterBytes(counter: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(counter);
  return out;
}

function coseKey(publicKey: crypto.KeyObject): Uint8Array {
  const jwk = publicKey.export({ format: 'jwk' });
  const map = new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x ?? '', 'base64url')],
    [-3, Buffer.from(jwk.y ?? '', 'base64url')],
  ]);
  return isoCBOR.encode(map);
}

function clientData(type: string, challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

export type RegistrationInput = {
  rpId: string;
  origin: string;
  challenge: string;
  signCount?: number;
  credentialId?: Buffer;
  userVerified?: boolean;
  keys?: Keys;
};

export type MadeRegistration = {
  response: RegistrationResponseJSON;
  credentialId: string;
  keys: Keys;
};

export function makeRegistration(input: RegistrationInput): MadeRegistration {
  const keys = input.keys ?? newKeys();
  const credentialId = input.credentialId ?? crypto.randomBytes(32);
  const flags = FLAG_UP | FLAG_AT | (input.userVerified === true ? FLAG_UV : 0);
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(credentialId.length);
  const authData = Buffer.concat([
    sha256(input.rpId),
    Buffer.from([flags]),
    counterBytes(input.signCount ?? 0),
    Buffer.alloc(16),
    idLength,
    credentialId,
    coseKey(keys.publicKey),
  ]);
  const attestation = isoCBOR.encode(
    new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]) as never,
  );
  const id = isoBase64URL.fromBuffer(new Uint8Array(credentialId));
  return {
    credentialId: id,
    keys,
    response: {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientData('webauthn.create', input.challenge, input.origin).toString(
          'base64url',
        ),
        attestationObject: Buffer.from(attestation).toString('base64url'),
        transports: ['internal'],
      },
    },
  };
}

export type AssertionInput = {
  rpId: string;
  origin: string;
  challenge: string;
  credentialId: string;
  privateKey: crypto.KeyObject;
  counter: number;
  userVerified?: boolean;
};

export function makeAssertion(input: AssertionInput): AuthenticationResponseJSON {
  const flags = FLAG_UP | (input.userVerified === true ? FLAG_UV : 0);
  const authData = Buffer.concat([
    sha256(input.rpId),
    Buffer.from([flags]),
    counterBytes(input.counter),
  ]);
  const data = clientData('webauthn.get', input.challenge, input.origin);
  const signature = crypto.sign(
    'sha256',
    Buffer.concat([authData, sha256(data)]),
    input.privateKey,
  );
  return {
    id: input.credentialId,
    rawId: input.credentialId,
    type: 'public-key',
    clientExtensionResults: {},
    response: {
      clientDataJSON: data.toString('base64url'),
      authenticatorData: authData.toString('base64url'),
      signature: signature.toString('base64url'),
    },
  };
}
