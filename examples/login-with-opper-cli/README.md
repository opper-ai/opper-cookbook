# Login with Opper — CLI App

A command-line app that integrates **Login with Opper** using the Device Authorization Flow (RFC 8628). The CLI displays a code, the user enters it in a browser to approve, and the CLI gets an API key for AI inference.

## Features demonstrated

- **`@opperai/login` SDK** — `startDeviceAuth()` and `pollDeviceToken()` for the full device flow
- **Device Authorization Flow** — code-based login for terminals and headless environments
- **Auto-open browser** — opens the activation URL automatically
- **Inference** — calling `/v2/call` with the user's API key

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
CLIENT_ID="your_client_id" CLIENT_SECRET="your_client_secret" node cli.js
```

No `npm install` needed — zero dependencies.

## Environment variables

| Variable | Description |
|----------|-------------|
| `CLIENT_ID` | OAuth app client ID from Opper |
| `CLIENT_SECRET` | OAuth app client secret (shown once on creation) |
| `OPPER_URL` | Opper API URL (default: `https://api.opper.ai`) |
