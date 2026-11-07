var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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

// scripts/ui-client-entry.mjs
var ui_client_entry_exports = {};
__export(ui_client_entry_exports, {
  BLANK_PRESET_DRAFT: () => BLANK_PRESET_DRAFT,
  DEFAULT_DISPLAY: () => DEFAULT_DISPLAY,
  DEFAULT_KEYBINDS: () => DEFAULT_KEYBINDS,
  PALETTE_CLOSE: () => PALETTE_CLOSE,
  PALETTE_OPEN: () => PALETTE_OPEN,
  PALETTE_OPEN_COLON: () => PALETTE_OPEN_COLON,
  acceptDisplay: () => acceptDisplay,
  acceptPreset: () => acceptPreset,
  acceptStudyDay: () => acceptStudyDay,
  captureKeyEffect: () => captureKeyEffect,
  chordFromEvent: () => chordFromEvent,
  closeHint: () => closeHint,
  commandsFor: () => commandsFor,
  copyDraft: () => copyDraft,
  copyKeybindMap: () => copyKeybindMap,
  deckListKey: () => deckListKey,
  displayRootClass: () => displayRootClass,
  draftFromPreset: () => draftFromPreset,
  fieldKeyEffect: () => fieldKeyEffect,
  formatInterval: () => formatInterval,
  formatUntil: () => formatUntil,
  listKeyIndex: () => listKeyIndex,
  nextClozeIndex: () => nextClozeIndex,
  openHint: () => openHint,
  paletteKeyAction: () => paletteKeyAction,
  presetMessageFor: () => presetMessageFor,
  remap: () => remap,
  sanitizeCardHtml: () => sanitizeCardHtml,
  studyKeyAction: () => studyKeyAction,
  wrapCloze: () => wrapCloze
});

// legacy/v1-sveltekit/src/lib/client/card/sanitize-card.ts
var MAX_HTML = 2e5;
var MAX_DEPTH = 32;
var MEDIA_MARK = "{{media:";
var CLOZE_OPEN = '<span class="cloze">';
var CLOZE_CLOSE = "</span>";
function escapeChar(ch) {
  if (ch === "&") {
    return "&amp;";
  }
  if (ch === "<") {
    return "&lt;";
  }
  if (ch === ">") {
    return "&gt;";
  }
  return ch;
}
function escapePrefix(input) {
  let out = "";
  for (let index = 0; index < input.length && out.length < MAX_HTML; index += 1) {
    out += escapeChar(input.charAt(index));
    if (out.length > MAX_HTML) {
      return out.slice(0, MAX_HTML);
    }
  }
  return out;
}
function isLowerHex(text, start) {
  for (let index = start; index < start + 64; index += 1) {
    const code = text.charCodeAt(index);
    const digit = code >= 48 && code <= 57;
    const lower = code >= 97 && code <= 102;
    if (!digit && !lower) {
      return false;
    }
  }
  return true;
}
function mediaHex(text, at) {
  if (!text.startsWith(MEDIA_MARK, at) || at + MEDIA_MARK.length + 66 > text.length) {
    return null;
  }
  const start = at + MEDIA_MARK.length;
  if (!isLowerHex(text, start)) {
    return null;
  }
  if (text.charAt(start + 64) !== "}" || text.charAt(start + 65) !== "}") {
    return null;
  }
  return text.slice(start, start + 64);
}
function closeSpan(open) {
  if (open > 0) {
    return { text: CLOZE_CLOSE, size: CLOZE_CLOSE.length, open: open - 1 };
  }
  return { text: "&lt;/span&gt;", size: CLOZE_CLOSE.length, open };
}
function takeMark(text, at, open) {
  if (text.startsWith(CLOZE_OPEN, at)) {
    if (open >= MAX_DEPTH) {
      return null;
    }
    return { text: CLOZE_OPEN, size: CLOZE_OPEN.length, open: open + 1 };
  }
  if (text.startsWith(CLOZE_CLOSE, at)) {
    return closeSpan(open);
  }
  if (text.startsWith("<br>", at) || text.startsWith("<hr>", at)) {
    return { text: text.slice(at, at + 4), size: 4, open };
  }
  const hex = mediaHex(text, at);
  if (hex === null) {
    return null;
  }
  return {
    text: `<img src="/api/media/${hex}" alt="">`,
    size: MEDIA_MARK.length + 66,
    open
  };
}
function scan(input) {
  let out = "";
  let open = 0;
  let index = 0;
  while (index < input.length) {
    const mark = takeMark(input, index, open);
    const next = mark ?? { text: escapeChar(input.charAt(index)), size: 1, open };
    out += next.text;
    open = next.open;
    index += next.size;
    if (out.length > MAX_HTML) {
      return escapePrefix(input);
    }
  }
  return out;
}
function sanitizeCardHtml(input) {
  if (typeof input !== "string") {
    return "";
  }
  if (input.length > MAX_HTML) {
    return escapePrefix(input);
  }
  return scan(input);
}

// legacy/v1-sveltekit/src/lib/client/tui/keymap.ts
var PALETTE_OPEN = "palette.open";
var PALETTE_OPEN_COLON = "palette.open-colon";
var PALETTE_CLOSE = "palette.close";
var ACTION_IDS = [PALETTE_OPEN, PALETTE_OPEN_COLON, PALETTE_CLOSE];
var DEFAULT_KEYBINDS = {
  [PALETTE_OPEN]: "Ctrl+K",
  [PALETTE_OPEN_COLON]: ":",
  [PALETTE_CLOSE]: "Escape"
};
function copyKeybindMap(value) {
  return {
    [PALETTE_OPEN]: value[PALETTE_OPEN],
    [PALETTE_OPEN_COLON]: value[PALETTE_OPEN_COLON],
    [PALETTE_CLOSE]: value[PALETTE_CLOSE]
  };
}
var MODIFIER_NAMES = ["Ctrl", "Alt", "Shift", "Meta"];
var NAMED_KEYS = ["Escape", "ArrowUp", "ArrowDown", "Enter", "Home", "End", "Tab"];
var MODIFIER_KEYS = /* @__PURE__ */ new Set(["Control", "Alt", "Shift", "Meta"]);
var MAX_CHORD = 32;
var RESERVED_CHORD_KEYS = /* @__PURE__ */ new Set([
  "D",
  "F",
  "H",
  "J",
  "L",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "W",
  "Tab",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9"
]);
var COMMAND_NAMES = [
  "Show Panes",
  "Show List",
  "Show Form",
  "Show Modal",
  "Show Settings"
];
var CANCEL_PASS_KEYS = /* @__PURE__ */ new Set(["Tab", "Enter", " "]);
function failChord() {
  throw new Error("bad_chord");
}
function isNamedKey(part) {
  for (const name of NAMED_KEYS) {
    if (name === part) {
      return true;
    }
  }
  return false;
}
function isChordKey(part) {
  if (part === ":") {
    return true;
  }
  if (/^[A-Z]$/.test(part) || /^[0-9]$/.test(part)) {
    return true;
  }
  return isNamedKey(part);
}
function modifierIndex(part) {
  for (let index = 0; index < MODIFIER_NAMES.length; index += 1) {
    if (MODIFIER_NAMES[index] === part) {
      return index;
    }
  }
  return -1;
}
function modifiersOf(parts) {
  const modifiers = parts.slice(0, -1);
  let previous = -1;
  for (const part of modifiers) {
    const index = modifierIndex(part);
    if (index <= previous) {
      failChord();
    }
    previous = index;
  }
  return modifiers;
}
function parseChord(input) {
  if (input.length < 1 || input.length > MAX_CHORD || /\s/u.test(input)) {
    failChord();
  }
  const parts = input.split("+");
  const key = parts.at(-1) ?? "";
  if (!isChordKey(key) || parts.some((part) => part.length === 0)) {
    failChord();
  }
  return { modifiers: modifiersOf(parts), key };
}
function parseChordOrNull(input) {
  try {
    return parseChord(input);
  } catch (error) {
    if (error instanceof Error && error.message === "bad_chord") {
      return null;
    }
    throw error;
  }
}
function canonicalChord(input) {
  const parsed = parseChordOrNull(input);
  if (parsed === null) {
    return null;
  }
  return [...parsed.modifiers, parsed.key].join("+");
}
function modifierSet(modifiers) {
  return new Set(modifiers);
}
function modifiersMatch(event, modifiers) {
  const want = modifierSet(modifiers);
  if (event.ctrlKey !== want.has("Ctrl") || event.altKey !== want.has("Alt")) {
    return false;
  }
  return event.shiftKey === want.has("Shift") && event.metaKey === want.has("Meta");
}
function asciiUpper(text) {
  if (text.length !== 1) {
    return null;
  }
  const code = text.charCodeAt(0);
  if (code >= 65 && code <= 90) {
    return text;
  }
  if (code >= 97 && code <= 122) {
    return String.fromCharCode(code - 32);
  }
  return null;
}
function asciiLower(text) {
  let folded = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 65 && code <= 90) {
      folded += String.fromCharCode(code + 32);
    } else {
      folded += text.charAt(index);
    }
  }
  return folded;
}
function keyMatches(key, eventKey) {
  if (/^[A-Z]$/.test(key)) {
    return asciiUpper(eventKey) === key;
  }
  return eventKey === key;
}
function eventMatches(chord, event) {
  const parsed = parseChordOrNull(chord);
  if (parsed === null) {
    return false;
  }
  if (!modifiersMatch(event, parsed.modifiers)) {
    return false;
  }
  return keyMatches(parsed.key, event.key);
}
function openHint(chord) {
  return `${chord} palette`;
}
function closeHint(chord) {
  if (chord === "Escape") {
    return "Esc close";
  }
  return `${chord} close`;
}
function commandsFor(filter) {
  const needle = asciiLower(filter.trim());
  return COMMAND_NAMES.filter((name) => asciiLower(name).includes(needle));
}
function isReservedChord(chord) {
  const parsed = parseChordOrNull(chord);
  if (parsed === null) {
    return false;
  }
  if (!RESERVED_CHORD_KEYS.has(parsed.key) || parsed.modifiers.includes("Alt")) {
    return false;
  }
  return parsed.modifiers.includes("Ctrl") || parsed.modifiers.includes("Meta");
}
function isCharacterKeyChord(chord) {
  const parsed = parseChordOrNull(chord);
  if (parsed === null) {
    return false;
  }
  if (parsed.modifiers.includes("Ctrl") || parsed.modifiers.includes("Alt") || parsed.modifiers.includes("Meta")) {
    return false;
  }
  return parsed.key === ":" || /^[A-Z0-9]$/.test(parsed.key);
}
function isActionId(actionId) {
  for (const id of ACTION_IDS) {
    if (id === actionId) {
      return true;
    }
  }
  return false;
}
function chordInUse(map, actionId, chord) {
  for (const id of ACTION_IDS) {
    if (id !== actionId && map[id] === chord) {
      return true;
    }
  }
  return false;
}
function remap(map, actionId, chord) {
  if (!isActionId(actionId)) {
    return "bad_action";
  }
  const canonical = canonicalChord(chord);
  if (canonical === null) {
    return "bad_chord";
  }
  if (isReservedChord(canonical)) {
    return "reserved_chord";
  }
  if (chordInUse(map, actionId, canonical)) {
    return "duplicate_chord";
  }
  return { ...map, [actionId]: canonical };
}
function captureKeyEffect(key) {
  if (key === "Escape") {
    return "cancel";
  }
  if (CANCEL_PASS_KEYS.has(key)) {
    return "pass";
  }
  return "chord";
}
function chordFromEvent(event) {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }
  const parts = [];
  if (event.ctrlKey) {
    parts.push("Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  if (event.metaKey) {
    parts.push("Meta");
  }
  const key = asciiUpper(event.key) ?? event.key;
  parts.push(key);
  return parts.join("+");
}
function fieldBlocksChord(chord, inField) {
  return inField && isCharacterKeyChord(chord);
}
function paletteKeyAction(event, state) {
  if (state.modalOpen) {
    return "none";
  }
  const openChord = state.binds[PALETTE_OPEN];
  const colonChord = state.binds[PALETTE_OPEN_COLON];
  const closeChord = state.binds[PALETTE_CLOSE];
  if (!state.paletteOpen && eventMatches(openChord, event)) {
    if (fieldBlocksChord(openChord, state.targetIsField)) {
      return "none";
    }
    return "open";
  }
  if (!state.paletteOpen && eventMatches(colonChord, event) && !state.targetIsField) {
    return "open";
  }
  if (state.paletteOpen && eventMatches(closeChord, event)) {
    if (fieldBlocksChord(closeChord, state.targetIsField)) {
      return "none";
    }
    return "close";
  }
  return "none";
}

// legacy/v1-sveltekit/src/lib/client/tui/list-state.ts
function clampIndex(length, index) {
  const last = length - 1;
  if (!Number.isFinite(index) || index < 0) {
    return 0;
  }
  if (index > last) {
    return last;
  }
  return index;
}
function listKeyIndex(length, selectedIndex, key) {
  if (!Number.isInteger(length) || length < 1) {
    return null;
  }
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return length - 1;
  }
  if (key === "ArrowDown" || key === "ArrowUp") {
    const step = key === "ArrowDown" ? 1 : -1;
    const base = Number.isInteger(selectedIndex) ? selectedIndex : 0;
    return clampIndex(length, base + step);
  }
  if (key === "Enter") {
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= length) {
      return null;
    }
    return selectedIndex;
  }
  return null;
}

// legacy/v1-sveltekit/src/lib/client/app/format-interval.ts
function formatInterval(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0) {
    return "0m";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  if (minutes < 1440) {
    return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  }
  return minutes % 1440 === 0 ? `${minutes / 1440}d` : `${minutes}m`;
}

// legacy/v1-sveltekit/src/lib/client/app/format-until.ts
var MAX_DATE_MS = 864e13;
var UNTIL_OPTIONS = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
};
function formatUntil(ms, timeZone) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return "";
  }
  if (ms > MAX_DATE_MS || ms < -MAX_DATE_MS) {
    return "";
  }
  try {
    const options = { ...UNTIL_OPTIONS };
    if (timeZone !== void 0) {
      options.timeZone = timeZone;
    }
    return new Intl.DateTimeFormat("en-US", options).format(new Date(ms));
  } catch {
    return "";
  }
}

// legacy/v1-sveltekit/src/lib/client/app/study-keys.ts
var STUDY_RATINGS = [1, 2, 3, 4];
var NONE = { type: "none" };
var RATE_BY_KEY = new Map(
  STUDY_RATINGS.map((rating) => [String(rating), rating])
);
function blocked(input) {
  return input.inFlight || input.targetIsField || input.modalOpen || input.paletteOpen;
}
function rateKey(key) {
  return RATE_BY_KEY.get(key) ?? null;
}
function cardControl(key) {
  if (key === "s") {
    return { type: "suspend" };
  }
  if (key === "e") {
    return { type: "edit" };
  }
  return null;
}
function frontAction(input) {
  const showsBack = input.key === " " || input.key === "Enter";
  if (showsBack && !input.targetIsButton) {
    return { type: "reveal" };
  }
  return cardControl(input.key) ?? NONE;
}
function backAction(input) {
  const rating = rateKey(input.key);
  if (rating !== null) {
    return { type: "rate", rating };
  }
  if (input.key === " " && !input.targetIsButton) {
    return { type: "rate", rating: 3 };
  }
  return cardControl(input.key) ?? NONE;
}
function studyKeyAction(input) {
  if (blocked(input)) {
    return NONE;
  }
  if (input.key === "u") {
    return { type: "undo" };
  }
  if (input.status !== "card") {
    return NONE;
  }
  if (input.side === "front") {
    return frontAction(input);
  }
  return backAction(input);
}

// legacy/v1-sveltekit/src/lib/client/app/note-field-keys.ts
function fieldKeyEffect(input) {
  if (input.ctrlKey || input.metaKey) {
    return { type: "pass" };
  }
  const clozeKey = input.key === "c" || input.key === "C" || input.code === "KeyC";
  if (input.altKey && clozeKey) {
    return { type: "cloze" };
  }
  if (!input.altKey && input.key === "Escape") {
    return { type: "blur" };
  }
  return { type: "pass" };
}

// legacy/v1-sveltekit/src/lib/client/app/note-deck-keys.ts
function clamp(index, length) {
  if (index < 0) {
    return 0;
  }
  if (index > length - 1) {
    return length - 1;
  }
  return index;
}
function deckListKey(key, index, length) {
  if (!Number.isInteger(length) || length < 1) {
    return { type: "none" };
  }
  const current = Number.isInteger(index) ? clamp(index, length) : 0;
  if (key === "ArrowDown" || key === "j") {
    return { type: "select", index: clamp(current + 1, length) };
  }
  if (key === "ArrowUp" || key === "k") {
    return { type: "select", index: clamp(current - 1, length) };
  }
  if (key === "Home") {
    return { type: "select", index: 0 };
  }
  if (key === "End") {
    return { type: "select", index: length - 1 };
  }
  if (key === "Enter") {
    return { type: "keep" };
  }
  if (key === "Escape") {
    return { type: "blur" };
  }
  return { type: "none" };
}

// legacy/v1-sveltekit/src/lib/client/app/cloze-edit.ts
var MAX_CLOZE_INDEX = 999;
var MAX_CLOZE_TEXT = 5e4;
function integerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}
function cutsSurrogate(text, index) {
  if (index <= 0 || index >= text.length) {
    return false;
  }
  const prev = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);
  return prev >= 55296 && prev <= 56319 && next >= 56320 && next <= 57343;
}
function wrapCloze(text, start, end, index) {
  if (text.length > MAX_CLOZE_TEXT) {
    return null;
  }
  if (!integerInRange(index, 1, MAX_CLOZE_INDEX)) {
    return null;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return null;
  }
  if (start < 0 || end < start || end > text.length) {
    return null;
  }
  if (cutsSurrogate(text, start) || cutsSurrogate(text, end)) {
    return null;
  }
  const body = text.slice(start, end);
  const next = `${text.slice(0, start)}{{c${index}::${body}}}${text.slice(end)}`;
  if (next.length > MAX_CLOZE_TEXT) {
    return null;
  }
  return next;
}
function readDigits(text, from) {
  let end = from;
  while (end < text.length && text.charCodeAt(end) >= 48 && text.charCodeAt(end) <= 57) {
    end += 1;
  }
  return end;
}
function clozeAt(text, start) {
  if (!text.startsWith("{{c", start)) {
    return null;
  }
  const digitsEnd = readDigits(text, start + 3);
  if (digitsEnd === start + 3 || !text.startsWith("::", digitsEnd)) {
    return null;
  }
  const index = Number(text.slice(start + 3, digitsEnd));
  if (!integerInRange(index, 1, MAX_CLOZE_INDEX)) {
    return null;
  }
  const close = text.indexOf("}}", digitsEnd + 2);
  if (close === -1) {
    return null;
  }
  return { index, end: close + 2 };
}
function nextClozeIndex(text) {
  if (text.length > MAX_CLOZE_TEXT) {
    return 1;
  }
  let highest = 0;
  let at = 0;
  while (at < text.length) {
    const start = text.indexOf("{{c", at);
    if (start === -1) {
      break;
    }
    const found = clozeAt(text, start);
    if (found === null) {
      at = start + 1;
      continue;
    }
    if (found.index > highest) {
      highest = found.index;
    }
    at = found.end;
  }
  const next = highest + 1;
  return next > MAX_CLOZE_INDEX ? MAX_CLOZE_INDEX : next;
}

// legacy/v1-sveltekit/src/lib/client/app/display-prefs.ts
var DEFAULT_DISPLAY = {
  fontSize: 16,
  reducedMotion: false,
  scanline: false,
  cursorBlink: false
};
var MIN_FONT_SIZE = 12;
var MAX_FONT_SIZE = 24;
function isFontSize(value) {
  return Number.isInteger(value) && value >= MIN_FONT_SIZE && value <= MAX_FONT_SIZE;
}
function parseFontSizeText(raw) {
  if (!/^\d{1,2}$/.test(raw)) {
    return null;
  }
  const fontSize = Number(raw);
  if (!isFontSize(fontSize)) {
    return null;
  }
  return fontSize;
}
function acceptDisplay(input) {
  const fontSize = parseFontSizeText(input.fontSizeText.trim());
  if (fontSize === null) {
    return { ok: false, error: `Font size must be ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE}.` };
  }
  if (typeof input.reducedMotion !== "boolean" || typeof input.scanline !== "boolean" || typeof input.cursorBlink !== "boolean") {
    return { ok: false, error: "Display flags must be true or false." };
  }
  return {
    ok: true,
    display: {
      fontSize,
      reducedMotion: input.reducedMotion,
      scanline: input.scanline,
      cursorBlink: input.cursorBlink
    }
  };
}
function displayRootClass(prefs) {
  const parts = ["tui-display", `tui-font-${prefs.fontSize}`];
  if (prefs.reducedMotion) {
    parts.push("tui-display-reduced-motion");
  }
  return parts.join(" ");
}

// legacy/v1-sveltekit/src/lib/client/app/study-day-form.ts
var TIMEZONE_PATTERN = /^[A-Za-z0-9_/+-]{1,64}$/;
function isClientTimezone(name) {
  if (!TIMEZONE_PATTERN.test(name)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
function parseRolloverHour(raw) {
  if (!/^\d{1,2}$/.test(raw)) {
    return null;
  }
  const hour = Number(raw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }
  return hour;
}
function acceptStudyDay(input) {
  const timezone = input.timezone.trim();
  if (!isClientTimezone(timezone)) {
    return { ok: false, error: "Enter a valid timezone." };
  }
  const rolloverHour = parseRolloverHour(input.rolloverText.trim());
  if (rolloverHour === null) {
    return { ok: false, error: "Rollover hour must be 0 to 23." };
  }
  return { ok: true, settings: { timezone, rolloverHour } };
}

// legacy/v1-sveltekit/src/lib/client/app/preset-form.ts
var BLANK_PRESET_DRAFT = {
  name: "",
  newPerDayText: "20",
  reviewsPerDayText: "200",
  desiredRetentionText: "0.9",
  learningStepsText: "1, 10",
  relearningStepsText: "10",
  maxIntervalText: "36500",
  burySiblings: false,
  newOrder: "added",
  fsrsParams: null
};
var MSGS = /* @__PURE__ */ new Map([
  ["builtin_protected", "The default preset cannot be deleted."],
  ["in_use", "That preset is in use by a deck."],
  ["name_taken", "That preset name is already used."]
]);
function presetMessageFor(code) {
  return MSGS.get(code) ?? "The request failed.";
}
function intText(raw, min, max) {
  if (!/^\d{1,5}$/.test(raw)) {
    return null;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function stepsText(raw) {
  const t = raw.trim();
  if (t === "") {
    return [];
  }
  const parts = t.split(",");
  if (parts.length > 10) {
    return null;
  }
  const out = [];
  for (const p of parts) {
    const s = p.trim();
    if (!/^\d{1,5}$/.test(s)) {
      return null;
    }
    const n = Number(s);
    if (!Number.isInteger(n) || n <= 0 || n > 43200) {
      return null;
    }
    out.push(n);
  }
  return out;
}
function draftFromPreset(p) {
  return {
    name: p.name,
    newPerDayText: String(p.newPerDay),
    reviewsPerDayText: String(p.reviewsPerDay),
    desiredRetentionText: String(p.desiredRetention),
    learningStepsText: p.learningSteps.join(", "),
    relearningStepsText: p.relearningSteps.join(", "),
    maxIntervalText: String(p.maxInterval),
    burySiblings: p.burySiblings,
    newOrder: p.newOrder,
    fsrsParams: p.fsrsParams
  };
}
function copyDraft(d) {
  return { ...d, fsrsParams: d.fsrsParams === null ? null : [...d.fsrsParams] };
}
function acceptPreset(d) {
  const name = d.name.trim();
  if (name.length < 1 || name.length > 100 || name.includes("\0")) {
    return { ok: false, error: "Enter a preset name (1 to 100 characters)." };
  }
  const newPerDay = intText(d.newPerDayText.trim(), 0, 9999);
  if (newPerDay === null) {
    return { ok: false, error: "New per day must be 0 to 9999." };
  }
  const reviewsPerDay = intText(d.reviewsPerDayText.trim(), 0, 9999);
  if (reviewsPerDay === null) {
    return { ok: false, error: "Reviews per day must be 0 to 9999." };
  }
  const retRaw = d.desiredRetentionText.trim();
  const desiredRetention = /^\d+(\.\d+)?$/.test(retRaw) ? Number(retRaw) : NaN;
  if (!Number.isFinite(desiredRetention) || desiredRetention < 0.7 || desiredRetention > 0.99) {
    return { ok: false, error: "Desired retention must be 0.7 to 0.99." };
  }
  const learningSteps = stepsText(d.learningStepsText);
  if (learningSteps === null) {
    return { ok: false, error: "Learning steps must be up to 10 positive minutes." };
  }
  const relearningSteps = stepsText(d.relearningStepsText);
  if (relearningSteps === null) {
    return { ok: false, error: "Relearning steps must be up to 10 positive minutes." };
  }
  const maxInterval = intText(d.maxIntervalText.trim(), 1, 36500);
  if (maxInterval === null) {
    return { ok: false, error: "Max interval must be 1 to 36500." };
  }
  if (d.newOrder !== "added" && d.newOrder !== "random") {
    return { ok: false, error: "New order must be added or random." };
  }
  const fsrs = d.fsrsParams;
  if (fsrs !== null && (!Array.isArray(fsrs) || fsrs.length < 19 || fsrs.length > 21 || !fsrs.every(Number.isFinite))) {
    return { ok: false, error: "FSRS params must be empty or 19 to 21 numbers." };
  }
  return {
    ok: true,
    preset: {
      name,
      newPerDay,
      reviewsPerDay,
      desiredRetention,
      learningSteps,
      relearningSteps,
      maxInterval,
      fsrsParams: fsrs,
      burySiblings: d.burySiblings === true,
      newOrder: d.newOrder
    }
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
  renameCredential,
  ...ui_client_entry_exports
};
export {
  apiFetch,
  getCsrfToken,
  setCsrfToken
};
