const axios = require('axios');
const cheerio = require('cheerio');

async function testScrape() {
    try {
        const response = await axios.get('https://www.reporterlive.com/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        console.log('--- Page Title ---', $('title').text().trim());

        const boxes = $('.smallNewsBox');
        console.log('smallNewsBox count:', boxes.length);

        boxes.slice(0, 10).each((i, el) => {
            const href = $(el).attr('href');
            const title = $(el).find('.newsHeading p, .newsHeading, h2, h3, p').text().trim();
            console.log(`[${i}] ${title} -> ${href}`);
        });
    } catch (e) {
        console.error('Scrape error:', e.message);
    }
}

testScrape();
