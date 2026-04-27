# Login with Opper — Web App

A minimal Express app that integrates **Login with Opper** using the OAuth 2.0 Authorization Code flow. Users sign in with Opper, the app gets an API key, and AI calls are paid from the user's Opper Wallet.

## Features demonstrated

- **`@opperai/login` SDK** — `OpperLogin` class for token exchange, `getPortalUrl()` linking to the user's Opper Wallet
- **OAuth 2.0 Authorization Code flow** — redirect-based login
- **Branded buttons** — SDK's CSS classes for login + wallet buttons
- **Inference** — calling `/v2/call` with the user's API key
- **Disconnect & empty-balance handling** — graceful UX for `401` (user revoked) and `402` (Opper balance depleted)

## How it works

1. User clicks "Login with Opper" button
2. Redirected to Opper for authentication + consent
3. Opper redirects back with an authorization code
4. Server exchanges code for an API key (server-side, using client secret)
5. App uses the API key to call Opper for AI inference

## Prerequisites

- Node.js 18+
- An OAuth app registered in [Opper platform settings](https://platform.opper.ai) → OAuth Apps
- Add `http://localhost:4000/callback` as a redirect URI

## Setup

```bash
npm install
```

## Run

```bash
CLIENT_ID="your_client_id" CLIENT_SECRET="your_client_secret" npm start
```

Then open http://localhost:4000

## Environment variables

| Variable | Description |
|----------|-------------|
| `CLIENT_ID` | OAuth app client ID from Opper |
| `CLIENT_SECRET` | OAuth app client secret (shown once on creation) |
| `OPPER_URL` | Opper API URL (default: `https://api.opper.ai`) |

## Handling disconnect & empty balance

Every call to `/v2/call` (and any other Opper endpoint authed with the user's API key) can fail in two ways the partner app should handle explicitly. Both surface as HTTP status codes.

| Status | Meaning | What the user needs to do | What the app should do |
|--------|---------|---------------------------|------------------------|
| `401 Unauthorized` | API key is invalid. The user disconnected this app from their Opper Wallet (Opper deletes the key on revoke), or the key was rotated/expired. | Reconnect via the OAuth flow. | Treat the cached key as gone. Surface a "reconnect" CTA pointing at `/oauth/authorize`. Clear any local state tied to the key. |
| `402 Payment Required` | Opper balance is depleted (the org's wallet hit zero). The API key is still valid. | Top up via the Opper Wallet portal. | Surface a "top up" CTA linking to `OpperLogin.getPortalUrl()`. **No reconnect needed** — once funded, the same key resumes working. |

Any other non-2xx response is a regular API error (rate limit, validation, model failure) and should be handled like any HTTP call.

### Example

The cookbook checks the status before parsing the body and renders the right next-step CTA:

```js
const res = await fetch(opperUrl + "/v2/call", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "web-example", instructions: "Answer concisely.", input: prompt }),
});

if (res.status === 401) {
    // Disconnected — show a reconnect button pointing at /oauth/authorize.
    showReconnectPrompt();
    return;
}
if (res.status === 402) {
    // Balance empty — link to the user's Wallet portal so they can top up.
    showTopUpPrompt(opper.getPortalUrl());
    return;
}

const data = await res.json();
// …handle data.message
```
