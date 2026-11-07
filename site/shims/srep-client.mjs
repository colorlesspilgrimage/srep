// node_modules/@simplewebauthn/browser/esm/helpers/bufferToBase64URLString.js
function bufferToBase64URLString(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const charCode of bytes) {
    str += String.fromCharCode(charCode);
  }
  const base64String = btoa(str);
  return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// node_modules/@simplewebauthn/browser/esm/helpers/base64URLStringToBuffer.js
function base64URLStringToBuffer(base64URLString) {
  const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - base64.length % 4) % 4;
  const padded = base64.padEnd(base64.length + padLength, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

// node_modules/@simplewebauthn/browser/esm/helpers/browserSupportsWebAuthn.js
function browserSupportsWebAuthn() {
  return _browserSupportsWebAuthnInternals.stubThis(globalThis?.PublicKeyCredential !== void 0 && typeof globalThis.PublicKeyCredential === "function");
}
var _browserSupportsWebAuthnInternals = {
  stubThis: (value) => value
};

// node_modules/@simplewebauthn/browser/esm/helpers/toPublicKeyCredentialDescriptor.js
function toPublicKeyCredentialDescriptor(descriptor) {
  const { id } = descriptor;
  return {
    ...descriptor,
    id: base64URLStringToBuffer(id),
    /**
     * `descriptor.transports` is an array of our `AuthenticatorTransportFuture` that includes newer
     * transports that TypeScript's DOM lib is ignorant of. Convince TS that our list of transports
     * are fine to pass to WebAuthn since browsers will recognize the new value.
     */
    transports: descriptor.transports
  };
}

// node_modules/@simplewebauthn/browser/esm/helpers/isValidDomain.js
function isValidDomain(hostname) {
  return (
    // Consider localhost valid as well since it's okay wrt Secure Contexts
    hostname === "localhost" || // Support punycode (ACE) or ascii labels and domains
    /^((xn--[a-z0-9-]+|[a-z0-9]+(-[a-z0-9]+)*)\.)+([a-z]{2,}|xn--[a-z0-9-]+)$/i.test(hostname)
  );
}

// node_modules/@simplewebauthn/browser/esm/helpers/webAuthnError.js
var WebAuthnError = class extends Error {
  constructor({ message, code, cause, name }) {
    super(message, { cause });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.name = name ?? cause.name;
    this.code = code;
  }
};

// node_modules/@simplewebauthn/browser/esm/helpers/identifyRegistrationError.js
function identifyRegistrationError({ error, options }) {
  const { publicKey } = options;
  if (!publicKey) {
    throw Error("options was missing required publicKey property");
  }
  if (error.name === "AbortError") {
    if (options.signal instanceof AbortSignal) {
      return new WebAuthnError({
        message: "Registration ceremony was sent an abort signal",
        code: "ERROR_CEREMONY_ABORTED",
        cause: error
      });
    }
  } else if (error.name === "ConstraintError") {
    if (publicKey.authenticatorSelection?.requireResidentKey === true) {
      return new WebAuthnError({
        message: "Discoverable credentials were required but no available authenticator supported it",
        code: "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",
        cause: error
      });
    } else if (
      // @ts-ignore: `mediation` doesn't yet exist on CredentialCreationOptions but it's possible as of Sept 2024
      options.mediation === "conditional" && publicKey.authenticatorSelection?.userVerification === "required"
    ) {
      return new WebAuthnError({
        message: "User verification was required during automatic registration but it could not be performed",
        code: "ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE",
        cause: error
      });
    } else if (publicKey.authenticatorSelection?.userVerification === "required") {
      return new WebAuthnError({
        message: "User verification was required but no available authenticator supported it",
        code: "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",
        cause: error
      });
    }
  } else if (error.name === "InvalidStateError") {
    return new WebAuthnError({
      message: "The authenticator was previously registered",
      code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      cause: error
    });
  } else if (error.name === "NotAllowedError") {
    return new WebAuthnError({
      message: error.message,
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: error
    });
  } else if (error.name === "NotSupportedError") {
    const validPubKeyCredParams = publicKey.pubKeyCredParams.filter((param) => param.type === "public-key");
    if (validPubKeyCredParams.length === 0) {
      return new WebAuthnError({
        message: 'No entry in pubKeyCredParams was of type "public-key"',
        code: "ERROR_MALFORMED_PUBKEYCREDPARAMS",
        cause: error
      });
    }
    return new WebAuthnError({
      message: "No available authenticator supported any of the specified pubKeyCredParams algorithms",
      code: "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG",
      cause: error
    });
  } else if (error.name === "SecurityError") {
    const effectiveDomain = globalThis.location.hostname;
    if (!isValidDomain(effectiveDomain)) {
      return new WebAuthnError({
        message: `${globalThis.location.hostname} is an invalid domain`,
        code: "ERROR_INVALID_DOMAIN",
        cause: error
      });
    } else if (publicKey.rp.id !== effectiveDomain) {
      return new WebAuthnError({
        message: `The RP ID "${publicKey.rp.id}" is invalid for this domain`,
        code: "ERROR_INVALID_RP_ID",
        cause: error
      });
    }
  } else if (error.name === "TypeError") {
    if (publicKey.user.id.byteLength < 1 || publicKey.user.id.byteLength > 64) {
      return new WebAuthnError({
        message: "User ID was not between 1 and 64 characters",
        code: "ERROR_INVALID_USER_ID_LENGTH",
        cause: error
      });
    }
  } else if (error.name === "UnknownError") {
    return new WebAuthnError({
      message: "The authenticator was unable to process the specified options, or could not create a new credential",
      code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
      cause: error
    });
  }
  return error;
}

// node_modules/@simplewebauthn/browser/esm/helpers/webAuthnAbortService.js
var BaseWebAuthnAbortService = class {
  constructor() {
    Object.defineProperty(this, "controller", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
  }
  createNewAbortSignal() {
    if (this.controller) {
      const abortError = new Error("Cancelling existing WebAuthn API call for new one");
      abortError.name = "AbortError";
      this.controller.abort(abortError);
    }
    const newController = new AbortController();
    this.controller = newController;
    return newController.signal;
  }
  cancelCeremony() {
    if (this.controller) {
      const abortError = new Error("Manually cancelling existing WebAuthn API call");
      abortError.name = "AbortError";
      this.controller.abort(abortError);
      this.controller = void 0;
    }
  }
};
var WebAuthnAbortService = new BaseWebAuthnAbortService();

// node_modules/@simplewebauthn/browser/esm/helpers/toAuthenticatorAttachment.js
var attachments = ["cross-platform", "platform"];
function toAuthenticatorAttachment(attachment) {
  if (!attachment) {
    return;
  }
  if (attachments.indexOf(attachment) < 0) {
    return;
  }
  return attachment;
}

// node_modules/@simplewebauthn/browser/esm/methods/startRegistration.js
async function startRegistration(options) {
  if (!options.optionsJSON && options.challenge) {
    console.warn("startRegistration() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information.");
    options = { optionsJSON: options };
  }
  const { optionsJSON, useAutoRegister = false } = options;
  if (!browserSupportsWebAuthn()) {
    throw new Error("WebAuthn is not supported in this browser");
  }
  const publicKey = {
    ...optionsJSON,
    challenge: base64URLStringToBuffer(optionsJSON.challenge),
    user: {
      ...optionsJSON.user,
      id: base64URLStringToBuffer(optionsJSON.user.id)
    },
    excludeCredentials: optionsJSON.excludeCredentials?.map(toPublicKeyCredentialDescriptor)
  };
  const createOptions = {};
  if (useAutoRegister) {
    createOptions.mediation = "conditional";
  }
  createOptions.publicKey = publicKey;
  createOptions.signal = WebAuthnAbortService.createNewAbortSignal();
  let credential;
  try {
    credential = await navigator.credentials.create(createOptions);
  } catch (err) {
    throw identifyRegistrationError({ error: err, options: createOptions });
  }
  if (!credential) {
    throw new Error("Registration was not completed");
  }
  const { id, rawId, response, type } = credential;
  let transports = void 0;
  if (typeof response.getTransports === "function") {
    transports = response.getTransports();
  }
  let responsePublicKeyAlgorithm = void 0;
  if (typeof response.getPublicKeyAlgorithm === "function") {
    try {
      responsePublicKeyAlgorithm = response.getPublicKeyAlgorithm();
    } catch (error) {
      warnOnBrokenImplementation("getPublicKeyAlgorithm()", error);
    }
  }
  let responsePublicKey = void 0;
  if (typeof response.getPublicKey === "function") {
    try {
      const _publicKey = response.getPublicKey();
      if (_publicKey !== null) {
        responsePublicKey = bufferToBase64URLString(_publicKey);
      }
    } catch (error) {
      warnOnBrokenImplementation("getPublicKey()", error);
    }
  }
  let responseAuthenticatorData;
  if (typeof response.getAuthenticatorData === "function") {
    try {
      responseAuthenticatorData = bufferToBase64URLString(response.getAuthenticatorData());
    } catch (error) {
      warnOnBrokenImplementation("getAuthenticatorData()", error);
    }
  }
  return {
    id,
    rawId: bufferToBase64URLString(rawId),
    response: {
      attestationObject: bufferToBase64URLString(response.attestationObject),
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      transports,
      publicKeyAlgorithm: responsePublicKeyAlgorithm,
      publicKey: responsePublicKey,
      authenticatorData: responseAuthenticatorData
    },
    type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: toAuthenticatorAttachment(credential.authenticatorAttachment)
  };
}
function warnOnBrokenImplementation(methodName, cause) {
  console.warn(`The browser extension that intercepted this WebAuthn API call incorrectly implemented ${methodName}. You should report this error to them.
`, cause);
}

// node_modules/@simplewebauthn/browser/esm/helpers/browserSupportsWebAuthnAutofill.js
function browserSupportsWebAuthnAutofill() {
  if (!browserSupportsWebAuthn()) {
    return _browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
  }
  const globalPublicKeyCredential = globalThis.PublicKeyCredential;
  if (globalPublicKeyCredential?.isConditionalMediationAvailable === void 0) {
    return _browserSupportsWebAuthnAutofillInternals.stubThis(new Promise((resolve) => resolve(false)));
  }
  return _browserSupportsWebAuthnAutofillInternals.stubThis(globalPublicKeyCredential.isConditionalMediationAvailable());
}
var _browserSupportsWebAuthnAutofillInternals = {
  stubThis: (value) => value
};

// node_modules/@simplewebauthn/browser/esm/helpers/identifyAuthenticationError.js
function identifyAuthenticationError({ error, options }) {
  const { publicKey } = options;
  if (!publicKey) {
    throw Error("options was missing required publicKey property");
  }
  if (error.name === "AbortError") {
    if (options.signal instanceof AbortSignal) {
      return new WebAuthnError({
        message: "Authentication ceremony was sent an abort signal",
        code: "ERROR_CEREMONY_ABORTED",
        cause: error
      });
    }
  } else if (error.name === "NotAllowedError") {
    return new WebAuthnError({
      message: error.message,
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: error
    });
  } else if (error.name === "SecurityError") {
    const effectiveDomain = globalThis.location.hostname;
    if (!isValidDomain(effectiveDomain)) {
      return new WebAuthnError({
        message: `${globalThis.location.hostname} is an invalid domain`,
        code: "ERROR_INVALID_DOMAIN",
        cause: error
      });
    } else if (publicKey.rpId !== effectiveDomain) {
      return new WebAuthnError({
        message: `The RP ID "${publicKey.rpId}" is invalid for this domain`,
        code: "ERROR_INVALID_RP_ID",
        cause: error
      });
    }
  } else if (error.name === "UnknownError") {
    return new WebAuthnError({
      message: "The authenticator was unable to process the specified options, or could not create a new assertion signature",
      code: "ERROR_AUTHENTICATOR_GENERAL_ERROR",
      cause: error
    });
  }
  return error;
}

// node_modules/@simplewebauthn/browser/esm/methods/startAuthentication.js
async function startAuthentication(options) {
  if (!options.optionsJSON && options.challenge) {
    console.warn("startAuthentication() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information.");
    options = { optionsJSON: options };
  }
  const { optionsJSON, useBrowserAutofill = false, verifyBrowserAutofillInput = true } = options;
  if (!browserSupportsWebAuthn()) {
    throw new Error("WebAuthn is not supported in this browser");
  }
  let allowCredentials;
  if (optionsJSON.allowCredentials?.length !== 0) {
    allowCredentials = optionsJSON.allowCredentials?.map(toPublicKeyCredentialDescriptor);
  }
  const publicKey = {
    ...optionsJSON,
    challenge: base64URLStringToBuffer(optionsJSON.challenge),
    allowCredentials
  };
  const getOptions = {};
  if (useBrowserAutofill) {
    if (!await browserSupportsWebAuthnAutofill()) {
      throw Error("Browser does not support WebAuthn autofill");
    }
    const eligibleInputs = document.querySelectorAll("input[autocomplete$='webauthn']");
    if (eligibleInputs.length < 1 && verifyBrowserAutofillInput) {
      throw Error('No <input> with "webauthn" as the only or last value in its `autocomplete` attribute was detected');
    }
    getOptions.mediation = "conditional";
    publicKey.allowCredentials = [];
  }
  getOptions.publicKey = publicKey;
  getOptions.signal = WebAuthnAbortService.createNewAbortSignal();
  let credential;
  try {
    credential = await navigator.credentials.get(getOptions);
  } catch (err) {
    throw identifyAuthenticationError({ error: err, options: getOptions });
  }
  if (!credential) {
    throw new Error("Authentication was not completed");
  }
  const { id, rawId, response, type } = credential;
  let userHandle = void 0;
  if (response.userHandle) {
    userHandle = bufferToBase64URLString(response.userHandle);
  }
  return {
    id,
    rawId: bufferToBase64URLString(rawId),
    response: {
      authenticatorData: bufferToBase64URLString(response.authenticatorData),
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      signature: bufferToBase64URLString(response.signature),
      userHandle
    },
    type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: toAuthenticatorAttachment(credential.authenticatorAttachment)
  };
}

// scripts/client-entry.mjs
var csrfToken = null;
var MESSAGES = {
  setup_token_invalid: "The setup token is not correct.",
  setup_locked: "Setup is already done.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  verification_failed: "The browser answer was not accepted. Try again.",
  login_failed: "Login failed.",
  recovery_failed: "The recovery code is not valid or was used before.",
  no_security_key: "No security key is enrolled.",
  challenge_expired: "The request expired. Try again.",
  challenge_invalid: "The request is not valid. Try again.",
  invalid_nickname: "The nickname must have 1 to 64 characters.",
  duplicate_credential: "This credential is already enrolled.",
  last_credential: "You cannot remove your last credential.",
  network_error: "The server did not answer."
};
function messageFor(code) {
  return MESSAGES[code] ?? "Something went wrong. Try again.";
}
function errorCodeOf(body) {
  if (body && typeof body === "object" && typeof body.error === "string") {
    return body.error;
  }
  return "error";
}
function setCsrfToken(token) {
  csrfToken = token;
}
function getCsrfToken() {
  return csrfToken;
}
function csrfHeaders() {
  if (!csrfToken) {
    return {};
  }
  return { "x-srep-csrf": csrfToken };
}
async function apiFetch(path, init = {}) {
  const headers = {
    "content-type": "application/json",
    origin: window.location.origin,
    ...csrfHeaders(),
    ...init.headers ?? {}
  };
  const method = init.method ?? "GET";
  const body = init.body === void 0 ? void 0 : JSON.stringify(init.body);
  let response;
  try {
    response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
  const parsed = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, status: response.status, error: errorCodeOf(parsed) };
  }
  return { ok: true, status: response.status, body: parsed };
}
function describeCeremonyError(error) {
  const name = error instanceof Error ? error.name : "";
  if (name === "InvalidStateError") {
    return "This authenticator is already enrolled.";
  }
  if (name === "NotAllowedError") {
    return "The request was cancelled or timed out.";
  }
  return "The authenticator could not finish the request.";
}
async function runCeremony(start) {
  if (!browserSupportsWebAuthn()) {
    return { ok: false, message: "This browser does not support passkeys." };
  }
  try {
    return { ok: true, value: await start() };
  } catch (error) {
    return { ok: false, message: describeCeremonyError(error) };
  }
}
async function enroll(base, fields) {
  const first = await apiFetch(`${base}/options`, { method: "POST", body: fields });
  if (!first.ok) {
    return { ok: false, message: messageFor(first.error) };
  }
  const reg = await runCeremony(() => startRegistration({ optionsJSON: first.body.options }));
  if (!reg.ok) {
    return { ok: false, message: reg.message };
  }
  const verifyBody = { ...fields, challengeId: first.body.challengeId, response: reg.value };
  if (verifyBody.setupToken !== void 0) {
  }
  const second = await apiFetch(`${base}/verify`, {
    method: "POST",
    body: verifyBody
  });
  return second.ok ? { ok: true, body: second.body } : { ok: false, message: messageFor(second.error) };
}
async function loginWith(kind) {
  const first = await apiFetch("/api/auth/login/options", {
    method: "POST",
    body: { kind }
  });
  if (!first.ok) {
    return { ok: false, message: messageFor(first.error) };
  }
  const auth = await runCeremony(() => startAuthentication({ optionsJSON: first.body.options }));
  if (!auth.ok) {
    return { ok: false, message: auth.message };
  }
  const second = await apiFetch("/api/auth/login/verify", {
    method: "POST",
    body: { challengeId: first.body.challengeId, response: auth.value }
  });
  if (!second.ok) {
    return { ok: false, message: messageFor(second.error) };
  }
  setCsrfToken(second.body.csrfToken);
  return { ok: true, body: null };
}
async function recoveryLogin(code) {
  const result = await apiFetch("/api/auth/recovery/login", {
    method: "POST",
    body: { code }
  });
  if (!result.ok) {
    return { ok: false, message: messageFor(result.error) };
  }
  setCsrfToken(result.body.csrfToken);
  return { ok: true, body: result.body };
}
async function renameCredential(id, nickname) {
  const result = await apiFetch(`/api/auth/credentials/${id}`, {
    method: "PATCH",
    body: { nickname }
  });
  return result.ok ? { ok: true } : { ok: false, message: messageFor(result.error) };
}
window.srepClient = {
  apiFetch,
  setCsrfToken,
  getCsrfToken,
  messageFor,
  enroll,
  loginWith,
  recoveryLogin,
  renameCredential
};
export {
  apiFetch,
  getCsrfToken,
  setCsrfToken
};
