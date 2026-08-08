// Process safety handlers to prevent app crash on network disconnection or socket error
process.on('uncaughtException', (err) => {
    console.error('🛡️ [Safety Guard] Uncaught Exception intercepted (process kept running):', err.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🛡️ [Safety Guard] Unhandled Promise Rejection intercepted (process kept running):', (reason && reason.message) || reason);
});

const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    try { fs.mkdirSync(logsDir, { recursive: true }); } catch (e) {}
}

// Log file for service logging
const logFile = path.join(logsDir, 'service.log');

console.log = function (...args) {
    const msg = `[${new Date().toISOString()}] ` + args.join(' ') + '\n';
    try { fs.appendFileSync(logFile, msg); } catch (e) {}
    if (process.stdout && process.stdout.write) {
        try { process.stdout.write(msg); } catch (e) {}
    }
};

console.error = function (...args) {
    const msg = `[${new Date().toISOString()}] ERROR: ` + args.join(' ') + '\n';
    try { fs.appendFileSync(logFile, msg); } catch (e) {}
    if (process.stderr && process.stderr.write) {
        try { process.stderr.write(msg); } catch (e) {}
    }
};

// Ignore stdout/stderr pipe errors when running in non-TTY background mode
if (process.stdout && process.stdout.on) {
    process.stdout.on('error', (err) => { if (err.code === 'EPIPE' || err.code === 'EBADF') return; });
}
if (process.stderr && process.stderr.on) {
    process.stderr.on('error', (err) => { if (err.code === 'EPIPE' || err.code === 'EBADF') return; });
}

console.log('🚀 Breaking News Service initialized.');

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('./db');
const client = require('./whatsapp');
const { MessageMedia } = require('whatsapp-web.js');
const { generateDailyPoster } = require('./dailyPoster');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/qr', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'qr.html'));
});

// Reporter Live URL
const NEWS_URL = 'https://www.reporterlive.com/';

// Initialize WhatsApp Client safely with auto-reconnect
client.safeInitialize();

// API: Get WhatsApp Connection Status
app.get('/api/whatsapp/status', (req, res) => {
    res.json({
        ready: client.isClientReady || false,
        status: client.currentStatus || (client.isClientReady ? 'READY' : 'DISCONNECTED'),
        qrDataUrl: client.latestQrDataUrl || null,
        pairingCode: client.latestPairingCode || null
    });
});

// API: Request Pairing Code (Alternative to QR Code)
app.post('/api/whatsapp/pair', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required (e.g. 919876543210)' });
    try {
        const code = await client.generatePairingCode(phoneNumber);
        res.json({ success: true, code: code });
    } catch (err) {
        console.error('Error requesting pairing code:', err.message);
        res.status(500).json({ error: err.message || 'Failed to request pairing code. Make sure client is in QR scan mode.' });
    }
});

// API: Logout & Relink WhatsApp (Reset session to get new QR or pairing code)
app.post('/api/whatsapp/logout', async (req, res) => {
    try {
        await client.logoutAndRestart();
        res.json({ success: true, message: 'WhatsApp session cleared. Resetting connection scanner...' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reset session: ' + err.message });
    }
});

// API: Get registered groups from database
app.get('/api/groups', (req, res) => {
    db.all('SELECT * FROM groups', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: 'Failed to fetch registered groups' });
        } else {
            res.json(rows.map(r => ({ id: r.group_id, name: r.name, brand: r.brand || 'mattannur' })));
        }
    });
});

// API: Update group brand
app.post('/api/groups/:id/brand', (req, res) => {
    const { brand } = req.body;
    const { id } = req.params;
    if (!brand) return res.status(400).json({ error: 'Brand is required' });

    db.run('UPDATE groups SET brand = ? WHERE group_id = ?', [brand, id], function(err) {
        if (err) {
            res.status(500).json({ error: 'Failed to update brand' });
        } else {
            res.json({ success: true, message: 'Brand updated successfully' });
        }
    });
});

// API: Rename group
app.post('/api/groups/:id/rename', (req, res) => {
    const { name } = req.body;
    const { id } = req.params;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    db.run('UPDATE groups SET name = ? WHERE group_id = ?', [name, id], function(err) {
        if (err) {
            res.status(500).json({ error: 'Failed to rename group' });
        } else {
            res.json({ success: true, message: 'Group renamed successfully' });
        }
    });
});

// API: Get recent messages for a group
app.get('/api/groups/:id/messages', async (req, res) => {
    try {
        const { id } = req.params;
        const chats = await client.getChats();
        const chat = chats.find(c => c.id._serialized === id);
        if (!chat) {
            return res.status(404).json({ error: 'Chat not found on WhatsApp' });
        }
        const messages = await chat.fetchMessages({ limit: 30 });
        
        const formatted = messages.map(m => {
            return {
                id: m.id._serialized,
                body: m.body,
                fromMe: m.fromMe,
                author: (m._data && m._data.notifyName) ? m._data.notifyName : (m.author || m.from),
                timestamp: m.timestamp,
                hasMedia: m.hasMedia,
                type: m.type
            };
        });
        res.json(formatted);
    } catch (e) {
        console.error('Error fetching messages:', e);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// API: Get settings
app.get('/api/settings', (req, res) => {
    db.all('SELECT * FROM settings', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: 'Failed to fetch settings' });
        } else {
            const settings = {};
            rows.forEach(r => settings[r.key] = r.value);
            res.json(settings);
        }
    });
});

// API: Save settings
app.post('/api/settings', async (req, res) => {
    const { check_interval, send_images, active_sources, daily_poster_layout } = req.body;

    try {
        const runAsync = (sql, params) => new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });

        if (check_interval) await runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES ("check_interval", ?)', [check_interval]);
        if (send_images !== undefined) await runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES ("send_images", ?)', [send_images.toString()]);
        if (active_sources) await runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES ("active_sources", ?)', [typeof active_sources === 'string' ? active_sources : JSON.stringify(active_sources)]);
        if (daily_poster_layout) await runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES ("daily_poster_layout", ?)', [typeof daily_poster_layout === 'string' ? daily_poster_layout : JSON.stringify(daily_poster_layout)]);

        // Reschedule cron if interval changed
        if (check_interval) {
            scheduleNewsCheck(check_interval);
        }

        res.json({ success: true, message: 'Settings saved successfully!' });
    } catch (e) {
        console.error('Error saving settings:', e);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Helper for Malayalam Date
function getMalayalamDate() {
    const days = ['ഞായർ', 'തിങ്കൾ', 'ചൊവ്വ', 'ബുധൻ', 'വ്യാഴം', 'വെള്ളി', 'ശനി'];
    const months = ['ജനുവരി', 'ഫെബ്രുവരി', 'മാർച്ച്', 'ഏപ്രിൽ', 'മെയ്', 'ജൂൺ', 'ജൂലൈ', 'ഓഗസ്റ്റ്', 'സെപ്റ്റംബർ', 'ഒക്ടോബർ', 'നവംബർ', 'ഡിസംബർ'];
    const d = new Date();
    return `(${d.getFullYear()}. ${months[d.getMonth()]} ${d.getDate()}(${days[d.getDay()]} )`;
}

// Helper to extract detailed news paragraphs belonging strictly to the main article
function extractDetailedNews($a) {
    const paragraphs = [];
    const articleSelectors = [
        '.newsInDetail p',
        '.newsInDetail .wrapper p',
        '.newsContentSection p',
        '.storyContent p',
        '.articleBody p',
        '.news-details p',
        'article p'
    ];

    let $nodes = $a(articleSelectors.join(', '));
    if ($nodes.length === 0) {
        $nodes = $a('p');
    }

    $nodes.each((i, el) => {
        const text = $a(el).text().trim();
        if (text.length > 25 && 
            !text.includes('Copyright') && 
            !text.includes('Reporter') && 
            !text.startsWith('Content Highlights') &&
            !text.includes('ഇൻസ്റ്റഗ്രാം') &&
            !text.toLowerCase().startsWith('http')) {
            paragraphs.push(text);
        }
    });

    if (paragraphs.length > 0) {
        return paragraphs.join('\n\n');
    }

    return $a('meta[property="og:description"]').attr('content') || $a('p').first().text();
}

// Helper for Formatting Message
function formatNewsMessage(title, description) {
    return `*${title}*
⊷⊷⊷⊶⊷⊷⊶⊷❍❍⊶⊷⊶⊷⊷  
📰 *MATTANNUR VISION ONLINE  NEWS PORTAL*   
${getMalayalamDate()}
https://chat.whatsapp.com/FvyImvTeZmD1esEJp5W57z?mode=wwt
⊷⊶⊷⊷⊶⊷❍❍⊶⊷⊶⊷⊷⊶⊷❍❍⊶⊷⊶⊷⊷⊶

${description}

➖➖➖➖➖➖➖➖➖
🛑മട്ടന്നൂർ,ഇരിട്ടി,കൂത്തുപറമ്പ്, തളിപ്പറമ്പ്, തലശ്ശേരി, കണ്ണൂർ പ്രാദേശിക വാർത്തകൾക്കായുള്ള ഗ്രൂപ്പ് . അതിനാൽ ഗ്രൂപ്പ് ലിങ്ക് ഷെയർ ചെയ്യുക 
https://chat.whatsapp.com/FvyImvTeZmD1esEJp5W57z?mode=wwt
➖➖➖➖➖➖➖
■□■□■□■□■□■□■□■□■
🌐 *Mattannur Vision* 📡`;
}

function formatParappanagadiMessage(title, description) {
    return `*${title}*
⊷⊷⊷⊶⊷⊷⊶⊷❍❍⊶⊷⊶⊷⊷  
📰 * PARAPPANAGADI TIMES ONLINE  NEWS PORTAL*   
${getMalayalamDate()}
https://chat.whatsapp.com/BZVFTVBuRg5JGF9FIz1key
⊷⊶⊷⊷⊶⊷❍❍⊶⊷⊶⊷⊷⊶⊷❍❍⊶⊷⊶⊷⊷⊶

${description}
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
_✅പക്ഷാഭേദ മില്ലാതെ പ്രാദേശിക വാർത്തകൾ തത്സമയം അറിയാൻ. ഗ്രുപ്പിൽ ജോയിൻ ചെയ്യുക.._
 https://chat.whatsapp.com/BZVFTVBuRg5JGF9FIz1key
➖➖➖➖➖➖➖
_  നിങ്ങള്ക്കും ഗ്രൂപ്പിലൂടെ വാര്ത്തകളും വിശേഷങ്ങളും പരസ്യങ്ങളും പങ്കുവെക്കാം.._

📲 *_ബന്ധപ്പെടുക_*  👇🏻
🪀https://wa.me/+918129002191
   
■□■□■□■□■□■□■□■□■
    🌐 *പരപ്പനങ്ങാടി ടൈംസ്* 📡
➖➖➖➖➖➖➖➖➖`;
}

// Helper to send latest news to a specific group
async function sendLatestNewsToGroup(groupId, brand, originalMsg) {
    try {
        const isOnline = await client.checkInternet();
        if (!isOnline) {
            originalMsg.reply('⚠️ Internet connection is currently offline. Will try again once internet returns.').catch(() => {});
            return;
        }
        originalMsg.reply('🔄 Fetching the latest news for this newly registered group, please wait...').catch(() => {});
        const response = await axios.get(NEWS_URL);
        const $ = cheerio.load(response.data);
        const firstNewsBox = $('.smallNewsBox').first();

        if (firstNewsBox.length > 0) {
            const link = firstNewsBox.attr('href');
            const title = firstNewsBox.find('.newsHeading p').text().trim();
            
            const articleRes = await axios.get(link);
            const $a = cheerio.load(articleRes.data);
            const imageUrl = $a('meta[property="og:image"]').attr('content');
            const description = extractDetailedNews($a);

            let media = null;
            if (imageUrl) {
                try {
                    media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                } catch (imgErr) {
                    console.warn('Could not load article image:', imgErr.message);
                }
            }
            
            const msgText = brand === 'parappanagadi' 
                ? formatParappanagadiMessage(title, description) 
                : formatNewsMessage(title, description);

            if (media) {
                await client.sendMessage(groupId, media, { caption: msgText });
            } else {
                await client.sendMessage(groupId, msgText);
            }
        } else {
            originalMsg.reply('⚠️ Could not find any news right now.').catch(() => {});
        }
    } catch (err) {
        console.error('Error fetching latest news on register:', err.message);
        originalMsg.reply('❌ Failed to fetch news.').catch(() => {});
    }
}

// WhatsApp Message Listener for Group Registration
client.on('message_create', async msg => {
    try {
        const msgParts = (msg.body || '').trim().split(' ');
        const command = msgParts[0].toLowerCase();

        if (command === '!register' || command === '!unregister') {
            // Group IDs in WhatsApp end with '@g.us'.
            const targetId = msg.to.endsWith('@g.us') ? msg.to : (msg.from.endsWith('@g.us') ? msg.from : null);

            if (targetId) {
                if (command === '!register') {
                    const brand = msgParts[1]?.toLowerCase() === 'parappanagadi' ? 'parappanagadi' : 'mattannur';
                    db.get('SELECT id FROM groups WHERE group_id = ?', [targetId], (err, row) => {
                        if (!row) {
                            db.run('INSERT INTO groups (group_id, name, brand) VALUES (?, ?, ?)', [targetId, 'Registered Group (' + targetId.split('@')[0].slice(-4) + ')', brand], () => {
                                msg.reply(`✅ This group has been registered for breaking news alerts (${brand === 'parappanagadi' ? 'Parappanagadi Times' : 'Mattannur Vision'})!`).catch(() => {});
                                sendLatestNewsToGroup(targetId, brand, msg);
                            });
                        } else {
                            msg.reply('⚠️ This group is already registered.').catch(() => {});
                        }
                    });
                } else if (command === '!unregister') {
                    db.run('DELETE FROM groups WHERE group_id = ?', [targetId], () => {
                        msg.reply('❌ This group has been removed from breaking news alerts.').catch(() => {});
                    });
                }
            } else {
                msg.reply('This command only works in groups.').catch(() => {});
            }
        } else if (msg.body === '!help') {
            const helpText = `🤖 *News Bot Commands*\n\n` +
                `*!register* - Enable breaking news for this group (Mattannur Vision).\n` +
                `*!register parappanagadi* - Enable breaking news (Parappanagadi Times).\n` +
                `*!unregister* - Disable breaking news for this group.\n` +
                `*!news* - Fetch latest news (Mattannur Vision).\n` +
                `*!newsparappanagadi* - Fetch latest news (Parappanagadi Times).\n` +
                `*!status* - Check if the bot is online.`;
            msg.reply(helpText).catch(() => {});
        } else if (msg.body === '!status') {
            msg.reply('✅ *Bot Status: ONLINE*\nMonitoring ReporterLive for breaking news every 30 minutes.').catch(() => {});
        } else if (msg.body === '!news') {
            try {
                const isOnline = await client.checkInternet();
                if (!isOnline) {
                    return msg.reply('⚠️ Internet connection is currently offline. Please try again later.').catch(() => {});
                }
                msg.reply('🔄 Fetching the latest news, please wait...').catch(() => {});
                const response = await axios.get(NEWS_URL);
                const $ = cheerio.load(response.data);
                const firstNewsBox = $('.smallNewsBox').first();

                if (firstNewsBox.length > 0) {
                    const link = firstNewsBox.attr('href');
                    const title = firstNewsBox.find('.newsHeading p').text().trim();

                    const articleRes = await axios.get(link);
                    const $a = cheerio.load(articleRes.data);
                    const imageUrl = $a('meta[property="og:image"]').attr('content');
                    const description = extractDetailedNews($a);

                    let media = null;
                    if (imageUrl) {
                        try {
                            media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                        } catch (imgErr) {
                            console.warn('Could not load article image:', imgErr.message);
                        }
                    }
                    const msgText = formatNewsMessage(title, description);

                    if (media) {
                        await msg.reply(media, undefined, { caption: msgText });
                    } else {
                        await msg.reply(msgText);
                    }
                } else {
                    msg.reply('⚠️ Could not find any news right now.').catch(() => {});
                }
            } catch (err) {
                console.error('Error fetching !news:', err.message);
                msg.reply('❌ Failed to fetch news.').catch(() => {});
            }
        } else if (msg.body === '!newsparappanagadi') {
            try {
                const isOnline = await client.checkInternet();
                if (!isOnline) {
                    return msg.reply('⚠️ Internet connection is currently offline. Please try again later.').catch(() => {});
                }
                msg.reply('🔄 Fetching the latest news, please wait...').catch(() => {});
                const response = await axios.get(NEWS_URL);
                const $ = cheerio.load(response.data);
                const firstNewsBox = $('.smallNewsBox').first();

                if (firstNewsBox.length > 0) {
                    const link = firstNewsBox.attr('href');
                    const title = firstNewsBox.find('.newsHeading p').text().trim();

                    const articleRes = await axios.get(link);
                    const $a = cheerio.load(articleRes.data);
                    const imageUrl = $a('meta[property="og:image"]').attr('content');
                    const description = extractDetailedNews($a);

                    let media = null;
                    if (imageUrl) {
                        try {
                            media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                        } catch (imgErr) {
                            console.warn('Could not load article image:', imgErr.message);
                        }
                    }
                    const msgText = formatParappanagadiMessage(title, description);

                    if (media) {
                        await msg.reply(media, undefined, { caption: msgText });
                    } else {
                        await msg.reply(msgText);
                    }
                } else {
                    msg.reply('⚠️ Could not find any news right now.').catch(() => {});
                }
            } catch (err) {
                console.error('Error fetching !newsparappanagadi:', err.message);
                msg.reply('❌ Failed to fetch news.').catch(() => {});
            }
        }
    } catch (handlerErr) {
        console.error('Error handling WhatsApp event:', handlerErr.message || handlerErr);
    }
});

// API: Manually trigger a breaking news alert
app.post('/api/send-alert', async (req, res) => {
    const { message, groupId } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Message is required.' });
    }

    try {
        let sentCount = 0;
        if (groupId && groupId !== 'all') {
            await client.sendMessage(groupId, `🚨 *BREAKING NEWS* 🚨\n\n${message}`);
            sentCount = 1;
        } else {
            // Send to all registered groups in DB
            const groups = await new Promise((resolve, reject) => {
                db.all('SELECT group_id FROM groups', [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            for (const group of groups) {
                await client.sendMessage(group.group_id, `🚨 *BREAKING NEWS* 🚨\n\n${message}`);
                sentCount++;
            }
        }
        res.json({ success: true, message: `Alert sent successfully to ${sentCount} group(s)` });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: 'Failed to send alert' });
    }
});

// API: Generate daily poster preview
app.post('/api/preview-daily', async (req, res) => {
    const { groupId, ...dateData } = req.body;
    try {
        const imageBuffer = await generateDailyPoster(dateData);
        const base64 = imageBuffer.toString('base64');
        res.json({ success: true, image: `data:image/jpeg;base64,${base64}` });
    } catch (err) {
        console.error('Error generating daily poster preview:', err);
        res.status(500).json({ error: 'Failed to generate poster preview' });
    }
});

// API: Generate and send daily poster
app.post('/api/send-daily', async (req, res) => {
    const { groupId, ...dateData } = req.body;
    try {
        const imageBuffer = await generateDailyPoster(dateData);
        const media = new MessageMedia('image/jpeg', imageBuffer.toString('base64'), 'daily_poster.jpg');
        
        let sentCount = 0;
        if (groupId && groupId !== 'all') {
            await client.sendMessage(groupId, media);
            sentCount = 1;
        } else {
            const groups = await new Promise((resolve, reject) => {
                db.all('SELECT group_id FROM groups', [], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
            for (const group of groups) {
                await client.sendMessage(group.group_id, media);
                sentCount++;
            }
        }
        
        res.json({ success: true, message: `Daily poster sent successfully to ${sentCount} group(s)` });
    } catch (err) {
        console.error('Error sending daily poster:', err);
        res.status(500).json({ error: 'Failed to generate or send daily poster' });
    }
});

// API: Upload Daily Template
app.post('/api/upload-daily-template', (req, res) => {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
        return res.status(400).json({ error: 'No image provided.' });
    }
    
    try {
        // Strip the data:image/jpeg;base64, prefix
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const templatePath = path.join(__dirname, 'public', 'daily_template.jpg');
        
        fs.writeFileSync(templatePath, base64Data, 'base64');
        res.json({ success: true, message: 'Template saved successfully!' });
    } catch (err) {
        console.error('Error saving template:', err);
        res.status(500).json({ error: 'Failed to save template.' });
    }
});

// API: Health check / keep-alive ping endpoint
app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), ready: client.isClientReady || false });
});

// API: Trigger news check (supports both GET for external cron services & POST for admin panel)
const triggerNewsCheckHandler = async (req, res) => {
    try {
        const result = await checkNews({ forceImmediate: true });
        res.json({ success: true, message: result.message || 'News check triggered successfully!' });
    } catch (err) {
        console.error('Error triggering checkNews:', err);
        res.status(500).json({ error: 'Failed to run news check.' });
    }
};

app.get('/api/cron', triggerNewsCheckHandler);
app.get('/api/check-news', triggerNewsCheckHandler);
app.post('/api/check-news', triggerNewsCheckHandler);

// Keep-alive self-ping loop for cloud platforms (Render, Railway, Heroku)
const serverUrl = process.env.SERVER_URL || process.env.RENDER_EXTERNAL_URL;
if (serverUrl) {
    console.log(`🌐 Server URL configured (${serverUrl}). Enabling 10-minute keep-alive self-ping loop.`);
    setInterval(() => {
        axios.get(`${serverUrl.replace(/\/$/, '')}/api/ping`).catch(() => {});
    }, 10 * 60 * 1000);
}

// Function to check website for breaking news automatically
async function checkNews(options = {}) {
    const { forceImmediate = false } = options;
    return new Promise(async (resolve) => {
        const isOnline = await client.checkInternet();
        if (!isOnline) {
            console.log('🌐 [News Check] Internet is offline. Skipping check until internet connection is restored.');
            return resolve({ success: false, message: 'Internet connection is offline.' });
        }

        // Check active hours (6 AM to 10 PM) unless forceImmediate is requested
        const currentHour = new Date().getHours();
        if ((currentHour < 6 || currentHour >= 22) && !forceImmediate) {
            console.log(`🌙 [News Check] Outside active broadcasting window (6:00 AM - 10:00 PM). Current hour: ${currentHour}:00. Skipping automated news check.`);
            return resolve({ success: true, message: 'Outside active news broadcasting hours (6:00 AM to 10:00 PM).' });
        }

        db.all('SELECT * FROM settings', [], async (err, rows) => {
            if (err) {
                console.error('Error fetching settings:', err);
                return resolve({ success: false, message: 'Failed to fetch settings' });
            }

            const settings = {};
            rows.forEach(r => settings[r.key] = r.value);

            let activeSources = [];
            try { activeSources = JSON.parse(settings.active_sources); } catch (e) { }

            if (!activeSources.includes('reporterlive')) {
                console.log('ReporterLive is not in active_sources setting.');
                return resolve({ success: true, message: 'ReporterLive source is currently disabled in settings.' });
            }

            console.log('🔍 Checking for new breaking news from ReporterLive...');
            if (!client.isClientReady) {
                console.log('⚠️ WhatsApp client is not ready yet. Skipping news broadcast until connected.');
                return resolve({ success: false, message: 'WhatsApp client is not ready yet.' });
            }

            try {
                const response = await axios.get(NEWS_URL, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    },
                    timeout: 10000
                });
                const $ = cheerio.load(response.data);

                const newsBoxes = $('.smallNewsBox');
                if (newsBoxes.length === 0) {
                    console.log('No news boxes found on ReporterLive homepage.');
                    return resolve({ success: true, message: 'No news boxes found on website.' });
                }

                // Extract top 10 articles
                const articles = [];
                newsBoxes.slice(0, 10).each((i, el) => {
                    const rawLink = $(el).attr('href');
                    const title = $(el).find('.newsHeading p, .newsHeading, h2, h3, p').first().text().trim();
                    if (rawLink && title) {
                        const link = rawLink.startsWith('http') ? rawLink : 'https://www.reporterlive.com' + rawLink;
                        articles.push({ title, link });
                    }
                });

                if (articles.length === 0) {
                    return resolve({ success: true, message: 'No valid headlines extracted.' });
                }

                // Get DB groups
                const groups = await new Promise((resG) => {
                    db.all('SELECT group_id, name, brand FROM groups', [], (errG, rowsG) => {
                        resG(errG ? [] : rowsG);
                    });
                });

                if (groups.length === 0) {
                    console.log('⚠️ No registered WhatsApp groups found.');
                    return resolve({ success: true, message: 'No registered WhatsApp groups to send news to.' });
                }

                // Query history for all extracted links
                const placeholders = articles.map(() => '?').join(',');
                const historyRows = await new Promise((resH) => {
                    db.all(`SELECT url FROM news_history WHERE url IN (${placeholders})`, articles.map(a => a.link), (errH, rowsH) => {
                        resH(errH ? [] : rowsH);
                    });
                });
                const sentUrls = new Set(historyRows.map(r => r.url));

                // Process unsent articles (oldest unsent first so news is sent in order)
                let unsentArticles = articles.filter(a => !sentUrls.has(a.link)).reverse();

                if (unsentArticles.length === 0 && forceImmediate) {
                    // If forced and all articles were sent, send the latest article as forced test
                    unsentArticles = [articles[0]];
                }

                if (unsentArticles.length === 0) {
                    console.log('✅ All recent breaking news articles have already been sent.');
                    return resolve({ success: true, message: 'No new breaking news (all recent articles already sent).' });
                }

                console.log(`📢 Found ${unsentArticles.length} new article(s) to broadcast!`);
                let broadcastCount = 0;

                for (const article of unsentArticles) {
                    try {
                        console.log(`📰 Fetching details for: "${article.title}"...`);
                        const articleRes = await axios.get(article.link, { timeout: 10000 });
                        const $a = cheerio.load(articleRes.data);
                        const imageUrl = $a('meta[property="og:image"]').attr('content');
                        const description = extractDetailedNews($a);

                        let media = null;
                        if (imageUrl && settings.send_images === 'true') {
                            try {
                                media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                            } catch (imgErr) {
                                console.warn('Could not load article image for WhatsApp, sending text only:', imgErr.message);
                            }
                        }

                        for (let i = 0; i < groups.length; i++) {
                            const group = groups[i];
                            const msgText = (group.brand === 'parappanagadi') 
                                ? formatParappanagadiMessage(article.title, description)
                                : formatNewsMessage(article.title, description);

                            if (i > 0) {
                                const delayMs = forceImmediate ? 500 : (2000 + Math.floor(Math.random() * 1500));
                                await new Promise(r => setTimeout(r, delayMs));
                            }

                            try {
                                if (media) {
                                    await client.sendMessage(group.group_id, media, { caption: msgText });
                                } else {
                                    await client.sendMessage(group.group_id, msgText);
                                }
                                console.log(`[News Broadcast] Successfully sent news to ${group.name}.`);
                            } catch (e) {
                                console.error(`[News Broadcast] Failed to send to group ${group.name}:`, e.message);
                            }
                        }

                        if (!sentUrls.has(article.link)) {
                            db.run('INSERT INTO news_history (title, url) VALUES (?, ?)', [article.title, article.link]);
                        }
                        broadcastCount++;
                    } catch (artErr) {
                        console.error(`Error processing article "${article.title}":`, artErr.message);
                    }
                }

                resolve({ success: true, message: `Successfully broadcast ${broadcastCount} new article(s) to ${groups.length} group(s).` });
            } catch (err) {
                console.error('Error scraping website:', err.message);
                resolve({ success: false, message: 'Error fetching website: ' + err.message });
            }
        });
    });
}

// Initial cron setup based on DB
let currentCronTask = null;
function scheduleNewsCheck(intervalMinutes = '30') {
    if (currentCronTask) {
        try { currentCronTask.stop(); } catch (e) {}
    }
    const cleanInterval = parseInt(intervalMinutes, 10) || 30;
    const cronExpr = `*/${cleanInterval} * * * *`;
    console.log(`⏰ Scheduling news check automation every ${cleanInterval} minute(s) (Cron: ${cronExpr})`);
    currentCronTask = cron.schedule(cronExpr, () => {
        console.log('⏰ [Cron Trigger] Running automated news check...');
        checkNews().catch(err => console.error('Cron checkNews error:', err));
    });
}

db.get('SELECT value FROM settings WHERE key = "check_interval"', (err, row) => {
    const interval = row ? row.value : '30';
    scheduleNewsCheck(interval);
});

// Run initial news check 5 seconds after WhatsApp becomes ready (enabling immediate automation after restart/reconnect)
let initialCheckTimeout = null;
client.on('ready', () => {
    console.log('✅ WhatsApp Client is ready! Initializing automated news check in 5 seconds...');
    if (initialCheckTimeout) clearTimeout(initialCheckTimeout);
    initialCheckTimeout = setTimeout(() => {
        console.log('⏰ WhatsApp connection stabilized. Executing news check automation...');
        checkNews().catch(err => console.error('Initial news check error:', err));
    }, 5000);
});

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Admin Dashboard: http://localhost:${PORT}/admin.html`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use by another process.`);
        console.error(`Please run stop-background.bat or free port ${PORT} before starting.`);
        process.exit(1);
    } else {
        console.error('❌ Server error:', err);
    }
});

module.exports = app;

