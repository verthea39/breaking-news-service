const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');

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

client.on('qr', (qr) => {
    // Show in terminal just in case
    qrcode.generate(qr, { small: true });
    
    QRCode.toFile(__dirname + '/public/qr.png', qr, {
        color: {
            dark: '#000000',
            light: '#ffffff'
        }
    }, function (err) {
        if (err) throw err;
        console.log('\n\n🚨 QR Code saved to public/qr.png! 🚨\n\n');
    });
    console.log('\n\n🚨 ACTION REQUIRED 🚨: Scan the QR code above or view http://localhost:3000/qr.png to authenticate.\n\n');
});

client.on('ready', () => {
    console.log('✅ WhatsApp Client is ready and connected!');
});

client.on('authenticated', () => {
    console.log('WhatsApp Authenticated successfully.');
});

client.on('auth_failure', msg => {
    console.error('WhatsApp Authentication failure:', msg);
});

module.exports = client;
