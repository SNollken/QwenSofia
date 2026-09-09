import { test } from "node:test";
import assert from "node:assert";
import { chromium } from "playwright";
import { solveAliyunPuzzleCaptcha } from "../services/aliyun-captcha-solver.ts";
import {
  clickByText,
  openSignupAndFill,
  resubmitRegistrationAfterCaptcha,
} from "../services/account-registration.ts";
import { getDatabase } from "../core/database.ts";
import { invalidateAccountsCache } from "../core/accounts.ts";
import {
  clearAccountCooldown,
  markAccountRateLimited,
} from "../core/account-manager.ts";
import {
  areAllAccountsUnavailable,
  countAvailableAccounts,
  getAutoCreateStatus,
} from "../services/auto-account-creator.ts";
import { config } from "../core/config.ts";

function clearKnownCooldowns(ids: string[]): void {
  for (const id of ids) clearAccountCooldown(id);
}

function withCleanAccounts(fn: () => void | Promise<void>) {
  return async () => {
    const originalEnv = process.env.QWEN_ACCOUNTS;
    delete process.env.QWEN_ACCOUNTS;
    const db = getDatabase();
    const existing = db
      .prepare("SELECT id, email, password FROM accounts")
      .all() as Array<{ id: string; email: string; password: string }>;
    const knownIds = [
      ...existing.map((row) => row.id),
      "auto-1",
      "auto-2",
    ];
    clearKnownCooldowns(knownIds);
    db.prepare("DELETE FROM accounts").run();
    invalidateAccountsCache();
    try {
      await fn();
    } finally {
      clearKnownCooldowns(["auto-1", "auto-2"]);
      db.prepare("DELETE FROM accounts").run();
      const insert = db.prepare(
        "INSERT INTO accounts (id, email, password) VALUES (?, ?, ?)",
      );
      for (const row of existing) {
        insert.run(row.id, row.email, row.password);
      }
      invalidateAccountsCache();
      if (originalEnv !== undefined) process.env.QWEN_ACCOUNTS = originalEnv;
      else delete process.env.QWEN_ACCOUNTS;
    }
  };
}

test(
  "AutoCreator: empty pool is unavailable",
  withCleanAccounts(() => {
    assert.strictEqual(areAllAccountsUnavailable(), true);
    assert.strictEqual(countAvailableAccounts(), 0);
  }),
);

test(
  "AutoCreator: all rate-limited accounts are unavailable",
  withCleanAccounts(() => {
    const db = getDatabase();
    db.prepare(
      "INSERT INTO accounts (id, email, password) VALUES (?, ?, ?)",
    ).run("auto-1", "auto1@test.com", "password1");
    db.prepare(
      "INSERT INTO accounts (id, email, password) VALUES (?, ?, ?)",
    ).run("auto-2", "auto2@test.com", "password2");
    invalidateAccountsCache();

    assert.strictEqual(areAllAccountsUnavailable(), false);
    assert.strictEqual(countAvailableAccounts(), 2);

    markAccountRateLimited("auto-1", 60_000, "RateLimited");
    markAccountRateLimited("auto-2", 60_000, "RateLimited");

    assert.strictEqual(areAllAccountsUnavailable(), true);
    assert.strictEqual(countAvailableAccounts(), 0);

    clearAccountCooldown("auto-1");
    assert.strictEqual(areAllAccountsUnavailable(), false);
    assert.strictEqual(countAvailableAccounts(), 1);
  }),
);

test("AutoCreator: status exposes config flags", () => {
  const status = getAutoCreateStatus();
  assert.strictEqual(typeof status.enabled, "boolean");
  assert.strictEqual(status.enabled, config.accountCreator.enabled);
  assert.strictEqual(typeof status.busy, "boolean");
  assert.strictEqual(typeof status.message, "string");
  assert.ok(status.cooldownRemainingMs >= 0);
});

test("AutoCreator: accepts the Qwen role checkbox used by the signup form", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="qwenchat-auth-pc-register-policy">
        <span role="checkbox" aria-checked="false" tabindex="0">
          <span>Estou de acordo com</span>
        </span>
      </div>
      <button type="submit" disabled>Criar Conta</button>
      <script>
        const checkbox = document.querySelector('[role="checkbox"]');
        const button = document.querySelector('button[type="submit"]');
        checkbox.addEventListener('click', () => {
          checkbox.setAttribute('aria-checked', 'true');
          button.disabled = false;
        });
      </script>
    `);

    const { acceptRegistrationTerms } = await import(
      "../services/account-registration.ts"
    );
    await acceptRegistrationTerms(page);

    assert.equal(
      await page.locator('[role="checkbox"]').getAttribute("aria-checked"),
      "true",
    );
    assert.equal(await page.locator('button[type="submit"]').isDisabled(), false);
  } finally {
    await browser.close();
  }
});

test("AutoCreator: reads cross-origin captcha images through a clean canvas", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    await page.route("http://assets.test/pixel.png", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: pixel,
      }),
    );
    await page.route("http://qwen.test/", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `
          <style>
            #aliyunCaptcha-img-box { position: relative; width: 200px; height: 80px; }
            #aliyunCaptcha-img { width: 200px; height: 80px; }
            #aliyunCaptcha-puzzle { position: absolute; left: 0; top: 0; width: 30px; height: 30px; }
            #aliyunCaptcha-sliding-body { position: relative; width: 200px; height: 30px; }
            #aliyunCaptcha-sliding-slider { width: 30px; height: 30px; }
          </style>
          <div id="aliyunCaptcha-window-float">Access Verification</div>
          <div id="aliyunCaptcha-img-box">
            <img id="aliyunCaptcha-img" src="http://assets.test/pixel.png">
            <img id="aliyunCaptcha-puzzle" src="http://assets.test/pixel.png">
          </div>
          <div id="aliyunCaptcha-sliding-body">
            <div id="aliyunCaptcha-sliding-slider"></div>
          </div>
          <script>
            let dragging = false;
            document.querySelector('#aliyunCaptcha-sliding-slider').addEventListener('mousedown', () => {
              dragging = true;
            });
            document.addEventListener('mouseup', () => {
              if (dragging) document.body.textContent = 'verified';
            });
          </script>
        `,
      }),
    );

    await page.goto("http://qwen.test/");
    const statuses: string[] = [];
    const result = await solveAliyunPuzzleCaptcha(page, {
      maxAttempts: 1,
      onAttempt: ({ status }) => statuses.push(status),
    });

    assert.equal(result.ok, true, JSON.stringify({ result, statuses }));
    assert.ok(statuses.some((status) => status.startsWith("resolvendo captcha")));
    assert.ok(statuses.every((status) => !status.includes("image-bytes")));
  } finally {
    await browser.close();
  }
});

test("AutoCreator: follows the logical puzzle position while its visual position eases", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const backgroundSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="296" height="200">
        <rect width="296" height="200" fill="#303030"/>
        <path d="M150 150H165V142H183V150H198V168H190V188H158V168H150Z" fill="#f5f5f5"/>
      </svg>
    `;
    const puzzleSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="52" height="200">
        <path d="M2 150H17V142H35V150H50V168H42V188H10V168H2Z" fill="#909090"/>
      </svg>
    `;

    await page.setContent(`
      <style>
        #aliyunCaptcha-img-box { position: relative; width: 300px; height: 200px; }
        #aliyunCaptcha-img { position: absolute; width: 300px; height: 200px; }
        #aliyunCaptcha-puzzle {
          position: absolute;
          left: 0;
          width: 52px;
          height: 200px;
          transition: left 1500ms linear;
        }
        #aliyunCaptcha-sliding-body { position: relative; width: 300px; height: 40px; }
        #aliyunCaptcha-sliding-slider { position: absolute; left: 0; width: 40px; height: 40px; }
      </style>
      <div>Access Verification</div>
      <div id="aliyunCaptcha-img-box">
        <img id="aliyunCaptcha-img" src="data:image/svg+xml,${encodeURIComponent(backgroundSvg)}">
        <img id="aliyunCaptcha-puzzle" src="data:image/svg+xml,${encodeURIComponent(puzzleSvg)}">
      </div>
      <div id="aliyunCaptcha-sliding-body">
        <div id="aliyunCaptcha-sliding-slider"></div>
      </div>
      <div id="captcha-status"></div>
      <script>
        const slider = document.querySelector('#aliyunCaptcha-sliding-slider');
        const puzzle = document.querySelector('#aliyunCaptcha-puzzle');
        const status = document.querySelector('#captcha-status');
        let dragging = false;
        let startX = 0;
        slider.addEventListener('mousedown', (event) => {
          dragging = true;
          startX = event.clientX - (parseFloat(slider.style.left) || 0);
        });
        document.addEventListener('mousemove', (event) => {
          if (!dragging) return;
          const handleLeft = Math.max(0, Math.min(260, event.clientX - startX));
          slider.style.left = handleLeft + 'px';
          puzzle.style.left = (handleLeft * 248 / 260) + 'px';
        });
        document.addEventListener('mouseup', () => {
          if (!dragging) return;
          dragging = false;
          const puzzleLeft = parseFloat(puzzle.style.left) || 0;
          if (Math.abs(puzzleLeft - 150) <= 1.2) {
            document.body.textContent = 'verified';
          } else {
            status.textContent = 'Verification failed';
          }
        });
      </script>
    `);

    const statuses: string[] = [];
    const result = await solveAliyunPuzzleCaptcha(page, {
      maxAttempts: 1,
      onAttempt: ({ status }) => statuses.push(status),
    });

    assert.equal(result.ok, true, JSON.stringify({ result, statuses }));
  } finally {
    await browser.close();
  }
});

test("AutoCreator: resubmits the signup form once after captcha returns to it", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <input name="email" value="new-account@example.test">
      <div class="qwenchat-auth-pc-register-policy">
        <span role="checkbox" aria-checked="true"></span>
      </div>
      <button type="submit">Criar Conta</button>
      <script>
        document.querySelector('button').addEventListener('click', () => {
          document.body.textContent = 'Check your email';
        });
      </script>
    `);

    assert.equal(await resubmitRegistrationAfterCaptcha(page), true);
    assert.match(await page.locator("body").innerText(), /check your email/i);
  } finally {
    await browser.close();
  }
});

test("AutoCreator: a timed-out text click does not claim signup navigation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button disabled>Inscrever-se</button>');

    assert.equal(await clickByText(page, ["Inscrever-se"]), false);
  } finally {
    await browser.close();
  }
});

test("AutoCreator: waits for signup-only fields after a slow login transition", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://chat.qwen.ai/auth**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `
          <input name="email">
          <input name="password" type="password">
          <button id="signup" type="button">Inscrever-se</button>
          <script>
            document.querySelector('#signup').addEventListener('click', () => {
              setTimeout(() => {
                document.body.innerHTML = \`
                  <input name="username">
                  <input name="email">
                  <input name="password" type="password">
                  <input name="checkPassword" type="password">
                  <span role="checkbox" class="qwenchat-auth-pc-register-policy-checkbox" aria-checked="false" style="display:inline-block;width:20px;height:20px"></span>
                  <button type="submit" disabled>Criar Conta</button>
                \`;
                const checkbox = document.querySelector('[role="checkbox"]');
                const submit = document.querySelector('button[type="submit"]');
                checkbox.addEventListener('click', () => {
                  checkbox.setAttribute('aria-checked', 'true');
                  submit.disabled = false;
                });
                submit.addEventListener('click', () => {
                  document.body.textContent = 'signup submitted';
                });
              }, 1800);
            });
          </script>
        `,
      }),
    );

    await openSignupAndFill(
      page,
      "new-account@example.test",
      "safe-password-123",
      "New Account",
    );

    assert.match(await page.locator("body").innerText(), /signup submitted/i);
  } finally {
    await browser.close();
  }
});
