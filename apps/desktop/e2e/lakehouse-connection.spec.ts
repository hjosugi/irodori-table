import { expect, type Page, test } from "@playwright/test";

// Tauri IPC is absent in the browser harness, so `invoke` rejects and the app
// falls back to its mock snapshot. That is fine here: this spec covers building
// a lakehouse connection in the form, not opening one.
const ignorable = (message: string) => /tauri|invoke|__TAURI/i.test(message);

async function openConnectionManager(page: Page) {
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("menubar", { name: "Application menu" })
    .getByRole("menuitem", { name: "File" })
    .click();
  await page.getByRole("menuitem", { name: "Open Connection Manager" }).click();
  await expect(page.locator(".connection-dialog")).toBeVisible();
}

function optionField(page: Page, label: string) {
  return page.locator(
    `.connector-options label:has(> span:text-is("${label}")) input`,
  );
}

test("an Iceberg connection can be given catalog settings and credentials", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => {
    if (!ignorable(error.message)) {
      failures.push(error.message);
    }
  });

  await openConnectionManager(page);
  await page.locator(".connection-picker-header .icon-button").first().click();

  const engine = page.locator(".connection-form select").first();
  await engine.selectOption("iceberg");

  // The connector's own settings, declared in engine-connection-config.json and
  // forwarded verbatim as ConnectionProfile.options.
  const catalogUri = optionField(page, "Catalog URI");
  const warehouse = optionField(page, "Warehouse path");
  await expect(catalogUri).toBeVisible();
  await expect(warehouse).toBeVisible();

  await catalogUri.fill("https://catalog.example.com/v1");
  await warehouse.fill("s3://bucket/warehouse");

  // OAuth2 client-credentials settings for REST catalogs (#184). The client
  // secret is deliberately NOT among them — it rides the session-only
  // password field below.
  const oauth2ServerUri = optionField(page, "OAuth2 token endpoint");
  const oauth2ClientId = optionField(page, "OAuth2 client ID");
  const scope = optionField(page, "OAuth2 scope");
  await expect(oauth2ServerUri).toBeVisible();
  await expect(oauth2ClientId).toBeVisible();
  await expect(scope).toHaveAttribute("placeholder", "catalog");

  await oauth2ServerUri.fill("https://catalog.example.com/v1/oauth/tokens");
  await oauth2ClientId.fill("workbench-client");
  await scope.fill("catalog");

  // Credentials ride the ordinary profile columns, which the lakehouse preset
  // used to hide outright. For iceberg the labels advertise the OAuth2
  // client-credentials fallback (#184).
  const user = page.locator(
    '.connection-form-body label:has(> span:text-is("Access key ID / OAuth2 client ID")) input',
  );
  const password = page.locator(
    '.connection-form-body label:has(> span:text-is("Secret access key / OAuth2 client secret")) input',
  );
  await expect(user).toBeVisible();
  await expect(password).toHaveAttribute("type", "password");

  await user.fill("AKIAIOSFODNN7EXAMPLE");
  await password.fill("s3cr3t");
  await page
    .locator(
      '.connection-form-body label:has(> span:text-is("Connection name")) input',
    )
    .fill("Sales lakehouse");

  await expect(catalogUri).toHaveValue("https://catalog.example.com/v1");
  await expect(warehouse).toHaveValue("s3://bucket/warehouse");
  await expect(oauth2ServerUri).toHaveValue(
    "https://catalog.example.com/v1/oauth/tokens",
  );
  await expect(oauth2ClientId).toHaveValue("workbench-client");
  await expect(user).toHaveValue("AKIAIOSFODNN7EXAMPLE");

  await page.locator(".connection-dialog").screenshot({
    path: "test-results/lakehouse-connection-form.png",
  });

  expect(failures).toEqual([]);
});

test("engines without connector settings do not grow an empty section", async ({
  page,
}) => {
  await openConnectionManager(page);
  await page.locator(".connection-picker-header .icon-button").first().click();

  const engine = page.locator(".connection-form select").first();
  await engine.selectOption("postgres");
  await expect(page.locator(".connector-options")).toHaveCount(0);

  await engine.selectOption("iceberg");
  await expect(page.locator(".connector-options")).toHaveCount(1);
});
