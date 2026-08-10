const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const dns = require('dns');

// Dynamically find a valid Chromium/Chrome/Edge executable across OS environments
function getBrowserExecutablePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    const localAppData = process.env.LOCALAPPDATA || '';
    const candidatePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : '',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome-stable'
    ].filter(Boolean);

    for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return undefined;
}

const executablePath = getBrowserExecutablePath();
if (executablePath) {
    console.log(`🌐 Using browser executable: ${executablePath}`);
} else {
    console.log('🌐 No custom browser path found, using Puppeteer default.');
}

const path = require('path');

const authDataPath = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR, '.wwebjs_auth') : undefined;

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authDataPath }),
    authTimeoutMs: 0,
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        executablePath: executablePath
    }
});

client.isClientReady = false;
client.currentStatus = 'DISCONNECTED';
client.latestQrDataUrl = null;
client.latestPairingCode = null;
let isInitializing = false;
let hasInitialized = false;

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

// Clean stale Chromium process lock files if process crashed or was closed abruptly
function cleanStaleLocks() {
    const sessionDir = authDataPath || path.resolve(__dirname, '.wwebjs_auth');
    if (!fs.existsSync(sessionDir)) return;

    try {
        const findAndRemoveLocks = (dir) => {
            const files = fs.readdirSync(dir, { withFileTypes: true });
            for (const file of files) {
                const fullPath = path.join(dir, file.name);
                if (file.isDirectory()) {
                    findAndRemoveLocks(fullPath);
                } else if (['SingletonLock', 'SingletonCookie', 'SingletonSocket'].includes(file.name)) {
                    try {
                        fs.unlinkSync(fullPath);
                        console.log(`🧹 Cleaned up stale Chromium process lock file: ${fullPath}`);
                    } catch (e) {}
                }
            }
        };
        findAndRemoveLocks(sessionDir);
    } catch (e) {}
}

let retryTimeout = null;

// Safe initialization wrapper to avoid unhandled rejections and puppeteer crashes
async function safeInitialize() {
    if (client.isClientReady) {
        client.currentStatus = 'READY';
        return;
    }
    if (isInitializing) {
        console.log('⏳ Initialization or QR authentication in progress...');
        return;
    }
    const online = await checkInternet();
    if (!online) {
        console.log('⏳ Internet is offline. Skipping WhatsApp initialization until internet is back.');
        return;
    }

    if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
    }

    isInitializing = true;
    client.currentStatus = 'INITIALIZING';
    console.log('🔄 Initializing WhatsApp client...');

    if (hasInitialized) {
        try {
            await client.destroy().catch(() => {});
        } catch (e) {
            // ignore destroy errors
        }
    }

    // Clean any orphaned lock files from prior crashes/abrupt closes
    cleanStaleLocks();

    try {
        hasInitialized = true;
        await client.initialize();
    } catch (err) {
        console.error('⚠️ WhatsApp initialization failed:', err.message || err);
        isInitializing = false;
        hasInitialized = false;
        client.currentStatus = 'DISCONNECTED';
        
        console.log('⏳ Retrying WhatsApp initialization in 10 seconds...');
        if (retryTimeout) clearTimeout(retryTimeout);
        retryTimeout = setTimeout(() => {
            retryTimeout = null;
            safeInitialize();
        }, 10000);
    }
}

client.on('qr', (qr) => {
    client.currentStatus = 'SCAN_QR';
    try {
        qrcode.generate(qr, { small: true });
    } catch (e) {
        // Ignore terminal formatting errors in non-TTY background environment
    }
    
    QRCode.toDataURL(qr, (err, url) => {
        if (!err) {
            client.latestQrDataUrl = url;
        }
    });

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
    client.currentStatus = 'READY';
    client.latestQrDataUrl = null;
    isInitializing = false;
    console.log('✅ WhatsApp Client is ready and connected!');
});

client.on('authenticated', () => {
    client.currentStatus = 'AUTHENTICATED';
    client.latestQrDataUrl = null;
    console.log('WhatsApp Authenticated successfully.');
});

client.on('auth_failure', msg => {
    client.isClientReady = false;
    client.currentStatus = 'DISCONNECTED';
    client.latestQrDataUrl = null;
    isInitializing = false;
    hasInitialized = false;
    console.error('WhatsApp Authentication failure:', msg);
});

client.on('change_state', state => {
    console.log('WhatsApp Connection State Changed:', state);
    if (state === 'DISCONNECTED' || state === 'UNPAIRED') {
        client.isClientReady = false;
        client.currentStatus = 'DISCONNECTED';
        client.latestQrDataUrl = null;
        isInitializing = false;
        hasInitialized = false;
    }
});

client.on('disconnected', (reason) => {
    client.isClientReady = false;
    client.currentStatus = 'DISCONNECTED';
    client.latestQrDataUrl = null;
    isInitializing = false;
    hasInitialized = false;
    console.warn('⚠️ WhatsApp Client was disconnected:', reason);
    console.log('⏳ Will attempt auto-reconnection as soon as internet connection is available...');
    
    setTimeout(async () => {
        const online = await checkInternet();
        if (online && !client.isClientReady && !isInitializing) {
            safeInitialize();
        }
    }, 5000);
});

async function generatePairingCode(phoneNumber) {
    if (!phoneNumber) throw new Error('Phone number is required');
    if (client.isClientReady) {
        throw new Error('WhatsApp is already connected! Click "Logout & Link Different Account" if you want to pair a new phone.');
    }
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    
    // Check if whatsapp-web.js Client prototype has native requestPairingCode
    if (typeof Client.prototype.requestPairingCode === 'function') {
        const code = await Client.prototype.requestPairingCode.call(client, cleanPhone);
        client.latestPairingCode = code;
        return code;
    }
    
    // Fallback: evaluate on Puppeteer page if available
    if (client.pupPage) {
        try {
            const code = await client.pupPage.evaluate(async (phone) => {
                if (window.WWebJS && typeof window.WWebJS.requestPairingCode === 'function') {
                    return await window.WWebJS.requestPairingCode(phone);
                }
                throw new Error('Pairing code function not available on WhatsApp Web page');
            }, cleanPhone);
            client.latestPairingCode = code;
            return code;
        } catch (err) {
            throw new Error('Failed to request pairing code on WhatsApp page: ' + err.message);
        }
    }

    throw new Error('WhatsApp scanner is not active yet. Please wait a moment and try again.');
}

async function logoutAndRestart() {
    client.isClientReady = false;
    client.currentStatus = 'DISCONNECTED';
    client.latestQrDataUrl = null;
    isInitializing = false;
    hasInitialized = false;

    try {
        await client.logout().catch(() => {});
        await client.destroy().catch(() => {});
    } catch (e) {}

    const sessionDir = authDataPath || path.resolve(__dirname, '.wwebjs_auth');
    if (fs.existsSync(sessionDir)) {
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log('🗑️ WhatsApp auth session folder deleted.');
        } catch (e) {
            console.error('Error deleting session folder:', e.message);
        }
    }

    setTimeout(() => {
        safeInitialize();
    }, 1000);
}

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
        // Auto reconnect WhatsApp if offline/disconnected and not initializing
        if (!client.isClientReady && !isInitializing) {
            console.log('🔄 Internet is active, but WhatsApp is disconnected. Attempting auto-reconnect...');
            safeInitialize();
        }
    }
}, 15000); // Check every 15 seconds

// Graceful process shutdown handler to destroy Puppeteer cleanly and release file locks
async function gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}. Shutting down WhatsApp client and cleaning up Chromium resources...`);
    try {
        if (client) {
            await client.destroy().catch(() => {});
        }
    } catch (e) {}
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

client.safeInitialize = safeInitialize;
client.checkInternet = checkInternet;
client.getBrowserExecutablePath = getBrowserExecutablePath;
client.generatePairingCode = generatePairingCode;
client.logoutAndRestart = logoutAndRestart;

module.exports = client;
