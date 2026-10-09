globalThis.crypto = require('crypto')
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const fs = require('fs')

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Chrome', 'Chrome', '1.0']
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log('--- SCAN THIS QR IN WHATSAPP ---')
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const reason = lastDisconnect?.error?.output?.payload?.message || lastDisconnect?.error?.message
            console.log('Closed, status:', statusCode, 'Reason:', reason)

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log('Logged out, deleting auth...')
                if (fs.existsSync('auth_info')) {
                    fs.rmSync('auth_info', { recursive: true, force: true })
                }
            }
            // 5 sec passe restart
            setTimeout(() => startBot(), 3000)
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Connected!')
        }
    })

    // --- GROUP ADD BLOCK LOGIC ---
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            if (anu.action == 'add') {
                let groupId = anu.id
                let newMembers = anu.participants
                console.log(`New members in ${groupId}:`, newMembers)

                for (let member of newMembers) {
                    // bot wama add unoth remove karanna epa
                    if (member === sock.user.id.split(':')[0] + '@s.whatsapp.net') continue

                    await new Promise(r => setTimeout(r, 2000))
                    await sock.groupParticipantsUpdate(groupId, [member], "remove")
                    console.log(`✅ Removed ${member} from ${groupId}`)
                }
            }
        } catch (e) { 
            console.log('Remove error:', e.message) 
        }
    })
}

startBot()
