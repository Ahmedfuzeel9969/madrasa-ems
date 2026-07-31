const { chromium } = require('playwright');
var scales = (process.env.EMS_IDB_BENCH_SCALES || '10000').split(',').map(Number);

(async function () {
    var browser = await chromium.launch();
    var page = await browser.newPage();
    page.on('pageerror', function (e) { console.error('PAGEERROR', e.message); });
    await page.goto('http://127.0.0.1:4174/bench/idb-scale-bench.html');
    await page.waitForFunction(function () { return window.emsRepo && window.runIdbScaleBench; }, null, { timeout: 120000 });
    var report = await page.evaluate(function (sc) {
        return window.runIdbScaleBench({ scales: sc });
    }, scales);
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
