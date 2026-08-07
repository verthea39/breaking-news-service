// Process safety handlers to prevent app crash on network disconnection or socket error
process.on('uncaughtException', (err) => {
    console.error('🛡️ [Safety Guard] Uncaught Exception intercepted (process kept running):', err.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🛡️ [Safety Guard] Unhandled Promise Rejection intercepted (process kept running):', reason.message || reason);
});

const express = require('express');
const cors = require('cors');
const path = require('path');
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

// Reporter Live URL
const NEWS_URL = 'https://www.reporterlive.com/';

// Initialize WhatsApp Client safely with auto-reconnect
client.safeInitialize();

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
        if (check_interval && currentCronTask) {
            currentCronTask.stop();
            currentCronTask = cron.schedule(`*/${check_interval} * * * *`, checkNews);
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
const fs = require('fs');
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

// API: Manually trigger automatic news check now
app.post('/api/check-news', async (req, res) => {
    try {
        const result = await checkNews({ forceImmediate: true });
        res.json({ success: true, message: result.message || 'News check triggered successfully!' });
    } catch (err) {
        console.error('Error triggering checkNews manually:', err);
        res.status(500).json({ error: 'Failed to run news check.' });
    }
});

// Function to check website for breaking news automatically
async function checkNews(options = {}) {
    const { forceImmediate = false } = options;
    return new Promise(async (resolve) => {
        const isOnline = await client.checkInternet();
        if (!isOnline) {
            console.log('🌐 [News Check] Internet is offline. Skipping check until internet connection is restored.');
            return resolve({ success: false, message: 'Internet connection is offline.' });
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

            console.log('Checking for new breaking news from ReporterLive...');
            if (!client.isClientReady) {
                console.log('WhatsApp client is not ready yet. Skipping news broadcast until connected.');
                return resolve({ success: false, message: 'WhatsApp client is not ready yet.' });
            }

            try {
                const response = await axios.get(NEWS_URL);
                const $ = cheerio.load(response.data);

                const firstNewsBox = $('.smallNewsBox').first();
                if (firstNewsBox.length === 0) {
                    console.log('No news boxes found on ReporterLive homepage.');
                    return resolve({ success: true, message: 'No news boxes found on website.' });
                }

                const rawLink = firstNewsBox.attr('href');
                const title = firstNewsBox.find('.newsHeading p').text().trim();
                if (!rawLink || !title) {
                    return resolve({ success: true, message: 'No headline found.' });
                }

                const link = rawLink.startsWith('http') ? rawLink : 'https://www.reporterlive.com' + rawLink;

                db.get('SELECT id FROM news_history WHERE url = ?', [link], async (err, row) => {
                    if (err) {
                        console.error('Database error checking history:', err);
                        return resolve({ success: false, message: 'Database error' });
                    }

                    if (row && !forceImmediate) {
                        console.log('No new breaking news (already sent):', title);
                        return resolve({ success: true, message: 'No new breaking news (already sent).' });
                    }

                    console.log('New Malayalam article found:', title);

                    try {
                        const articleRes = await axios.get(link);
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

                        db.all('SELECT group_id, name, brand FROM groups', [], async (err, groups) => {
                            if (err || !groups || groups.length === 0) {
                                console.log('No registered WhatsApp groups found.');
                                return resolve({ success: true, message: 'No registered groups to send news to.' });
                            }

                            console.log(`Sending news to ${groups.length} registered group(s)...`);
                            let sentAnyCount = 0;

                            for (let i = 0; i < groups.length; i++) {
                                const group = groups[i];
                                const msgText = (group.brand === 'parappanagadi') 
                                    ? formatParappanagadiMessage(title, description)
                                    : formatNewsMessage(title, description);

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
                                    sentAnyCount++;
                                } catch (e) {
                                    console.error(`[News Broadcast] Failed to send to group ${group.name}:`, e.message);
                                }
                            }

                            if (!row && sentAnyCount > 0) {
                                db.run('INSERT INTO news_history (title, url) VALUES (?, ?)', [title, link]);
                            }
                            resolve({ success: true, message: `News found: "${title}". Broadcast queued for ${groups.length} group(s).` });
                        });
                    } catch (e) {
                        console.error('Error fetching article detail or broadcasting:', e);
                        resolve({ success: false, message: 'Error processing news article.' });
                    }
                });
            } catch (err) {
                console.error('Error scraping website:', err.message);
                resolve({ success: false, message: 'Error fetching website: ' + err.message });
            }
        });
    });
}

// Initial cron setup based on DB
let currentCronTask = null;
db.get('SELECT value FROM settings WHERE key = "check_interval"', (err, row) => {
    const interval = row ? row.value : '30';
    currentCronTask = cron.schedule(`*/${interval} * * * *`, checkNews);
});

// Run check when WhatsApp becomes ready
client.on('ready', () => {
    console.log('Running breaking news check now that WhatsApp is ready...');
    checkNews().catch(() => {});
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Admin Dashboard: http://localhost:${PORT}/admin.html`);
});

module.exports = app;

