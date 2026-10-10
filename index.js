const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { GoogleGenAI } = require('@google/genai');

// Google Gemini AI වින්‍යාසය (ඔබගේ API Key එක මෙහි ඇතුළත් කර ඇත)
const GEMINI_API_KEY = "AIzaSyDosD4hUD1Mbjz4Y1zl38ehDNvMfBN64VQ";
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// බොට් එක සම්බන්ධ කිරීමට භාවිත කරන දුරකථන අංකය
const TARGET_PHONE_NUMBER = "94767181514";

async function askGemini(promptText) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: promptText,
        });
        return response.text;
    } catch (error) {
        console.error("Gemini API Error:", error);
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

    // Pairing Code මඟින් සම්බන්ධ වීම (QR කෝඩ් ස්කෑන් කිරීම අවශ්‍ය නැත)
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(TARGET_PHONE_NUMBER);
                console.log(`\n🔑 ඔබගේ WhatsApp Pairing Code එක මෙයයි: \x1b[32m${code}\x1b[0m\n`);
                console.log("ඔබගේ WhatsApp -> Linked Devices -> Link with phone number වෙත ගොස් මෙම කේතය ඇතුළත් කරන්න.");
            } catch (err) {
                console.error("Pairing Code ලබා ගැනීමටහේතුවක් නිසා අසමත් විය:", err);
            }
        }, 4000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('සම්බන්ධතාවය බිඳ වැටුණි. නැවත සම්බන්ධ වෙමින් පවතී...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp බොට් එක සාර්ථකව සම්බන්ධ විය!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ගෘප් එකෙන් හෝ වෙනත් අයගෙන් එන පණිවිඩ පරීක්ෂා කිරීම
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const messageContent = msg.message.conversation || 
                                   msg.message.extendedTextMessage?.text || '';
            
            if (!messageContent) continue;

            const remoteJid = msg.key.remoteJid;
            const isGroup = remoteJid.endsWith('@g.us');

            // කෙනෙක් බොට්ව මෙන්ෂන් කළ විට හෝ ගෘප් එකේ යම් ප්‍රශ්නයක් ඇසූ විට (මෙහි ඔබට අවශ්‍ය පරිදි කොන්දේසි වෙනස් කරගත හැක)
            if (messageContent.startsWith('!ai') || isGroup) {
                // '!ai' අයින් කර ප්‍රශ්නය පමණක් ලබා ගැනීම
                const query = messageContent.startsWith('!ai') ? messageContent.replace('!ai', '').trim() : messageContent;
                
                if (!query) return;

                console.log(`[AI Request] ලැබුණු ප්‍රශ්නය: ${query}`);
                
                // Gemini AI වෙතින් පිළිතුර ලබා ගැනීම
                const replyText = await askGemini(query);

                // WhatsApp වෙත ප්‍රතිචාරය යැවීම
                await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
            }
        }
    });
}

connectToWhatsApp();
