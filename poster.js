const nodeHtmlToImage = require('node-html-to-image');
const path = require('path');
const fs = require('fs');

/**
 * Generate a dynamic news poster
 * @param {string} title News Title
 * @param {string} category News Category (e.g., KERALA)
 * @param {string} imageUrl Background image URL
 * @param {string} brandName e.g., 'MATTANNUR VISION' or 'PARAPPANAGADI TIMES'
 * @param {string} dateString e.g., '(2026. ജൂലൈ 21(ചൊവ്വ ))'
 * @returns {Promise<Buffer>} Image Buffer
 */
async function generatePoster(title, category, imageUrl, brandName, dateString) {
    // If no image, use a solid dark background
    const bgImage = imageUrl ? `url(${imageUrl})` : 'none';
    const bgColor = imageUrl ? '#111' : '#1e1e1e';

    const html = `
    <html>
      <head>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Anek+Malayalam:wght@400;600;700;800&family=Oswald:wght@600&display=swap');
          
          body {
            width: 1080px;
            height: 1080px;
            margin: 0;
            padding: 0;
            background-color: ${bgColor};
            font-family: 'Anek Malayalam', sans-serif;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
          }
          
          .image-bg {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 65%;
            background-image: ${bgImage};
            background-size: cover;
            background-position: center;
          }
          
          .image-bg::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(to bottom, rgba(17,17,17,0) 0%, rgba(17,17,17,0.4) 50%, rgba(17,17,17,1) 100%);
          }
          
          .content {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            height: 55%;
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            padding: 60px 80px;
            box-sizing: border-box;
            z-index: 10;
          }
          
          .category {
            background-color: #E63946;
            color: white;
            font-family: 'Oswald', sans-serif;
            font-size: 28px;
            padding: 8px 20px;
            display: inline-block;
            text-transform: uppercase;
            letter-spacing: 2px;
            border-radius: 4px;
            margin-bottom: 25px;
            align-self: flex-start;
            box-shadow: 0 4px 15px rgba(230, 57, 70, 0.4);
          }
          
          .title {
            color: #ffffff;
            font-size: 56px;
            font-weight: 800;
            line-height: 1.3;
            margin: 0 0 30px 0;
            text-shadow: 2px 2px 10px rgba(0,0,0,0.8);
            display: -webkit-box;
            -webkit-line-clamp: 4;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }
          
          .footer {
            border-top: 2px solid rgba(255, 255, 255, 0.1);
            padding-top: 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          
          .brand {
            color: #457B9D;
            font-family: 'Oswald', sans-serif;
            font-size: 36px;
            letter-spacing: 1px;
          }
          
          .brand span {
            color: #f1faee;
          }
          
          .date {
            color: #A8DADC;
            font-size: 28px;
            font-weight: 700;
          }
          
          /* Live indicator badge */
          .live-badge {
            position: absolute;
            top: 50px;
            right: 50px;
            background: rgba(0,0,0,0.6);
            backdrop-filter: blur(5px);
            padding: 10px 25px;
            border-radius: 30px;
            border: 1px solid rgba(255,255,255,0.2);
            display: flex;
            align-items: center;
            gap: 12px;
            z-index: 20;
          }
          
          .dot {
            width: 14px;
            height: 14px;
            background-color: #E63946;
            border-radius: 50%;
            box-shadow: 0 0 10px #E63946;
          }
          
          .live-text {
            color: white;
            font-family: 'Oswald', sans-serif;
            font-size: 22px;
            letter-spacing: 2px;
          }
        </style>
      </head>
      <body>
        <div class="image-bg"></div>
        
        <div class="live-badge">
          <div class="dot"></div>
          <div class="live-text">BREAKING NEWS</div>
        </div>
        
        <div class="content">
          <div class="category">${category || 'NEWS'}</div>
          <div class="title">${title}</div>
          
          <div class="footer">
            <div class="brand">${brandName.split(' ')[0]} <span>${brandName.split(' ').slice(1).join(' ')}</span></div>
            <div class="date">${dateString}</div>
          </div>
        </div>
      </body>
    </html>
    `;

    try {
        const imageBuffer = await nodeHtmlToImage({
            html: html,
            type: 'jpeg',
            quality: 90,
            puppeteerArgs: {
                executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });
        
        return imageBuffer;
    } catch (error) {
        console.error('Failed to generate poster:', error);
        throw error;
    }
}

module.exports = { generatePoster };
