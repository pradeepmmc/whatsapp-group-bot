const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: "AIzaSyDosD4hUD1Mbjz4Y1zl38ehDNvMfBN64VQ" });

const TARGET_PHONE_NUMBER = "94767181514";

async function askGemini(promptText) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: promptText,
        });
        
        // Response එකෙන් නිවැරදි පෙළ (Text) ලබා ගැනීම
        if (response && response.text) {
            return response.text;
        } else if (response && response.candidates && response.candidates[0]?.content?.parts?.[0]?.text) {
            return response.candidates[0].content.parts[0].text;
        }
        return "ප්‍රතිචාරයක් ලැබුණේ නැත.";
    } catch (error) {
        console.error("Gemini API Detailed Error:", error);
        return "සමාවෙන්න, මට මේ මොහොතේ පිළිතුරු දීමට නොහැකි විය.";
    }
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(TARGET_PHONE_NUMBER);
                console.log(`\n🔑 ඔබගේ WhatsApp Pairing Code එක මෙයයි: \x1b[32m${code}\x1b[0m\n`);
                console.log("ඔබගේ WhatsApp -> Linked Devices -> Link with phone number වෙත ගොස් මෙම කේතය ඇතුළත් කරන්න.");
            } catch (err) {
                console.error("Pairing Code ලබා ගැනීමේ දෝෂයක්:", err);
            }
        }, 4000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp බොට් එක සාර්ථකව සම්බන්ධ විය!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const messageContent = msg.message.conversation || 
                                   msg.message.extendedTextMessage?.text || '';
            
            if (!messageContent) continue;

            const remoteJid = msg.key.remoteJid;
            const isGroup = remoteJid.endsWith('@g.us');

            if (isGroup || messageContent.startsWith('!ai')) {
                const query = messageContent.startsWith('!ai') ? messageContent.replace('!ai', '').trim() : messageContent;
                if (!query) return;

                console.log(`[AI Request] ලැබුණු ප්‍රශ්නය: ${query}`);
                const replyText = await askGemini(query);
                await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
            }
        }
    });
}

connectToWhatsApp();
