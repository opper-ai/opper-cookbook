import express from "express";
import { OpperLogin } from "@opperai/login";

const app = express();
const PORT = 4000;

const CLIENT_ID = process.env.CLIENT_ID || "PASTE_YOUR_CLIENT_ID";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "PASTE_YOUR_CLIENT_SECRET";
const OPPER_URL = process.env.OPPER_URL || "https://api.opper.ai";
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const opper = new OpperLogin({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    opperUrl: OPPER_URL,
});

// ---- Home page ----
app.get("/", (req, res) => {
    // Build the authorize URL using the SDK
    const state = crypto.randomUUID();
    const authorizeUrl = `${OPPER_URL}/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&state=${state}`;

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login with Opper — Web Example</title>
      <link rel="stylesheet" href="/opper-login.css">
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
        h1 { font-size: 24px; }
      </style>
    </head>
    <body>
      <h1>My AI App</h1>
      <p>This app uses <strong>Login with Opper</strong> — AI calls are paid from your Opper Wallet.</p>
      <br>
      <a href="${authorizeUrl}" class="opper-login-button">
        Login with Opper
      </a>
    </body>
    </html>
  `);
});

// Serve the SDK's CSS
app.get("/opper-login.css", (req, res) => {
    res.sendFile("styles.css", { root: "./node_modules/@opperai/login/dist" });
});

// ---- OAuth callback ----
app.get("/callback", async (req, res) => {
    const { code, error } = req.query;

    if (error) {
        return res.send(`<h1>Authorization Denied</h1><p>${escapeHtml(String(error))}</p><a href="/">Try again</a>`);
    }
    if (!code) {
        return res.status(400).send("Missing authorization code");
    }

    // Exchange code for API key using the SDK
    try {
        const { apiKey, user } = await opper.exchangeCode(code);
        const userName = escapeHtml(user?.name || user?.email || "unknown");
        const portalUrl = opper.getPortalUrl();

        res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connected — My AI App</title>
        <link rel="stylesheet" href="/opper-login.css">
        <style>
          body { font-family: system-ui; max-width: 600px; margin: 80px auto; padding: 0 20px; color: #333; }
          h1 { font-size: 24px; }
          code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
          pre { background: #f0f0f0; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; white-space: pre-wrap; }
          .success { background: #e8f5e9; padding: 16px; border-radius: 8px; margin: 20px 0; }
          textarea { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-family: system-ui; box-sizing: border-box; }
          .send-btn { display: inline-block; padding: 10px 20px; background: #000; color: #fff; border-radius: 8px; border: none; cursor: pointer; font-size: 14px; margin-top: 12px; }
        </style>
      </head>
      <body>
        <h1>Connected!</h1>
        <div class="success">
          <strong>User:</strong> ${userName}<br>
          <strong>API Key:</strong> <code>${escapeHtml(apiKey)}</code>
        </div>

        <h2>Try inference</h2>
        <form id="chat-form">
          <textarea id="prompt" rows="2" placeholder="Ask something...">What is the capital of Sweden?</textarea>
          <button type="submit" class="send-btn">Send to Opper</button>
        </form>
        <pre id="chat-result"></pre>
        <div id="connection-status"></div>

        <script>
          const apiKey = ${JSON.stringify(apiKey)};
          const opperUrl = ${JSON.stringify(OPPER_URL)};
          const portalUrl = ${JSON.stringify(portalUrl)};

          // Two states a partner app should always handle on calls to /v2/call:
          //   401 — API key invalid. The user disconnected this app from their
          //         Opper Wallet (or Opper revoked the key for another reason).
          //         They must reconnect via /oauth/authorize before AI calls
          //         resume.
          //   402 — Payment required. Opper balance is depleted. The user tops
          //         up at their Wallet portal and the existing key keeps working.
          // Render a clear next-step CTA for each instead of an opaque error.
          function renderConnectionState(status) {
            const el = document.getElementById("connection-status");
            el.replaceChildren();
            if (status !== 401 && status !== 402) return;

            const card = document.createElement("div");
            card.style.cssText =
              "margin-top:16px;padding:12px 16px;border-radius:8px;font-size:14px;background:" +
              (status === 401 ? "#fde7e9" : "#fff8e1") + ";";

            const heading = document.createElement("strong");
            heading.textContent = status === 401 ? "Disconnected." : "Opper balance is empty.";
            card.appendChild(heading);

            const link = document.createElement("a");
            link.style.color = "#000";
            link.style.textDecoration = "underline";
            if (status === 401) {
              card.appendChild(document.createTextNode(
                " This app is no longer connected to the user's Opper account. "
              ));
              link.href = "/";
              link.textContent = "Reconnect";
              card.appendChild(link);
              card.appendChild(document.createTextNode(" to keep using AI."));
            } else {
              card.appendChild(document.createTextNode(" "));
              link.href = portalUrl;
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              link.textContent = "Top up your Opper Wallet";
              card.appendChild(link);
              card.appendChild(document.createTextNode(
                " to keep using AI in this app."
              ));
            }
            el.appendChild(card);
          }

          document.getElementById("chat-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const prompt = document.getElementById("prompt").value;
            const resultEl = document.getElementById("chat-result");
            resultEl.textContent = "Calling Opper...";
            renderConnectionState(null);
            try {
              const res = await fetch(opperUrl + "/v2/call", {
                method: "POST",
                headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({ name: "web-example", instructions: "Answer concisely.", input: prompt }),
              });
              if (res.status === 401 || res.status === 402) {
                renderConnectionState(res.status);
                resultEl.textContent = "";
                return;
              }
              const data = await res.json();
              resultEl.textContent = data.message || JSON.stringify(data, null, 2);
            } catch (err) {
              resultEl.textContent = "Error: " + err.message;
            }
          });
        </script>

        <div style="margin-top: 40px; display: flex; gap: 12px; align-items: center;">
          <a href="${portalUrl}" target="_blank" rel="noopener noreferrer" class="opper-login-button">
            Open Opper Wallet
          </a>
          <a href="/" style="color: #666; font-size: 14px;">Back to home</a>
        </div>
      </body>
      </html>
    `);
    } catch (err) {
        res.status(500).send(`<h1>Error</h1><pre>${escapeHtml(err.message)}</pre>`);
    }
});

function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

app.listen(PORT, () => {
    console.log(`\nLogin with Opper — Web Example`);
    console.log(`Running at http://localhost:${PORT}`);
    console.log(`Redirect URI: ${REDIRECT_URI}\n`);
});
