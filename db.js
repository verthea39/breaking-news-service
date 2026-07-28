const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'news.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        db.configure("busyTimeout", 3000);
        
        db.run(`CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id TEXT UNIQUE,
            name TEXT,
            brand TEXT DEFAULT 'mattannur'
        )`, () => {
            db.run(`ALTER TABLE groups ADD COLUMN brand TEXT DEFAULT 'mattannur'`, () => {});
        });

        db.run(`CREATE TABLE IF NOT EXISTS news_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            url TEXT UNIQUE,
            sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`, () => {
            const PERFECT_LAYOUT = {
                '.eng-day-year': { left: '140px', top: '930px', fontSize: '45px', fontWeight: '800', color: '#000000' },
                '#previewEngMonth': { left: '170px', top: '1025px', fontSize: '35px', fontWeight: '700', color: '#ffffff' },
                '#previewEngDate': { left: '170px', top: '1125px', fontSize: '130px', fontWeight: '700', color: '#000000' },
                '.mal-day-year': { left: '580px', top: '930px', fontSize: '45px', fontWeight: '800', color: '#000000' },
                '#previewMalMonth': { left: '610px', top: '1025px', fontSize: '35px', fontWeight: '700', color: '#ffffff' },
                '#previewMalDate': { left: '610px', top: '1125px', fontSize: '130px', fontWeight: '700', color: '#000000' },
                '#previewHijriYear': { left: '350px', top: '1390px', fontSize: '35px', fontWeight: '700', color: '#000000' },
                '#previewHijriMonth': { left: '380px', top: '1475px', fontSize: '30px', fontWeight: '800', color: '#ffffff' },
                '#previewHijriDate': { left: '380px', top: '1565px', fontSize: '130px', fontWeight: '700', color: '#000000' }
            };

            const defaults = {
                check_interval: '30',
                send_images: 'true',
                active_sources: JSON.stringify(['reporterlive']),
                daily_poster_layout: JSON.stringify(PERFECT_LAYOUT)
            };
            
            Object.keys(defaults).forEach(key => {
                db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, defaults[key]]);
            });
        });
    }
});

module.exports = db;
