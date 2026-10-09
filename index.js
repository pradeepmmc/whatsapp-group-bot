/**
 * WhatsApp Group Bot (Baileys) — Railway ready
 * - New message in group → Hi {name}
 * - gm / good morning → react 🎩
 * - /ai <question> → Gemini reply (optional)
 *
 * ENV:
 *   GEMINI_API_KEY=...   (optional)
 *   TARGET_GROUP=        (optional: group name partial match)
 *   GREET_COOLDOWN_SEC=300
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

const GREET_COOLDOWN = Number(process.env.GREET_COOLDOWN_SEC || 300); // per user
const TARGET_GROUP = (process.env.TARGET_GROUP || "").toLowerCase();
const HAT = "🎩";

// last greet time: jid -> timestamp
const lastGreet = new Map();

let GeminiModel = null;
if (process.env.GEMINI_API_KEY) {
  try {
    const { GoogleGenerativeAI } = require("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    GeminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    console.log("Gemini enabled");
  } catch (e) {
    console.log("Gemini init failed:", e.message);
  }
}

function isGroup(jid) {
  return jid && jid.endsWith("@g.us");
}

function displayName(msg, sock) {
  const push = msg.pushName || "";
  if (push.trim()) return push.trim();
  const participant = msg.key.participant || msg.key.remoteJid || "";
  return participant.split("@")[0] || "friend";
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
  const s = t.toLowerCase();
  return (
    /(?:^|\s)(gm|g\.m\.|good\s*morning|subha\s*udawas|සුභ\s*උදාව|ගුඩ්\s*මොනිං)(?:\s|$|[!.])/i.test(
      s
    ) || s === "gm" || s === "good morning"
  );
}

async function askGemini(prompt) {
  if (!GeminiModel) return "AI disabled (set GEMINI_API_KEY).";
  try {
    const r = await GeminiModel.generateContent(prompt);
    return r.response.text();
  } catch (e) {
    return "AI error: " + e.message;
  }
}

async function start() {
  const authDir = path.join(process.cwd(), "auth_info");
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      console.log("\n=== Scan this QR with WhatsApp (Linked Devices) ===\n");
      qrcode.generate(qr, { small: true });
      console.log("\nRailway logs එකේ QR පේනවා. Phone → Linked devices → Link a device\n");
    }
    if (connection === "open") {
      console.log("WhatsApp connected.");
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log("Connection closed:", code, "reconnect=", shouldReconnect);
      if (shouldReconnect) setTimeout(start, 3000);
      else console.log("Logged out. Delete auth_info and redeploy to scan QR again.");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        const jid = msg.key.remoteJid;
        if (!isGroup(jid)) continue; // groups only

        // optional: only one group by name
        if (TARGET_GROUP) {
          const meta = await sock.groupMetadata(jid).catch(() => null);
          const subject = (meta?.subject || "").toLowerCase();
          if (!subject.includes(TARGET_GROUP)) continue;
        }

        const body = textOf(msg);
        if (!body) continue;

        const name = displayName(msg, sock);
        const participant = msg.key.participant || "";

        // 1) gm / good morning → react 🎩
        if (isGoodMorning(body)) {
          try {
            await sock.sendMessage(jid, {
              react: { text: HAT, key: msg.key },
            });
            console.log(`React ${HAT} → ${name}: ${body}`);
          } catch (e) {
            console.log("React failed:", e.message);
          }
        }

        // 2) greet by name (cooldown so not every message)
        const now = Date.now();
        const gKey = jid + ":" + participant;
        const last = lastGreet.get(gKey) || 0;
        if (now - last > GREET_COOLDOWN * 1000) {
          // only greet on short hellos / first activity style — or every msg after cooldown
          const isHello = /^(hi|hello|hey|hii|හායි|ආයුබෝවන්)\b/i.test(body);
          // User asked: anyone messages → hi with name. That can spam.
          // Default: greet on hello OR first msg after cooldown for any msg.
          // Safer default: greet only on hi/hello; set GREET_EVERY=1 to greet all.
          const greetEvery = process.env.GREET_EVERY === "1";
          if (greetEvery || isHello) {
            lastGreet.set(gKey, now);
            await sock.sendMessage(jid, {
              text: `Hi ${name} 👋`,
            });
            console.log(`Greeted ${name}`);
          }
        }

        // 3) optional AI: /ai question
        if (body.toLowerCase().startsWith("/ai ")) {
          const q = body.slice(4).trim();
          if (q) {
            await sock.sendMessage(jid, { text: "🤔 ..." }, { quoted: msg });
            const ans = await askGemini(q);
            await sock.sendMessage(jid, { text: ans }, { quoted: msg });
          }
        }
      } catch (err) {
        console.log("Handler error:", err.message);
      }
    }
  });
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
