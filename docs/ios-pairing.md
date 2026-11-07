# Pair an iOS app with a hosted instance

srep issues long-lived Bearer API tokens through a short-lived pairing code. The web UI shows the code and a QR payload; the native app claims the code once and stores the token.

## Pair from the web UI

1. Sign in to the hosted instance in a browser.
2. Open **Settings → Pair app** (or `/settings?section=pair-app`, alias `/pair`).
3. Optionally name the device, then press **Generate pairing code**.
4. In the iOS app, scan the QR code or enter the instance origin plus the `XXXX-XXXX` code within five minutes.

Generating a new code invalidates any previous unused code. Revoke a device from the same settings pane to cut off its token.

## App claim flow

1. Read the QR JSON (or typed code + origin):

```json
{ "v": 1, "origin": "https://srep.example.com", "code": "ABCD-EFGH" }
```

2. `POST {origin}/api/auth/pairing/exchange` with JSON `{ "code": "ABCD-EFGH", "name": "iPhone" }`.
   - No cookie, Origin, or CSRF header is required for this route.
   - On success: `{ "token": "srep_…", "tokenId": "<uuid>", "name": "…" }`.
   - Store the token in the Keychain. It is shown only once.

3. Call other `/api/*` routes with:

```http
Authorization: Bearer srep_…
Content-Type: application/json
```

Bearer requests skip browser Origin/CSRF checks. Do not send the session cookie from a native client.

## Limits

- Pairing codes expire after five minutes and are single-use.
- At most 20 active (non-revoked) tokens per instance.
- Failed exchange attempts are rate-limited.

## Spec

See [openapi.yaml](./openapi.yaml) for the pairing endpoints and the study/deck surface an iOS client typically needs.
