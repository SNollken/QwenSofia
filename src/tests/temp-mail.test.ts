import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  createTempMailbox,
  extractVerification,
  waitForTempMailOrgVerificationLink,
} from "../services/temp-mail.ts";

test("temp-mail.org: creates a browser mailbox and reads its verification link", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://temp-mail.org/en/", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `
          <input id="mail" readonly>
          <script>
            fetch("https://web2.temp-mail.org/mailbox", { method: "POST" })
              .then((response) => response.json())
              .then((mailbox) => { document.querySelector("#mail").value = mailbox.mailbox; });
          </script>
        `,
      });
    });
    await page.route("https://web2.temp-mail.org/**", async (route) => {
      const url = new URL(route.request().url());
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      };
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers });
        return;
      }
      if (url.pathname === "/mailbox") {
        await route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            token: "test-browser-token",
            mailbox: "qwen-test@lanvos.com",
          }),
        });
        return;
      }
      if (url.pathname === "/messages/message-1") {
        await route.fulfill({
          contentType: "application/json",
          headers,
          body: JSON.stringify({
            _id: "message-1",
            from: "noreply@qwen.ai",
            subject: "Verify your Qwen account",
            bodyHtml:
              '<a href="https://chat.qwen.ai/auth/verify?token=abc123">Verify</a>',
            bodyText: "Verify your Qwen account",
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        headers,
        body: JSON.stringify({
          messages: [
            {
              _id: "message-1",
              from: "noreply@qwen.ai",
              subject: "Verify your Qwen account",
              receivedAt: new Date().toISOString(),
              bodyPreview: "Verify your Qwen account",
            },
          ],
        }),
      });
    });

    const mailbox = await createTempMailbox(page);
    assert.equal(mailbox.provider, "temp-mail.org");
    assert.equal(mailbox.email, "qwen-test@lanvos.com");
    assert.equal(mailbox.token, "test-browser-token");

    const verification = await waitForTempMailOrgVerificationLink(page, mailbox, {
      timeoutMs: 2_000,
      pollIntervalMs: 10,
    });
    assert.equal(
      verification.link,
      "https://chat.qwen.ai/auth/verify?token=abc123",
    );
  } finally {
    await browser.close();
  }
});

test("temp-mail: extracts 6-digit verification code", () => {
  const result = extractVerification({
    id: "1",
    subject: "Qwen verification code",
    from: "noreply@qwen.ai",
    text: "Your verification code is: 482913\nIt expires in 10 minutes.",
    html: "",
  });
  assert.equal(result.code, "482913");
});

test("temp-mail: extracts verification link", () => {
  const result = extractVerification({
    id: "2",
    subject: "Confirm your email",
    from: "security@qwen.ai",
    text: "Open https://chat.qwen.ai/auth/verify?token=abc123 to continue",
    html: '<a href="https://chat.qwen.ai/auth/verify?token=abc123">Verify</a>',
  });
  assert.ok(result.link);
  assert.match(result.link!, /verify\?token=abc123/);
});

test("temp-mail: prefers labeled code over random numbers", () => {
  const result = extractVerification({
    id: "3",
    subject: "Security",
    from: "qwen",
    text: "Order 20240101\nVerification code: 991122",
    html: "",
  });
  assert.equal(result.code, "991122");
});
