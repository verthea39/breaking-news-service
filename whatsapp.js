const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const dns = require('dns');

// Try to find a browser installation across OS environments
let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '';
if (!executablePath) {
    const candidatePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome-stable'
    ];
    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            executablePath = p;
            break;
        }
    }
}

const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: 0,
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: executablePath || undefined
    }
});

client.isClientReady = false;
let isInitializing = false;

// Check internet connectivity helper
function checkInternet() {
    return new Promise((resolve) => {
        dns.lookup('google.com', (err) => {
            if (err && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN')) {
                resolve(false);
            } else {
                resolve(!err);
            }
        });
    });
}

// Safe initialization wrapper to avoid unhandled rejections and puppeteer crashes
async function safeInitialize() {
    if (isInitializing) {
        console.log('⏳ Re-initialization already in progress, skipping...');
        return;
    }
    const online = await checkInternet();
    if (!online) {
        console.log('⏳ Internet is offline. Skipping WhatsApp initialization until internet is back.');
        return;
    }

    isInitializing = true;
    client.isClientReady = false;
    console.log('🔄 Initializing WhatsApp client...');

    try {
        await client.destroy().catch(() => {});
    } catch (e) {
        // ignore destroy errors
    }

    try {
        await client.initialize();
    } catch (err) {
        console.error('⚠️ WhatsApp initialization failed (will retry automatically):', err.message || err);
    } finally {
        isInitializing = false;
    }
}

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    
    QRCode.toFile(__dirname + '/public/qr.png', qr, {
        color: {
            dark: '#000000',
            light: '#ffffff'
        }
    }, function (err) {
        if (err) console.error('Error saving QR image:', err.message);
        else console.log('\n\n🚨 QR Code saved to public/qr.png! 🚨\n\n');
    });
    console.log('\n\n🚨 ACTION REQUIRED 🚨: Scan the QR code above or view http://localhost:3000/qr.png to authenticate.\n\n');
});

client.on('ready', () => {
    client.isClientReady = true;
    console.log('✅ WhatsApp Client is ready and connected!');
});

client.on('authenticated', () => {
    console.log('WhatsApp Authenticated successfully.');
});

client.on('auth_failure', msg => {
    client.isClientReady = false;
    console.error('WhatsApp Authentication failure:', msg);
});

client.on('change_state', state => {
    console.log('WhatsApp Connection State Changed:', state);
    if (state === 'DISCONNECTED' || state === 'UNPAIRED') {
        client.isClientReady = false;
    }
});

client.on('disconnected', (reason) => {
    client.isClientReady = false;
    console.warn('⚠️ WhatsApp Client was disconnected:', reason);
    console.log('⏳ Will attempt auto-reconnection as soon as internet connection is available...');
    
    setTimeout(async () => {
        const online = await checkInternet();
        if (online && !client.isClientReady && !isInitializing) {
            safeInitialize();
        }
    }, 5000);
});

// Periodic Internet Monitor & Auto-Reconnect Loop
let wasOffline = false;
setInterval(async () => {
    const online = await checkInternet();
    if (!online) {
        if (!wasOffline) {
            console.warn('⚠️ Internet connection lost! Automation will continue running and auto-resume once internet returns.');
            wasOffline = true;
            client.isClientReady = false;
        }
    } else {
        if (wasOffline) {
            console.log('🌐 Internet connection restored! Resuming operations...');
            wasOffline = false;
        }
        // Auto reconnect WhatsApp if offline/disconnected
        if (!client.isClientReady && !isInitializing) {
            console.log('🔄 Internet is active, but WhatsApp is disconnected. Attempting auto-reconnect...');
            safeInitialize();
        }
    }
}, 15000); // Check every 15 seconds

client.safeInitialize = safeInitialize;
client.checkInternet = checkInternet;

module.exports = client;
