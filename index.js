const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const fs = require('fs')

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Chrome', 'Chrome', '1.0']
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if(qr) {
            console.log('--- SCAN THIS QR IN WHATSAPP ---')
            qrcode.generate(qr, {small: true})
        }

        if(connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode
            console.log('Closed, status:', statusCode)

            if(statusCode === 401) {
                console.log('Logged out, deleting auth...')
                fs.rmSync('auth_info', {recursive: true, force: true})
            }
            // restart
            if(statusCode!== 401) {
                startBot()
            } else {
                startBot()
            }
        } else if(connection === 'open') {
            console.log('✅ WhatsApp Connected!')
        }
    })

    // group add logic eka mehema thiyenna...
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            if(anu.action == 'add') {
                let groupId = anu.id
                let newMembers = anu.participants
                for(let member of newMembers) {
                    await sock.groupParticipantsUpdate(groupId, [member], "remove")
                    console.log(`Removed ${member} from ${groupId}`)
                }
            }
        } catch(e) { console.log(e) }
    })
}

startBot()
