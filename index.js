/**
 * WhatsApp Group Bot — Railway
 * - Invite group auto-join
 * - hi/hello → Hi {name}
 * - GREET_EVERY=1 → every msg (cooldown)
 * - gm / good morning → 🎩 reaction
 * - /ai question → Gemini
 *
 * Railway Variables:
 *   GEMINI_API_KEY=...
 *   GROUP_INVITE=HFw2Mls8FFDGycV8iOiryw
 *   GREET_EVERY=1
 *   GREET_COOLDOWN_SEC=300
 *   TARGET_GROUP=   (optional name filter)
 *
 * Volume mount: /app/auth_info
 */
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

const GREET_COOLDOWN = Number(process.env.GREET_COOLDOWN_SEC || 300);
const TARGET_GROUP = (process.env.TARGET_GROUP || "").toLowerCase();
const GREET_EVERY = process.env.GREET_EVERY === "1";
const GROUP_INVITE = (process.env.GROUP_INVITE || "HFw2Mls8FFDGycV8iOiryw").trim();
const HAT = "🎩";

let TARGET_JID = (process.env.TARGET_JID || "").trim();
const lastGreet = new Map();

let GeminiModel = null;
if (process.env.GEMINI_API_KEY) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    GeminiModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    console.log("[OK] Gemini enabled");
  } catch (e) {
    console.log("[WARN] Gemini init:", e.message);
  }
} else {
  console.log("[WARN] GEMINI_API_KEY not set — /ai disabled");
}

function isGroup(jid) {
  return jid && jid.endsWith("@g.us");
}

function displayName(msg) {
  const push = (msg.pushName || "").trim();
  if (push) return push;
  const p = msg.key.participant || msg.key.remoteJid || "";
  return p.split("@")[0] || "friend";
}

function textOf(msg) {
  const m = msg.message || {};
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ""
  ).trim();
}

function isGoodMorning(t) {
  const s = t.toLowerCase().trim();
  if (s === "gm" || s === "g.m." || s === "good morning") return true;
  return /(?:^|\s)(gm|g\.m\.|good\s*morning)(?:\s|$|[!.])/i.test(s);
}

async function askGemini(prompt) {
  if (!GeminiModel) return "AI off — set GEMINI_API_KEY in Railway Variables";
  try {
    const r = await GeminiModel.generateContent(prompt);
    return r.response.text();
  } catch (e) {
    return "AI error: " + e.message;
  }
}

async function joinInvite(sock) {
  if (!GROUP_INVITE) return;
  try {
    const res = await sock.groupAcceptInvite(GROUP_INVITE);
    if (typeof res === "string" && res.endsWith("@g.us")) {
      TARGET_JID = res;
    } else if (res && res.gid) {
      TARGET_JID = res.gid;
    }
    console.log("[OK] Joined/invite OK. TARGET_JID=", TARGET_JID || "(unknown)");
  } catch (e) {
    console.log("[WARN] groupAcceptInvite:", e.message);
    console.log("[INFO] Bot may already be in the group — will still reply in groups.");
  }
}

async function startBot() {
  const authDir = path.join(process.cwd(), "auth_info");
  fs.mkdirSync(authDir, { recursive: true });
  console.log("[INFO] Auth folder:", authDir);

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log("[INFO] WA version:", version.join("."), "latest=", isLatest);

  const sock = makeWASocket({
    version,
    logger: pino({ level: "warn" }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n========== SCAN QR ==========");
      console.log("WhatsApp → Linked devices → Link a device\n");
      qrcode.generate(qr, { small: true });
      console.log("\n=============================\n");
    }

    if (connection === "connecting") {
      console.log("[INFO] Connecting...");
    }

    if (connection === "open") {
      console.log("[OK] WhatsApp CONNECTED:", sock.user?.id || "?");
      await joinInvite(sock);
    }

    if (connection === "close") {
      const status = lastDisconnect?.error?.output?.statusCode;
      const msg = lastDisconnect?.error?.message || "";
      console.log("[CLOSE] code=", status, "msg=", msg);

      if (status === DisconnectReason.loggedOut || status === 401) {
        console.log("[FATAL] Logged out. Clear auth_info volume & redeploy for new QR.");
        return;
      }

      console.log("[INFO] Reconnect in 5s...");
      setTimeout(() => {
        startBot().catch((e) => console.error("[FATAL]", e));
      }, 5000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        if (!isGroup(jid)) continue;

        // Only invite group if we know its JID
        if (TARGET_JID && jid !== TARGET_JID) continue;

        // Optional name filter (if JID unknown)
        if (!TARGET_JID && TARGET_GROUP) {
          const meta = await sock.groupMetadata(jid).catch(() => null);
          const subject = (meta?.subject || "").toLowerCase();
          if (!subject.includes(TARGET_GROUP)) continue;
        }

        const body = textOf(msg);
        if (!body) continue;

        const name = displayName(msg);
        const participant = msg.key.participant || "";

        // gm → 🎩
        if (isGoodMorning(body)) {
          try {
            await sock.sendMessage(jid, {
              react: { text: HAT, key: msg.key },
            });
            console.log("[REACT]", name, body);
          } catch (e) {
            console.log("[REACT ERR]", e.message);
          }
        }

        // Hi {name}
        const now = Date.now();
        const gKey = jid + ":" + participant;
        const last = lastGreet.get(gKey) || 0;
        if (now - last > GREET_COOLDOWN * 1000) {
          const isHello = /^(hi|hello|hey|hii)\b/i.test(body);
          if (GREET_EVERY || isHello) {
            lastGreet.set(gKey, now);
            await sock.sendMessage(jid, { text: `Hi ${name} 👋` });
            console.log("[GREET]", name);
          }
        }

        // /ai
        if (body.toLowerCase().startsWith("/ai ")) {
          const q = body.slice(4).trim();
          if (q) {
            const ans = await askGemini(q);
            await sock.sendMessage(jid, { text: ans }, { quoted: msg });
            console.log("[AI]", name, q.slice(0, 40));
          }
        }
      } catch (e) {
        console.log("[ERR]", e.message);
      }
    }
  });
}

console.log("=== WhatsApp Group Bot ===");
console.log("GROUP_INVITE =", GROUP_INVITE || "(none)");
console.log("GREET_EVERY  =", GREET_EVERY);
startBot().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
