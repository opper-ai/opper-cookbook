#!/usr/bin/env node

/**
 * Login with Opper — CLI Example (Public Client)
 *
 * Uses the @opperai/login SDK with the Device Authorization Flow (RFC 8628)
 * to authenticate a user from the terminal. No client secret needed — this
 * is a public client, safe to distribute in CLI binaries.
 *
 * Usage:
 *   CLIENT_ID="your_client_id" node cli.js
 */

import { execFile } from "child_process";
import { OpperLogin } from "@opperai/login";

const CLIENT_ID = process.env.CLIENT_ID || "PASTE_YOUR_CLIENT_ID";
const OPPER_URL = process.env.OPPER_URL || "https://api.opper.ai";

function openBrowser(url) {
    const cmd =
        process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
    execFile(cmd, [url], () => {});
}

async function main() {
    console.log("🔐 Login with Opper\n");

    const opper = new OpperLogin({
        clientId: CLIENT_ID,
        opperUrl: OPPER_URL,
    });

    // Step 1: Start device authorization (no secret needed for public clients)
    const device = await opper.startDeviceAuth();

    // Step 2: Show code and open browser. Prefer verification_uri_complete (RFC 8628)
    // when the server provides it — the user code is prefilled so the user only
    // has to click Approve. Always print the userCode too, in case the browser
    // opens on another device or the prefill fails.
    const openUrl = device.verificationUriComplete ?? device.verificationUri;
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Open:  ${openUrl}`);
    console.log(`  Code:  ${device.userCode}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\nWaiting for authorization...");

    openBrowser(openUrl);

    // Step 3: Poll until user approves (SDK handles the polling loop)
    try {
        const { apiKey, user } = await opper.pollDeviceToken(device);

        console.log("\n\n✅ Authorized!\n");
        console.log(`  User:     ${user.name || user.email}`);
        console.log(`  API Key:  ${apiKey}`);

        // Test inference
        console.log("\n--- Testing inference ---\n");
        const callRes = await fetch(`${OPPER_URL}/v2/call`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                name: "cli-example",
                instructions: "Answer concisely.",
                input: "What is 2+2?",
            }),
        });
        const callData = await callRes.json();
        console.log("Response:", callData.message || JSON.stringify(callData));
    } catch (err) {
        if (err.message === "User denied access") {
            console.log("\n\n❌ Access denied by user.");
        } else {
            console.error("\nError:", err.message);
        }
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
