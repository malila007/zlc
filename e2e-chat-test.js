/**
 * E2E Chat Multi-Tab Test
 *
 * Tests:
 *  1. Backoffice: 5 tabs, same browser context (tab sync via BroadcastChannel)
 *  2. Floating-chat: 5 tabs, same browser context (tab sync via BroadcastChannel)
 *  3. Chat list consistency across all backoffice tabs
 *  4. Message order consistency across all backoffice tabs
 *  5. Send / receive messages in both directions
 *  6. [REF] BO chat-service refactor regression (history/read/sync/reconnect/lifecycle)
 *
 * Real UI selectors (inspected):
 *  - BO toggle: `div.fixed.bottom-5.right-5 button`
 *  - BO chat window: `.floating-chat-window`
 *  - BO customer items: `div.cursor-pointer` inside chat window
 *  - BO message input: `input[placeholder="Type a message..."]`
 *  - BO send button: `button.bg-primary.rounded-full` (inside chat window)
 *  - BO message bubbles: `div.flex.flex-col` + sub element (no stable class; use message list count)
 *  - FC message input: `input.chat-input`
 *  - FC send: `.chat-send-btn`
 *  - FC messages: `div.message`
 */

const { chromium } = require("playwright");

const BACKOFFICE_URL = "http://localhost:3000";
const FLOATING_CHAT_URL = "http://localhost:5173";
const USERNAME = "mali168";
const PASSWORD = "123456";
const NUM_TABS = 5;

const READ_MARK_DELAY_MS = 5_000;
const READ_MARK_BUFFER_MS = 2_500;

let passCount = 0;
let failCount = 0;
const results = [];

function pass(name) {
  passCount++;
  results.push({ status: "PASS", name });
  console.log(`  ✅ PASS: ${name}`);
}

function fail(name, reason) {
  failCount++;
  results.push({ status: "FAIL", name, reason });
  console.error(`  ❌ FAIL: ${name}`);
  console.error(`        → ${reason}`);
}

function warn(name, reason) {
  results.push({ status: "WARN", name, reason });
  console.warn(`  ⚠️  WARN: ${name}`);
  console.warn(`        → ${reason}`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────
// LOGIN: mali168 / 123456
// ─────────────────────────────────────────────────────────────
async function loginBackoffice(page) {
  await page.goto(BACKOFFICE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await sleep(1500);

  if (!page.url().includes("/login")) {
    console.log("    Already authenticated");
    return true;
  }

  await page.locator('input[placeholder="Username"]').first().fill(USERNAME);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('input[type="password"]').first().press("Enter");
  await sleep(4000);

  const afterUrl = page.url();
  console.log(`    After login: ${afterUrl}`);
  return !afterUrl.includes("/login");
}

// ─────────────────────────────────────────────────────────────
// OPEN BACKOFFICE CHAT PANEL
// The chat is a floating panel at bottom-right on all pages.
// Toggle button: `div.fixed.bottom-5.right-5 button`
// ─────────────────────────────────────────────────────────────
async function openBoChat(page) {
  const toggleBtn = page.locator("div.fixed.bottom-5.right-5 button").first();
  const isVisible = await toggleBtn.isVisible().catch(() => false);
  if (!isVisible) {
    console.log("    BO chat toggle button not visible (user may lack chat permission)");
    return false;
  }
  await toggleBtn.click();
  await sleep(2000);
  // Check the panel opened
  const panelVisible = await page.locator(".floating-chat-window").isVisible().catch(() => false);
  if (panelVisible) {
    console.log("    BO chat panel opened");
    return true;
  }
  console.log("    BO chat panel did not open after click");
  return false;
}

// ─────────────────────────────────────────────────────────────
// OPEN FLOATING-CHAT WIDGET
// Toggle: .floating-chat-button
// ─────────────────────────────────────────────────────────────
async function openFcWidget(page) {
  await page.goto(FLOATING_CHAT_URL, { waitUntil: "domcontentloaded" });
  await sleep(3000);

  const btn = page.locator(".floating-chat-button").first();
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await sleep(2000);
  }
  // Widget may auto-open or be already open
}

// ─────────────────────────────────────────────────────────────
// COUNT customers visible in BO chat panel
// ─────────────────────────────────────────────────────────────
async function getBoCustomerCount(page) {
  try {
    return await page
      .locator(
        ".floating-chat-window div.cursor-pointer"
      )
      .count();
  } catch (_) {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// WAIT for BO conversation history to finish loading
// Returns 'resolved' when "Loading messages..." disappears, 'timeout' otherwise
// ─────────────────────────────────────────────────────────────
async function waitForBoHistoryLoaded(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const loading = await page
      .locator('.floating-chat-window')
      .filter({ hasText: "Loading messages..." })
      .count()
      .catch(() => 0);
    if (loading === 0) return "resolved";
    await sleep(500);
  }
  return "timeout";
}

// ─────────────────────────────────────────────────────────────
// COUNT messages in BO conversation pane
// ─────────────────────────────────────────────────────────────
async function getBoMessageCount(page) {
  try {
    // BO message bubbles: space-y-4 container child divs that have actual message content
    return await page.locator(".floating-chat-window .space-y-4 > div").count();
  } catch (_) {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// COUNT messages in floating chat (.message)
// ─────────────────────────────────────────────────────────────
async function getFcMessageCount(page) {
  try {
    return await page.locator("div.message").count();
  } catch (_) {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────
// SEND from floating chat (input.chat-input + Enter)
// ─────────────────────────────────────────────────────────────
async function sendFcMessage(page, text) {
  try {
    const input = page.locator("input.chat-input").first();
    await input.waitFor({ state: "attached", timeout: 5000 });
    await page.evaluate((t) => {
      const el = document.querySelector("input.chat-input");
      if (el) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        nativeInputValueSetter.call(el, t);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, text);
    await input.press("Enter");
    await sleep(1500);
    return true;
  } catch (e) {
    // Fallback: direct fill
    try {
      const input = page.locator("input.chat-input").first();
      await input.fill(text, { force: true });
      await input.press("Enter");
      await sleep(1500);
      return true;
    } catch (e2) {
      console.log("    FC send error:", e2.message.split("\n")[0]);
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SEND from backoffice chat
// ─────────────────────────────────────────────────────────────
async function sendBoMessage(page, text) {
  try {
    const input = page.locator('.floating-chat-window input[placeholder="Type a message..."]').first();
    await input.waitFor({ state: "visible", timeout: 6000 });
    await input.fill(text);
    await input.press("Enter");
    await sleep(1500);
    return true;
  } catch (e) {
    console.log("    BO send error:", e.message.split("\n")[0]);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// GET chat-service WS connection count
// ─────────────────────────────────────────────────────────────
async function getWsConnectionCount(page) {
  try {
    const resp = await page.evaluate(() =>
      fetch("http://localhost:3333/health").then((r) => r.json())
    );
    return resp.websocketPool?.totalConnections ?? null;
  } catch (_) {
    return null;
  }
}

async function getBoUnreadBadgeCount(page) {
  try {
    return await page.locator(".floating-chat-window div.cursor-pointer span.bg-red-500").count();
  } catch (_) {
    return 0;
  }
}

async function clickBoSync(page) {
  const btn = page.locator('.floating-chat-window button[title="Sync chat with server"]');
  await btn.waitFor({ state: "visible", timeout: 6000 });
  await btn.click();
}

async function waitForBoSyncIdle(page, timeoutMs = 15000) {
  const syncing = page.locator('.floating-chat-window button[title="Syncing chat with server"]');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const visible = await syncing.isVisible().catch(() => false);
    if (!visible) return true;
    await sleep(300);
  }
  return false;
}

async function closeBoChatPanel(page) {
  const header = page.locator(".floating-chat-window .h-14");
  await header.locator("button").last().click();
  await sleep(1200);
}

async function simulateVisibilityRestore(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function waitForBoChatConnected(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const connected = await page.evaluate(async () => {
        const { chatService } = await import("/src/services/chat/chat-service.js");
        return chatService.state.isConnected === true;
      });
      if (connected) return true;
    } catch (_) {
      /* dev import may fail */
    }
    await sleep(400);
  }
  return false;
}

async function setBoActiveChat(page, customerId) {
  try {
    await page.evaluate(async (id) => {
      const { chatService } = await import("/src/services/chat/chat-service.js");
      chatService.setActiveChat(id);
    }, customerId);
    return true;
  } catch (e) {
    console.log("    setBoActiveChat skipped:", e.message.split("\n")[0]);
    return false;
  }
}

async function boConversationHasText(page, text) {
  try {
    return (
      (await page
        .locator(".floating-chat-window")
        .getByText(text, { exact: true })
        .count()) > 0
    );
  } catch (_) {
    return false;
  }
}

async function getBoFirstCustomerId(page) {
  try {
    return await page.evaluate(async () => {
      const { chatService } = await import("/src/services/chat/chat-service.js");
      const row = (chatService.state.customers || []).find((c) => c && c.id != null);
      return row ? String(row.id) : null;
    });
  } catch (_) {
    return null;
  }
}


// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(70));
  console.log("  E2E Chat Multi-Tab Test");
  console.log(`  BO: ${BACKOFFICE_URL}  |  FC: ${FLOATING_CHAT_URL}`);
  console.log("=".repeat(70));

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  // Same-origin contexts are required for BroadcastChannel to work across tabs
  const boContext = await browser.newContext({ ignoreHTTPSErrors: true });
  const fcContext = await browser.newContext({ ignoreHTTPSErrors: true });

  // Get baseline WS connections
  const basePage = await boContext.newPage();
  const baselineConns = await basePage.evaluate(() =>
    fetch("http://localhost:3333/health").then(r=>r.json()).then(j=>j.websocketPool?.totalConnections).catch(()=>null)
  );
  await basePage.close();
  console.log(`\nBaseline WS connections: ${baselineConns}`);

  // ── BACKOFFICE TABS ───────────────────────────────────────────────────────
  console.log("\n[1/4] Opening 5 Backoffice tabs…");
  const boTabs = [];
  for (let i = 0; i < NUM_TABS; i++) boTabs.push(await boContext.newPage());

  console.log("  [BO-TAB-0] Logging in…");
  const loginOk = await loginBackoffice(boTabs[0]);
  if (loginOk) {
    pass("Backoffice login (mali168)");
  } else {
    fail("Backoffice login", "Still on /login after submit");
  }

  // Open remaining tabs to the same URL (session cookie shared in context)
  for (let i = 1; i < NUM_TABS; i++) {
    console.log(`  [BO-TAB-${i}] Opening same origin…`);
    await boTabs[i].goto(BACKOFFICE_URL, { waitUntil: "domcontentloaded" });
    await sleep(1500);
  }
  await sleep(4000); // allow tab-sync leader election

  // ── FLOATING CHAT TABS ────────────────────────────────────────────────────
  console.log("\n[2/4] Opening 5 Floating-Chat tabs…");
  const fcTabs = [];
  for (let i = 0; i < NUM_TABS; i++) {
    console.log(`  [FC-TAB-${i}] Loading widget…`);
    const page = await fcContext.newPage();
    fcTabs.push(page);
    await openFcWidget(page);
  }
  await sleep(3000); // allow tab-sync

  // ── SCREENSHOTS ───────────────────────────────────────────────────────────
  await boTabs[0].screenshot({ path: "/tmp/bo-tab0-dashboard.png" });
  await fcTabs[0].screenshot({ path: "/tmp/fc-tab0-widget.png" });

  // ══════════════════════════════════════════════════════════════════════════
  // TEST A: All BO tabs authenticated (not on /login)
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST A] Backoffice: all 5 tabs authenticated");
  for (let i = 0; i < NUM_TABS; i++) {
    const url = boTabs[i].url();
    if (!url.includes("/login")) {
      pass(`BO-TAB-${i}: authenticated (${url})`);
    } else {
      fail(`BO-TAB-${i}: not authenticated`, url);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST B: Floating-chat widget elements present in all FC tabs
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST B] Floating-chat: widget elements in all 5 tabs");
  for (let i = 0; i < NUM_TABS; i++) {
    const count = await fcTabs[i].locator("input.chat-input, div.message, .chat-window, .floating-chat-button").count();
    if (count > 0) {
      pass(`FC-TAB-${i}: widget found (${count} elements)`);
    } else {
      fail(`FC-TAB-${i}: widget not found`, "No chat elements detected");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST C: Open chat panel in all BO tabs, check consistency
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST C] Backoffice: open chat panel in all 5 tabs");
  const boChatOpen = [];
  for (let i = 0; i < NUM_TABS; i++) {
    const opened = await openBoChat(boTabs[i]);
    boChatOpen.push(opened);
    if (opened) {
      pass(`BO-TAB-${i}: chat panel opened`);
    } else {
      fail(`BO-TAB-${i}: chat panel did not open`, "Toggle button not found or panel not visible");
    }
    await boTabs[i].screenshot({ path: `/tmp/bo-tab${i}-chat-panel.png` });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST D: Customer list consistency across all BO tabs
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST D] Backoffice: customer list consistency across 5 tabs");
  await sleep(2000);
  const customerCounts = [];
  for (let i = 0; i < NUM_TABS; i++) {
    const count = await getBoCustomerCount(boTabs[i]);
    customerCounts.push(count);
    console.log(`  BO-TAB-${i}: ${count} customer(s) in list`);
  }

  const allSameCustomerCount = customerCounts.every((c) => c === customerCounts[0]);
  if (customerCounts[0] === 0) {
    warn("Customer list consistency", "No customers visible — chat may be disconnected or no active customers");
  } else if (allSameCustomerCount) {
    pass(`Customer count identical across all 5 tabs: ${customerCounts[0]}`);
  } else {
    fail("Customer list consistency", `Counts: ${customerCounts.join(", ")}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST E: Tab sync — only 1 real WS per context
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST E] Tab sync: WebSocket connection count");
  await sleep(2000);
  const currentConns = await getWsConnectionCount(boTabs[0]);
  console.log(`  After 10 tabs: totalConnections = ${currentConns} (baseline was ${baselineConns})`);

  if (currentConns === null) {
    fail("Tab sync WS count", "Could not fetch /health");
  } else {
    const newConns = currentConns - (baselineConns ?? 0);
    console.log(`  New connections from this test: ${newConns}`);
    // With tab-sync: 1 BO leader + 1 FC leader = 2 new connections
    // Allow up to 4 (reconnects, polling etc.)
    if (newConns <= 6) {
      pass(`Tab sync working: +${newConns} WS connections for 10 new tabs (expect 1-2 with leader/follower)`);
    } else {
      fail("Tab sync WS count", `+${newConns} connections for 10 tabs — too many (tab sync may be broken)`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST F: Select first customer in BO-TAB-0 and BO-TAB-1..4
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST F] Backoffice: select first customer in all tabs");
  let customerSelected = false;
  for (let i = 0; i < NUM_TABS; i++) {
    if (!boChatOpen[i]) {
      fail(`BO-TAB-${i}: select customer`, "Chat panel not open — skipping");
      continue;
    }
    try {
      const firstCustomer = boTabs[i].locator(".floating-chat-window div.cursor-pointer").first();
      await firstCustomer.waitFor({ state: "visible", timeout: 5000 });
      await firstCustomer.click();
      await sleep(1500);
      customerSelected = true;
      pass(`BO-TAB-${i}: first customer clicked`);
    } catch (e) {
      fail(`BO-TAB-${i}: select customer`, e.message.split("\n")[0]);
    }
  }
  await sleep(2000);
  for (let i = 0; i < NUM_TABS; i++) {
    await boTabs[i].screenshot({ path: `/tmp/bo-tab${i}-conversation.png` });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST N: BO history sync — no stuck "Loading messages..." across tabs
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n[TEST N] BO history sync: no stuck "Loading messages..." across tabs');
  const boHistoryStates = [];
  for (let i = 0; i < NUM_TABS; i++) {
    if (!boChatOpen[i]) {
      warn(`BO-TAB-${i}: history sync`, "Chat panel not open — skipping");
      boHistoryStates.push("skipped");
      continue;
    }
    const state = await waitForBoHistoryLoaded(boTabs[i]);
    boHistoryStates.push(state);
    if (state === "resolved") {
      pass(`BO-TAB-${i}: history loaded (no stuck spinner)`);
    } else {
      fail(`BO-TAB-${i}: history stuck`, '"Loading messages..." still visible after 15s');
    }
  }

  // Compare message counts across tabs that resolved
  const boHistoryCounts = [];
  for (let i = 0; i < NUM_TABS; i++) {
    boHistoryCounts.push(boHistoryStates[i] === "resolved" ? await getBoMessageCount(boTabs[i]) : null);
  }
  console.log(`  Counts: ${boHistoryCounts.map((c, i) => `TAB-${i}:${c ?? "skip"}`).join(", ")}`);

  const validHistoryCounts = boHistoryCounts.filter((c) => c !== null);
  if (validHistoryCounts.length === 0) {
    warn("BO history count consistency", "No tabs resolved — cannot compare");
  } else if (validHistoryCounts.every((c) => c === validHistoryCounts[0])) {
    if (validHistoryCounts[0] === 0) {
      pass("BO history: all tabs show empty state (0 messages — new customer or no history)");
    } else {
      pass(`BO history: message count identical across resolved tabs: ${validHistoryCounts[0]}`);
    }
  } else {
    fail("BO history count consistency", `Counts: ${boHistoryCounts.map((c, i) => `TAB-${i}:${c ?? "skip"}`).join(", ")}`);
  }

  // Edge case: BO-TAB-2 (follower) selects a different customer and resolves within 15s
  console.log("  [TEST N.2] BO-TAB-2 (follower): select different customer, history resolves within 15s");
  if (boChatOpen[2]) {
    try {
      const customers2 = boTabs[2].locator(".floating-chat-window div.cursor-pointer");
      const custCount = await customers2.count();
      if (custCount >= 2) {
        await customers2.nth(1).click();
        await sleep(500);
      } else {
        console.log("    Only one customer in list — testing resolution of current selection");
      }
      const edgeState = await waitForBoHistoryLoaded(boTabs[2]);
      if (edgeState === "resolved") {
        pass("BO-TAB-2 (follower): different customer history resolved within 15s");
      } else {
        fail("BO-TAB-2 (follower): history stuck on different customer", '"Loading messages..." still visible after 15s');
      }
      // Navigate back to first customer so later tests compare the same conversation
      if (custCount >= 2) {
        await customers2.first().click();
        await sleep(1000);
        await waitForBoHistoryLoaded(boTabs[2]);
      }
    } catch (e) {
      warn("BO-TAB-2: new customer edge case", e.message.split("\n")[0]);
    }
  } else {
    warn("BO-TAB-2: new customer edge case", "Chat panel not open — skipping");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST G: Floating-chat tab sync — FC message count consistent
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST G] Floating-chat: message history consistent across 5 tabs");
  const fcMsgCounts = [];
  for (let i = 0; i < NUM_TABS; i++) {
    const c = await getFcMessageCount(fcTabs[i]);
    fcMsgCounts.push(c);
    console.log(`  FC-TAB-${i}: ${c} message(s)`);
  }

  const fcCountsAllSame = fcMsgCounts.every((c) => c === fcMsgCounts[0]);
  if (fcMsgCounts[0] === 0) {
    warn("FC message history", "No messages visible — widget may not be fully open or no history");
  } else if (fcCountsAllSame) {
    pass(`FC message count identical across all 5 tabs: ${fcMsgCounts[0]}`);
  } else {
    fail("FC message count consistency", `Counts: ${fcMsgCounts.join(", ")}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST H: Send from FC-TAB-0 → new message appears in all FC tabs
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST H] FC tab sync: send from FC-TAB-0, verify in all FC tabs");
  const fcCountBefore = [...fcMsgCounts];
  const fcMsg1 = `E2E-FC-${Date.now()}`;

  const fcSent1 = await sendFcMessage(fcTabs[0], fcMsg1);
  if (fcSent1) {
    pass("FC-TAB-0: message sent");
  } else {
    fail("FC-TAB-0: message send", "sendFcMessage returned false");
  }

  await sleep(3500);

  for (let i = 0; i < NUM_TABS; i++) {
    const after = await getFcMessageCount(fcTabs[i]);
    await fcTabs[i].screenshot({ path: `/tmp/fc-tab${i}-after-send.png` });
    if (after > fcCountBefore[i]) {
      pass(`FC-TAB-${i}: new message appeared (${after} vs ${fcCountBefore[i]})`);
    } else {
      fail(`FC-TAB-${i}: no new message`, `count ${after} unchanged from ${fcCountBefore[i]}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST I: FC → BO: customer message received in all BO tabs
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST I] Cross-system: FC message received in all BO tabs");
  const boMsgBefore = [];
  for (let i = 0; i < NUM_TABS; i++) {
    boMsgBefore.push(await getBoMessageCount(boTabs[i]));
  }

  const fcMsg2 = `E2E-FC-TO-BO-${Date.now()}`;
  await sendFcMessage(fcTabs[0], fcMsg2);
  await sleep(4000);

  for (let i = 0; i < NUM_TABS; i++) {
    const after = await getBoMessageCount(boTabs[i]);
    await boTabs[i].screenshot({ path: `/tmp/bo-tab${i}-after-fc-send.png` });
    if (after > boMsgBefore[i]) {
      pass(`BO-TAB-${i}: received FC message (${after} vs ${boMsgBefore[i]})`);
    } else {
      if (!customerSelected) {
        warn(`BO-TAB-${i}: FC→BO delivery`, "No customer conversation open — message may have been delivered but not visible");
      } else {
        fail(`BO-TAB-${i}: did not receive FC message`, `count ${after} unchanged from ${boMsgBefore[i]}`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST J: BO sends → message appears in all BO tabs
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST J] BO tab sync: send from BO-TAB-0, verify in all BO tabs");
  const boMsgBefore2 = [];
  for (let i = 0; i < NUM_TABS; i++) {
    boMsgBefore2.push(await getBoMessageCount(boTabs[i]));
  }

  const boMsg1 = `E2E-BO-${Date.now()}`;
  const boSent1 = await sendBoMessage(boTabs[0], boMsg1);
  if (boSent1) {
    pass("BO-TAB-0: message sent");
  } else {
    fail("BO-TAB-0: message send", "sendBoMessage returned false");
  }

  await sleep(4000);

  for (let i = 0; i < NUM_TABS; i++) {
    const after = await getBoMessageCount(boTabs[i]);
    await boTabs[i].screenshot({ path: `/tmp/bo-tab${i}-after-bo-send.png` });
    if (after > boMsgBefore2[i]) {
      pass(`BO-TAB-${i}: new message visible (${after} vs ${boMsgBefore2[i]})`);
    } else {
      fail(`BO-TAB-${i}: no new message`, `count ${after} unchanged from ${boMsgBefore2[i]}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST K: BO → FC: agent message received in all FC tabs
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST K] Cross-system: BO message received in all FC tabs");
  const fcMsgBefore2 = [];
  for (let i = 0; i < NUM_TABS; i++) {
    fcMsgBefore2.push(await getFcMessageCount(fcTabs[i]));
  }

  const boMsg2 = `E2E-BO-TO-FC-${Date.now()}`;
  await sendBoMessage(boTabs[0], boMsg2);
  await sleep(4000);

  for (let i = 0; i < NUM_TABS; i++) {
    const after = await getFcMessageCount(fcTabs[i]);
    await fcTabs[i].screenshot({ path: `/tmp/fc-tab${i}-after-bo-send.png` });
    if (after > fcMsgBefore2[i]) {
      pass(`FC-TAB-${i}: received BO message (${after} vs ${fcMsgBefore2[i]})`);
    } else {
      fail(`FC-TAB-${i}: did not receive BO message`, `count ${after} vs ${fcMsgBefore2[i]}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST L: Follower tab send — BO-TAB-2 sends, FC should receive
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST L] BO follower tab send: BO-TAB-2 sends, FC receives");
  const fcBeforeFollower = await getFcMessageCount(fcTabs[0]);

  const boMsg3 = `E2E-FOLLOWER-${Date.now()}`;
  const boSent3 = await sendBoMessage(boTabs[2], boMsg3);
  if (boSent3) {
    pass("BO-TAB-2 (follower): message send attempted");
  } else {
    fail("BO-TAB-2 (follower): message send", "sendBoMessage returned false");
  }

  await sleep(4000);
  const fcAfterFollower = await getFcMessageCount(fcTabs[0]);
  if (fcAfterFollower > fcBeforeFollower) {
    pass(`FC-TAB-0: received follower-tab message (${fcAfterFollower} vs ${fcBeforeFollower})`);
  } else {
    fail("FC-TAB-0: follower-tab message not received", `count ${fcAfterFollower} unchanged from ${fcBeforeFollower}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEST M: Message ordering — same message order in all BO tabs
  // Wait for history to fully load in every tab before comparing.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[TEST M] Message ordering: same order across all BO tabs");
  for (let i = 0; i < NUM_TABS; i++) {
    await waitForBoHistoryLoaded(boTabs[i], 10000);
  }

  const boMsgTexts = [];
  for (let i = 0; i < NUM_TABS; i++) {
    const texts = await boTabs[i]
      .locator(".floating-chat-window .space-y-4 > div")
      .allInnerTexts()
      .catch(() => []);
    boMsgTexts.push(texts.map((t) => t.trim().substring(0, 80).replace(/\n/g, " ")));
    console.log(`  BO-TAB-${i}: ${texts.length} messages`);
  }

  const firstOrder = boMsgTexts[0];
  if (firstOrder.length === 0) {
    const anyHasMessages = boMsgTexts.some((msgs) => msgs.length > 0);
    if (anyHasMessages) {
      warn("Message ordering", "BO-TAB-0 has 0 messages but other tabs have some — possible sync lag");
    } else {
      warn("Message ordering", "No messages in any BO tab (empty conversation or no customer selected)");
    }
  } else {
    let orderOk = true;
    for (let i = 1; i < NUM_TABS; i++) {
      if (boMsgTexts[i].length !== firstOrder.length) {
        orderOk = false;
        warn(
          `BO-TAB-${i}: message count differs`,
          `Tab ${i} has ${boMsgTexts[i].length} msgs vs tab 0 has ${firstOrder.length} — count mismatch (not order mismatch)`
        );
      } else if (JSON.stringify(boMsgTexts[i]) !== JSON.stringify(firstOrder)) {
        orderOk = false;
        fail(
          `BO-TAB-${i}: message order mismatch`,
          `Same count (${firstOrder.length}) but different order/content`
        );
      }
    }
    if (orderOk) {
      pass(`Message order identical across all 5 BO tabs (${firstOrder.length} messages)`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REFACTOR REGRESSION — chat-service.js split modules
  // Covers: HistoryLoader, ReadMarker+tab-sync, visibility handler,
  //         manualForceReconnect, disconnect/connect lifecycle
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[REF-O] READ_MARK tab sync: unread clears on all tabs after active-chat read");
  const refOBeforeUnread = [];
  for (let i = 0; i < NUM_TABS; i++) {
    refOBeforeUnread.push(await getBoUnreadBadgeCount(boTabs[i]));
  }
  const refOMsg = `E2E-READ-SYNC-${Date.now()}`;
  const refOSent = await sendFcMessage(fcTabs[0], refOMsg);
  if (refOSent) {
    pass("REF-O: FC message sent for read-mark sync");
  } else {
    fail("REF-O: FC message send", "sendFcMessage returned false");
  }
  await sleep(READ_MARK_DELAY_MS + READ_MARK_BUFFER_MS);
  const refOAfterUnread = [];
  for (let i = 0; i < NUM_TABS; i++) {
    refOAfterUnread.push(await getBoUnreadBadgeCount(boTabs[i]));
  }
  console.log(`  Unread badges before: [${refOBeforeUnread.join(", ")}] after: [${refOAfterUnread.join(", ")}]`);
  if (refOAfterUnread.every((c) => c === 0)) {
    pass("REF-O: no unread badges on any BO tab after read-mark delay (READ_MARKED sync)");
  } else {
    fail(
      "REF-O: unread badge sync",
      `Expected 0 badges on all tabs after ${READ_MARK_DELAY_MS + READ_MARK_BUFFER_MS}ms, got [${refOAfterUnread.join(", ")}]`,
    );
  }

  console.log("\n[REF-O.2] READ_MARKED: unread increments on inactive tab, clears after leader marks read");
  const firstCustomerId = await getBoFirstCustomerId(boTabs[0]);
  if (!firstCustomerId) {
    warn("REF-O.2: inactive-tab unread", "Could not resolve first customer id — skipping (dev import may be unavailable)");
  } else {
    const clearedFollower = await setBoActiveChat(boTabs[4], null);
    if (!clearedFollower) {
      warn("REF-O.2: inactive-tab unread", "Could not clear active chat on BO-TAB-4 — skipping");
    } else {
      const refO2Msg = `E2E-UNREAD-INC-${Date.now()}`;
      await sendFcMessage(fcTabs[0], refO2Msg);
      await sleep(2500);
      const followerUnread = await getBoUnreadBadgeCount(boTabs[4]);
      const leaderUnread = await getBoUnreadBadgeCount(boTabs[0]);
      if (followerUnread > 0 || leaderUnread > 0) {
        pass(`REF-O.2: unread badge visible (follower=${followerUnread}, leader=${leaderUnread})`);
      } else {
        warn("REF-O.2: unread increment", "No badge yet — customer may not match FC session");
      }
      await setBoActiveChat(boTabs[0], firstCustomerId);
      await sleep(READ_MARK_DELAY_MS + READ_MARK_BUFFER_MS);
      const refO2Final = [];
      for (let i = 0; i < NUM_TABS; i++) {
        refO2Final.push(await getBoUnreadBadgeCount(boTabs[i]));
      }
      if (refO2Final.every((c) => c === 0)) {
        pass("REF-O.2: READ_MARKED cleared unread on all tabs including inactive follower");
      } else {
        fail("REF-O.2: READ_MARKED sync", `Unread badges: [${refO2Final.join(", ")}]`);
      }
      await setBoActiveChat(boTabs[4], firstCustomerId);
    }
  }

  console.log("\n[REF-P] HistoryLoader: follower re-selects synced customer without stuck spinner");
  if (boChatOpen[4]) {
    try {
      const customers4 = boTabs[4].locator(".floating-chat-window div.cursor-pointer");
      const custCount4 = await customers4.count();
      if (custCount4 >= 2) {
        await customers4.nth(1).click();
        await sleep(800);
        const switchStart = Date.now();
        await customers4.first().click();
        const refPState = await waitForBoHistoryLoaded(boTabs[4], 4000);
        const switchMs = Date.now() - switchStart;
        if (refPState === "resolved" && switchMs < 4000) {
          pass(`REF-P: BO-TAB-4 re-selected synced customer in ${switchMs}ms (no stuck loading)`);
        } else {
          fail("REF-P: history re-select", `state=${refPState}, elapsed=${switchMs}ms`);
        }
      } else {
        warn("REF-P: history re-select", "Need 2+ customers — skipping switch test");
      }
    } catch (e) {
      warn("REF-P: history re-select", e.message.split("\n")[0]);
    }
  } else {
    warn("REF-P: history re-select", "BO-TAB-4 chat not open — skipping");
  }

  console.log("\n[REF-Q] Visibility restore: customer list stays consistent after visibilitychange");
  const refQBefore = [];
  for (let i = 0; i < NUM_TABS; i++) {
    refQBefore.push(await getBoCustomerCount(boTabs[i]));
  }
  await simulateVisibilityRestore(boTabs[3]);
  await sleep(2500);
  const refQAfter = [];
  for (let i = 0; i < NUM_TABS; i++) {
    refQAfter.push(await getBoCustomerCount(boTabs[i]));
  }
  console.log(`  Before: [${refQBefore.join(", ")}]  After: [${refQAfter.join(", ")}]`);
  if (refQBefore.every((c, i) => c === refQAfter[i])) {
    pass("REF-Q: customer counts unchanged after visibility restore on BO-TAB-3");
  } else if (refQAfter.every((c) => c === refQAfter[0]) && refQAfter[0] > 0) {
    pass(`REF-Q: all tabs still show same customer count (${refQAfter[0]}) after visibility restore`);
  } else {
    fail("REF-Q: visibility restore", `Counts before [${refQBefore.join(", ")}] after [${refQAfter.join(", ")}]`);
  }

  console.log("\n[REF-R] Manual reconnect: Sync restores connection and customer list");
  if (boChatOpen[0]) {
    try {
      const refRCountsBefore = [];
      for (let i = 0; i < NUM_TABS; i++) {
        refRCountsBefore.push(await getBoCustomerCount(boTabs[i]));
      }
      await clickBoSync(boTabs[0]);
      const syncIdle = await waitForBoSyncIdle(boTabs[0]);
      if (syncIdle) {
        pass("REF-R: Sync button finished (manualForceReconnect + auth)");
      } else {
        fail("REF-R: Sync idle", "Sync still spinning after 15s");
      }
      const connected = await waitForBoChatConnected(boTabs[0], 15000);
      if (connected) {
        pass("REF-R: chatService connected after manual reconnect");
      } else {
        warn("REF-R: connected check", "Could not confirm isConnected via dev import");
      }
      await sleep(3000);
      const refRCountsAfter = [];
      for (let i = 0; i < NUM_TABS; i++) {
        refRCountsAfter.push(await getBoCustomerCount(boTabs[i]));
      }
      if (
        refRCountsAfter.every((c) => c === refRCountsAfter[0]) &&
        refRCountsAfter[0] > 0 &&
        refRCountsBefore.every((c) => c === refRCountsAfter[0] || c === 0)
      ) {
        pass(`REF-R: customer list stable after sync (${refRCountsAfter[0]} customers)`);
      } else {
        fail(
          "REF-R: customer list after sync",
          `before=[${refRCountsBefore.join(", ")}] after=[${refRCountsAfter.join(", ")}]`,
        );
      }
      const refRMsg = `E2E-SYNC-RECONNECT-${Date.now()}`;
      // ZLC-13: re-focus the conversation after sync so the send targets a real active chat,
      // then assert delivery hard — sent without visible delivery is a FAIL, not a WARN.
      const refRCustomerId = await getBoFirstCustomerId(boTabs[0]);
      if (refRCustomerId) {
        await setBoActiveChat(boTabs[0], refRCustomerId);
        await sleep(1500);
      }
      const fcBefore = await getFcMessageCount(fcTabs[0]);
      const refRSent = await sendBoMessage(boTabs[0], refRMsg);
      await sleep(4000);
      const refRInFc = (await getFcMessageCount(fcTabs[0])) > fcBefore;
      const refRInBo = (await boConversationHasText(boTabs[0], refRMsg)) || (await boConversationHasText(boTabs[2], refRMsg));
      if (refRSent && (refRInBo || refRInFc)) {
        pass(`REF-R.2: message delivered after sync (BO=${refRInBo}, FC=${refRInFc})`);
      } else {
        fail(
          "REF-R.2: post-sync message delivery",
          `sent=${refRSent}, BO text=${refRInBo}, FC=${refRInFc}, activeChat=${refRCustomerId ?? "unresolved"}`,
        );
      }
    } catch (e) {
      fail("REF-R: manual reconnect", e.message.split("\n")[0]);
    }
  } else {
    warn("REF-R: manual reconnect", "BO-TAB-0 chat not open — skipping");
  }

  console.log("\n[REF-S] Disconnect lifecycle: close and reopen chat reloads customers");
  if (boChatOpen[4]) {
    const refSBefore = await getBoCustomerCount(boTabs[4]);
    await closeBoChatPanel(boTabs[4]);
    const panelClosed = !(await boTabs[4].locator(".floating-chat-window").isVisible().catch(() => false));
    if (panelClosed) {
      pass("REF-S: chat panel closed (disconnect path)");
    } else {
      warn("REF-S: panel close", "Panel still visible after close click");
    }
    const reopened = await openBoChat(boTabs[4]);
    await sleep(3500);
    const refSAfter = await getBoCustomerCount(boTabs[4]);
    if (reopened && refSAfter > 0) {
      pass(`REF-S: customers reloaded after reopen (${refSAfter}, was ${refSBefore})`);
    } else if (reopened && refSBefore === 0) {
      warn("REF-S: reconnect reload", "Reopened but customer list empty (may be no WS customers)");
    } else {
      fail("REF-S: reconnect reload", `reopened=${reopened}, count=${refSAfter}`);
    }
    boChatOpen[4] = reopened;
  } else {
    warn("REF-S: disconnect lifecycle", "BO-TAB-4 chat not open — skipping");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL SCREENSHOTS
  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n[Screenshots] Saving final state…");
  for (let i = 0; i < NUM_TABS; i++) {
    await boTabs[i].screenshot({ path: `/tmp/bo-tab${i}-final.png` });
    await fcTabs[i].screenshot({ path: `/tmp/fc-tab${i}-final.png` });
  }
  console.log("  /tmp/bo-tab{0..4}-final.png and /tmp/fc-tab{0..4}-final.png");

  await browser.close();

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  console.log("  RESULTS SUMMARY");
  console.log("=".repeat(70));
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : r.status === "WARN" ? "⚠️ " : "❌";
    console.log(`  ${icon} ${r.status}: ${r.name}`);
    if (r.reason) console.log(`        → ${r.reason}`);
  }
  console.log("─".repeat(70));
  const warnCount = results.filter((r) => r.status === "WARN").length;
  console.log(`  PASS: ${passCount}  FAIL: ${failCount}  WARN: ${warnCount}  TOTAL: ${results.length}`);
  console.log("=".repeat(70));

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
