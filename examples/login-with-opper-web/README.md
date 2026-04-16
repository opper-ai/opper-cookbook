# Login with Opper — Web App

A minimal Express app that integrates **Login with Opper** using the OAuth 2.0 Authorization Code flow. Users log in with their Opper account, and the app gets an API key to make AI inference calls billed to the user.

## Features demonstrated

- **`@opperai/login` SDK** — `OpperLogin` class for token exchange, `getPortalUrl()` for account management
- **OAuth 2.0 Authorization Code flow** — redirect-based login
- **Branded buttons** — SDK's CSS classes for login + manage account buttons
- **Inference** — calling `/v2/call` with the user's API key

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
