const puppeteer = require('puppeteer');
(async () => {
  try {
    const browser = await puppeteer.launch({
      executablePath: '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('CHROMIUM LAUNCH SUCCESSFUL: ' + await browser.version());
    await browser.close();
  } catch(e) {
    console.error('CHROMIUM ERROR: ' + e.message);
  }
})();
