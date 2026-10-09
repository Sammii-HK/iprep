/**
 * Browser check of /practice with the API mocked (no database, no login).
 *   1. npm run build && npx next start -p 3111      (any DATABASE_URL and JWT_SECRET will do)
 *   2. npm i --no-save playwright-core && node e2e/practice-page.cjs
 * Uses the Chromium that ships with the environment (PLAYWRIGHT_BROWSERS_PATH). Override with CHROME_PATH.
 */
const { chromium } = require("playwright-core");
const BASE = "http://localhost:3111";
const days = (d) => new Date(Date.now() + d * 86400000).toISOString();
const banks = [
  ["b1", "React deep dive"], ["b2", "Design systems"], ["b3", "TypeScript"],
  ["b4", "Fundraising and investors"], ["b5", "Pitching your startup"],
].map(([id, title]) => ({ id, title, _count: { questions: 10 } }));

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " :: " + detail : "")); };

async function mock(page, opts = {}) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/auth/me") return json({ user: { id: "u1", email: "a@b.c", name: "T", role: "USER" } });
    if (url.pathname === "/api/banks") return json(banks);
    if (url.pathname === "/api/sessions") return json([{ id: "s1", title: "React deep dive", createdAt: days(-1), bankId: "b1", isCompleted: false, completedAt: null, itemCount: 2 }]);
    if (url.pathname === "/api/interviews/next") return json(opts.noInterview ? { interview: null, folder: null } : { interview: { company: "Prismic", role: "Senior Product Engineer", startsAt: days(2), status: "scheduled" }, folder: { title: "Prismic Interview Prep", banks: [{ id: "b1", title: "React deep dive" }] } });
    return json({});
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await mock(page);
  await page.goto(BASE + "/practice");
  await page.getByText("Create New Session").first().waitFor({ state: "attached" }).catch(() => {});
  await page.waitForSelector("text=Continue where you left off", { timeout: 15000 });
  check("resume card offers the unfinished session", true);

  // Open the form and pick a bank in the Interview context
  await page.getByRole("button", { name: /new session|create session|start new|practice/i }).first().click().catch(() => {});
  const select = page.locator("select").first();
  await select.waitFor({ timeout: 10000 });
  const interviewOptions = await select.locator("option").allTextContents();
  check("Interview context hides fundraising banks", !interviewOptions.some((t) => /fundraising|pitching/i.test(t)), interviewOptions.join(" | "));
  await select.selectOption("b2");

  // Reload: the same bank must be restored (not reset to empty / all)
  await page.reload();
  await page.waitForSelector("text=Continue where you left off", { timeout: 15000 });
  await page.getByRole("button", { name: /new session|create session|start new|practice/i }).first().click().catch(() => {});
  const restored = await page.locator("select").first().inputValue();
  check("same bank is selected after a reload", restored === "b2", "value=" + restored);

  // Switch to Founder: fundraising banks appear, interview selection preserved when switching back
  await page.getByRole("tab", { name: "Founder" }).click();
  const founderOptions = await page.locator("select").first().locator("option").allTextContents();
  check("Founder context shows the pitching bank", founderOptions.some((t) => /pitching/i.test(t)), founderOptions.join(" | "));
  await page.getByRole("tab", { name: "Fundraising" }).click();
  const fundOptions = await page.locator("select").first().locator("option").allTextContents();
  check("Fundraising context shows the fundraising bank", fundOptions.some((t) => /fundraising/i.test(t)), fundOptions.join(" | "));
  await page.getByRole("tab", { name: "Interview" }).click();
  await page.waitForFunction(() => document.querySelector("select")?.value === "b2", null, { timeout: 3000 }).catch(() => {});
  const back = await page.locator("select").first().inputValue();
  check("switching back restores the Interview selection", back === "b2", "value=" + back);

  // Recommended strip: shows, does not change the selection until Use
  const strip = page.getByText(/Recommended for your Senior Product Engineer interview at Prismic/);
  check("recommended strip is shown for the next interview", await strip.isVisible());
  check("selection unchanged by recommendations", (await page.locator("select").first().inputValue()) === "b2");
  await page.getByRole("button", { name: "Use" }).first().click();
  check("'Use' selects the recommended bank", (await page.locator("select").first().inputValue()) === "b1");

  // Target roles + presets persist across reload
  await page.getByPlaceholder("e.g. Senior Product Engineer").fill("Senior Design Engineer");
  await page.getByRole("button", { name: "Add role" }).click();
  await page.getByPlaceholder("Save the current banks as…").fill("Design prep");
  await page.getByRole("button", { name: "Save preset" }).click();
  await page.reload();
  await page.waitForSelector("text=Continue where you left off", { timeout: 15000 });
  check("target role persists", await page.getByText("Senior Design Engineer").first().isVisible());
  check("preset persists", await page.getByRole("button", { name: "Design prep" }).isVisible());

  check("no uncaught page errors", errors.length === 0, errors.join(" / "));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(2); });
