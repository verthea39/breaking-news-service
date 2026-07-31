const nodeHtmlToImage = require('node-html-to-image');
const path = require('path');
const fs = require('fs');
const db = require('./db');

function getSavedLayoutFromDb() {
    return new Promise((resolve) => {
        db.get("SELECT value FROM settings WHERE key = 'daily_poster_layout'", (err, row) => {
            if (err || !row || !row.value) return resolve(null);
            try {
                const parsed = JSON.parse(row.value);
                resolve(parsed);
            } catch (e) {
                resolve(null);
            }
        });
    });
}

function formatStyleFromObject(obj) {
    if (!obj || typeof obj !== 'object') return '';
    let styleStr = '';
    for (const [key, val] of Object.entries(obj)) {
        if (val !== undefined && val !== null && val !== '') {
            const kebab = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            styleStr += `${kebab}: ${val}; `;
        }
    }
    return styleStr;
}

/**
 * Generate a Daily Calendar Poster
 * @param {Object} data 
 * @returns {Promise<Buffer>} Image Buffer
 */
async function generateDailyPoster(data) {
    let {
        englishDay, englishYear, englishMonth, englishDate,
        malayalamDay, malayalamYear, malayalamMonth, malayalamDate,
        hijriYear, hijriMonth, hijriDate,
        engDayYearStyle, engMonthStyle, engDateStyle,
        malDayYearStyle, malMonthStyle, malDateStyle,
        hijriYearStyle, hijriMonthStyle, hijriDateStyle
    } = data || {};

    // Load saved layout from DB if style parameters are missing
    const savedLayout = await getSavedLayoutFromDb();
    if (savedLayout) {
        if (!engDayYearStyle && savedLayout['.eng-day-year']) engDayYearStyle = formatStyleFromObject(savedLayout['.eng-day-year']);
        if (!engMonthStyle && savedLayout['#previewEngMonth']) engMonthStyle = formatStyleFromObject(savedLayout['#previewEngMonth']);
        if (!engDateStyle && savedLayout['#previewEngDate']) engDateStyle = formatStyleFromObject(savedLayout['#previewEngDate']);
        if (!malDayYearStyle && savedLayout['.mal-day-year']) malDayYearStyle = formatStyleFromObject(savedLayout['.mal-day-year']);
        if (!malMonthStyle && savedLayout['#previewMalMonth']) malMonthStyle = formatStyleFromObject(savedLayout['#previewMalMonth']);
        if (!malDateStyle && savedLayout['#previewMalDate']) malDateStyle = formatStyleFromObject(savedLayout['#previewMalDate']);
        if (!hijriYearStyle && savedLayout['#previewHijriYear']) hijriYearStyle = formatStyleFromObject(savedLayout['#previewHijriYear']);
        if (!hijriMonthStyle && savedLayout['#previewHijriMonth']) hijriMonthStyle = formatStyleFromObject(savedLayout['#previewHijriMonth']);
        if (!hijriDateStyle && savedLayout['#previewHijriDate']) hijriDateStyle = formatStyleFromObject(savedLayout['#previewHijriDate']);
    }

    const d = new Date();
    const engDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const engMonths = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    const malDays = ['ഞായർ', 'തിങ്കൾ', 'ചൊവ്വ', 'ബുധൻ', 'വ്യാഴം', 'വെള്ളി', 'ശനി'];

    const finalEngDay = englishDay || engDays[d.getDay()];
    const finalEngYear = englishYear || String(d.getFullYear());
    const finalEngMonth = englishMonth || engMonths[d.getMonth()];
    const finalEngDate = englishDate || String(d.getDate()).padStart(2, '0');

    const finalMalDay = malayalamDay || malDays[d.getDay()];
    const finalMalYear = malayalamYear || '1201';
    const finalMalMonth = malayalamMonth || 'കർക്കിടകം';
    const finalMalDate = malayalamDate || '08';

    const finalHijriYear = hijriYear || '1448';
    const finalHijriMonth = hijriMonth || 'Safar';
    const finalHijriDate = hijriDate || '10';

    // Load the background template from public folder
    const templatePath = path.join(__dirname, 'public', 'daily_template.jpg');
    let bgImage = '';
    
    // Check if the user has uploaded the template
    if (fs.existsSync(templatePath)) {
        const imageAsBase64 = fs.readFileSync(templatePath, 'base64');
        bgImage = `data:image/jpeg;base64,${imageAsBase64}`;
    } else {
        // Fallback to check for .png if .jpg doesn't exist
        const pngPath = path.join(__dirname, 'public', 'daily_template.png');
        if (fs.existsSync(pngPath)) {
            const imageAsBase64 = fs.readFileSync(pngPath, 'base64');
            bgImage = `data:image/png;base64,${imageAsBase64}`;
        } else {
            console.warn('Template image not found! Please place daily_template.jpg in the public folder.');
            // We use a dark background fallback just in case
            bgImage = '';
        }
    }

    const html = `
    <html>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Anek+Malayalam:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700;800;900&family=Oswald:wght@400;700&family=Roboto:wght@400;500;700;900&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
        <style>
          body {
            width: 1080px;
            height: 1920px;
            margin: 0;
            padding: 0;
            background-color: #f0f0f0;
            ${bgImage ? `background-image: url('${bgImage}'); background-size: 1080px 1920px; background-position: center; background-repeat: no-repeat;` : ''}
            font-family: 'Anek Malayalam', sans-serif;
            position: relative;
            overflow: hidden;
          }
          
          /* English Calendar Block */
          .eng-day-year {
            position: absolute; top: 937px; left: 163px; text-align: center; width: 320px; font-size: 45px; font-weight: 800; color: #000; line-height: 1.1; font-family: 'Anek Malayalam', sans-serif;
          }
          .eng-month {
            position: absolute; top: 1052px; left: 187px; text-align: center; width: 260px; height: 75px; display: flex; align-items: center; justify-content: center; font-size: 51px; font-family: 'Anek Malayalam', sans-serif; font-weight: 700; color: #fff; letter-spacing: 2px;
          }
          .eng-date {
            position: absolute; top: 1155px; left: 193px; text-align: center; width: 260px; height: 170px; display: flex; align-items: center; justify-content: center; font-size: 154px; font-family: 'Anek Malayalam', sans-serif; font-weight: 900; color: #000; line-height: 1;
          }

          /* Malayalam Calendar Block */
          .mal-day-year {
            position: absolute; top: 940px; left: 597px; text-align: center; width: 320px; font-size: 45px; font-weight: 800; color: #000; line-height: 1.1; font-family: 'Anek Malayalam', sans-serif;
          }
          .mal-month {
            position: absolute; top: 1052px; left: 637px; text-align: center; width: 260px; height: 75px; display: flex; align-items: center; justify-content: center; font-size: 35px; font-family: 'Anek Malayalam', sans-serif; font-weight: 700; color: #fff; letter-spacing: 2px;
          }
          .mal-date {
            position: absolute; top: 1162px; left: 630px; text-align: center; width: 260px; height: 170px; display: flex; align-items: center; justify-content: center; font-size: 155px; font-family: 'Anek Malayalam', sans-serif; font-weight: 900; color: #000; line-height: 1;
          }

          /* Hijri Calendar Block */
          .hijri-year {
            position: absolute; top: 1370px; left: 403px; text-align: center; width: 260px; font-size: 47px; font-family: 'Anek Malayalam', sans-serif; font-weight: 700; color: #000;
          }
          .hijri-month {
            position: absolute; top: 1465px; left: 410px; text-align: center; width: 260px; height: 75px; display: flex; align-items: center; justify-content: center; font-size: 48px; font-weight: 800; color: #fff; font-family: 'Anek Malayalam', sans-serif;
          }
          .hijri-date {
            position: absolute; top: 1568px; left: 414px; text-align: center; width: 260px; height: 170px; display: flex; align-items: center; justify-content: center; font-size: 160px; font-family: 'Anek Malayalam', sans-serif; font-weight: 900; color: #000; line-height: 1;
          }
          
        </style>
      </head>
      <body>
        
        <!-- English Block -->
        <div class="eng-day-year" style="${engDayYearStyle || ''}">
          <div>${finalEngDay}</div>
          <div>${finalEngYear}</div>
        </div>
        <div class="eng-month" style="${engMonthStyle || ''}">${finalEngMonth.toUpperCase()}</div>
        <div class="eng-date" style="${engDateStyle || ''}">${finalEngDate}</div>
        
        <!-- Malayalam Block -->
        <div class="mal-day-year" style="${malDayYearStyle || ''}">
          <div>${finalMalDay}</div>
          <div>${finalMalYear}</div>
        </div>
        <div class="mal-month" style="${malMonthStyle || ''}">${finalMalMonth}</div>
        <div class="mal-date" style="${malDateStyle || ''}">${finalMalDate}</div>
        
        <!-- Hijri Block -->
        <div class="hijri-year" style="${hijriYearStyle || ''}">${finalHijriYear}</div>
        <div class="hijri-month" style="${hijriMonthStyle || ''}">${finalHijriMonth}</div>
        <div class="hijri-date" style="${hijriDateStyle || ''}">${finalHijriDate}</div>
        
      </body>
    </html>
    `;

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

    try {
        const imageBuffer = await nodeHtmlToImage({
            html: html,
            type: 'jpeg',
            quality: 90,
            waitUntil: 'networkidle0',
            beforeScreenshot: async (page) => {
                await page.evaluate(async () => {
                    await document.fonts.ready;
                });
            },
            puppeteerArgs: {
                executablePath: executablePath || undefined,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1080,1920'],
                defaultViewport: {
                    width: 1080,
                    height: 1920,
                    deviceScaleFactor: 1
                }
            }
        });
        
        return imageBuffer;
    } catch (error) {
        console.error('Failed to generate daily poster:', error);
        throw error;
    }
}

module.exports = { generateDailyPoster };
