const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // QR කෝඩ් එක ටර්මෙක්ස් එකේ පෙන්වීම අක්‍රීය කරයි
        logger: pino({ level: 'silent' })
    });

    // ඔබගේ දුරකථන අංකය මඟින් සම්බන්ධ වීම සඳහා (Pairing Code)
    if (!sock.authState.creds.registered) {
        // මෙහි ඔබේ WhatsApp අංකය රටේ කේතය සමඟ (උදාහරණයක් ලෙස 9477xxxxxxx) ඇතුළත් කරන්න
        const phoneNumber = await question("ඔබේ WhatsApp අංකය ඇතුළත් කරන්න (උදා: 9477xxxxxxx): ");
        
        setTimeout(async () => {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(`\n🔑 ඔබේ Pairing Code එක මෙයයි: \x1b[32m${code}\x1b[0m\n`);
            console.log("ඔබගේ WhatsApp -> Linked Devices -> Link with phone number වෙත ගොස් මෙම කේතය ඇතුළත් කරන්න.");
        }, 3000);
    }

    sock.io.on('connection.update', (update) => {
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
}

connectToWhatsApp();
