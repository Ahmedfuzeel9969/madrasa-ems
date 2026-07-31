const { chromium } = require('playwright');

(async function () {
    var browser = await chromium.launch();
    var page = await browser.newPage();
    page.on('pageerror', function (err) { console.error('PAGEERROR', err.message); });
    page.on('console', function (msg) { console.log('CONSOLE', msg.text()); });
    await page.goto('http://127.0.0.1:4174/bench/idb-scale-bench.html');
    await page.waitForFunction(function () { return window.emsRepo && window.runIdbScaleBench; });
    var out = await page.evaluate(function () {
        return window.runIdbScaleBench({ scales: [1000] }).then(function (r) {
            return { ok: true, scale: r.scales[0] };
        }).catch(function (e) {
            return { ok: false, err: String(e && e.message ? e.message : e) };
        });
    });
    console.log(JSON.stringify(out, null, 2));
    await browser.close();
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
