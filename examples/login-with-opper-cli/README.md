# Login with Opper — CLI App

A command-line app that integrates **Login with Opper** using the Device Authorization Flow (RFC 8628). The CLI displays a code, the user enters it in a browser to approve, and the CLI gets an API key for AI inference.

## Features demonstrated

- **`@opperai/login` SDK** — `startDeviceAuth()` and `pollDeviceToken()` for the full device flow
- **Device Authorization Flow** — code-based login for terminals and headless environments
- **Auto-open browser** — opens the activation URL automatically
- **Inference** — calling `/v2/call` with the user's API key
- **Disconnect & empty-balance handling** — friendly exits for `401` (user revoked) and `402` (Opper balance depleted)

## How it works

1. CLI requests a device code from Opper
2. Displays a short code (e.g., `ABCD-1234`) and opens the browser
3. User enters the code at the activation URL and approves
4. CLI detects approval and receives an API key
5. Makes a test inference call

## Prerequisites

- Node.js 18+
- An OAuth app registered in [Opper platform settings](https://platform.opper.ai) → OAuth Apps

## Run

```bash
npm install
CLIENT_ID="your_client_id" node cli.js
```

No client secret needed — register the OAuth app as a **public client** in Opper settings.

## Environment variables

| Variable | Description |
|----------|-------------|
| `CLIENT_ID` | OAuth app client ID from Opper (public client) |
| `OPPER_URL` | Opper API URL (default: `https://api.opper.ai`) |

## Handling disconnect & empty balance

Every call to `/v2/call` (and any other Opper endpoint authed with the user's API key) can fail in two ways the partner app should handle explicitly. Both surface as HTTP status codes.

| Status | Meaning | What the user needs to do | What the CLI should do |
|--------|---------|---------------------------|------------------------|
| `401 Unauthorized` | API key is invalid. The user disconnected this app from their Opper Wallet (Opper deletes the key on revoke), or the key was rotated/expired. | Re-run the login flow to get a new key. | Print a clear "re-run to authorize" message and exit non-zero. |
| `402 Payment Required` | Opper balance is depleted (the org's wallet hit zero). The API key is still valid. | Top up via the Opper Wallet portal. | Print a "top up" message with the portal URL (`OpperLogin.getPortalUrl()`) and exit non-zero. **No reconnect needed** — once funded, the same key resumes working. |

Any other non-2xx response is a regular API error (rate limit, validation, model failure) and should be handled like any HTTP call.

### Example

The cookbook checks the status before parsing the body:

```js
const callRes = await fetch(`${OPPER_URL}/v2/call`, { /* … */ });

if (callRes.status === 401) {
    console.error("Disconnected — re-run this command to authorize again.");
    process.exit(1);
}
if (callRes.status === 402) {
    console.error(`Balance empty — top up at ${opper.getPortalUrl()}.`);
    process.exit(1);
}

const callData = await callRes.json();
// …handle callData.message
```
