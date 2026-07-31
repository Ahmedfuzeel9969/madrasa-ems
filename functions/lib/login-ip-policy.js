/**
 * Login IP allowlist policy (Phase 21)
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { writeSecurityLog } = require('./security-log-write');

function parseIpRanges(list) {
    if (!list) return [];
    if (Array.isArray(list)) {
        return list.map(function (r) { return String(r || '').trim(); }).filter(Boolean);
    }
    return String(list).split(/[,;\s\n]+/).map(function (r) { return r.trim(); }).filter(Boolean);
}

function ipToLong(ip) {
    const parts = String(ip || '').replace(/^::ffff:/, '').split('.').map(Number);
    if (parts.length !== 4) return null;
    for (let i = 0; i < 4; i++) {
        if (isNaN(parts[i]) || parts[i] < 0 || parts[i] > 255) return null;
    }
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function parseCidr(cidr) {
    const s = String(cidr || '').trim();
    if (!s) return null;
    if (s.indexOf('/') < 0) {
        const long = ipToLong(s);
        return long != null ? { start: long, end: long } : null;
    }
    const bits = s.split('/');
    const ip = bits[0];
    const maskBits = parseInt(bits[1], 10);
    const long = ipToLong(ip);
    if (long == null || isNaN(maskBits) || maskBits < 0 || maskBits > 32) return null;
    const maskLong = maskBits === 0 ? 0 : ((0xffffffff << (32 - maskBits)) >>> 0);
    const start = (long & maskLong) >>> 0;
    const end = (start | (~maskLong >>> 0)) >>> 0;
    return { start: start, end: end };
}

function ipMatchesAllowlist(ip, ranges) {
    const long = ipToLong(ip);
    if (long == null) return false;
    const parsed = parseIpRanges(ranges);
    for (let i = 0; i < parsed.length; i++) {
        const cidr = parseCidr(parsed[i]);
        if (cidr && long >= cidr.start && long <= cidr.end) return true;
    }
    return false;
}

function extractClientIp(rawRequest) {
    if (!rawRequest) return '';
    const headers = rawRequest.headers || {};
    const xf = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
    if (xf) return String(xf).split(',')[0].trim();
    if (rawRequest.ip) return String(rawRequest.ip).replace(/^::ffff:/, '');
    if (rawRequest.connection && rawRequest.connection.remoteAddress) {
        return String(rawRequest.connection.remoteAddress).replace(/^::ffff:/, '');
    }
    return '';
}

function parseCountries(list) {
    if (!list) return [];
    if (Array.isArray(list)) {
        return list.map(function (c) { return String(c || '').trim().toUpperCase(); }).filter(Boolean);
    }
    return String(list).split(/[,;\s\n]+/).map(function (c) { return c.trim().toUpperCase(); }).filter(Boolean);
}

function extractCountryCode(rawRequest) {
    if (!rawRequest) return '';
    const headers = rawRequest.headers || {};
    const code = headers['cf-ipcountry'] || headers['CF-IPCountry']
        || headers['x-country-code'] || headers['X-Country-Code'] || '';
    return String(code).trim().toUpperCase();
}

function countryMatchesAllowlist(code, allowed) {
    const list = parseCountries(allowed);
    if (!list.length) return true;
    const c = String(code || '').trim().toUpperCase();
    if (!c || c === 'XX' || c === 'T1') return false;
    return list.indexOf(c) >= 0;
}

async function assertOwner(db, tenantId, uid) {
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (!madrasaSnap.exists || madrasaSnap.data().ownerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'صرف مالک یہ عمل کر سکتا ہے۔');
    }
}

const validateLoginIpAddress = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const portal = String((data && data.portal) || 'teacher').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const uid = context.auth.uid;
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (madrasaSnap.exists && madrasaSnap.data().ownerUid === uid) {
        return { ok: true, allowed: true, bypass: 'owner' };
    }
    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    if (!policy.enableIpAllowlist) {
        return { ok: true, allowed: true, skipped: true };
    }
    const ranges = parseIpRanges(policy.allowedIpRanges);
    if (!ranges.length) {
        return { ok: true, allowed: true, skipped: true, reason: 'no_ranges' };
    }
    const clientIp = extractClientIp(context.rawRequest);
    if (!clientIp) {
        return { ok: true, allowed: true, skipped: true, reason: 'no_ip' };
    }
    const allowed = ipMatchesAllowlist(clientIp, ranges);
    if (!allowed) {
        await writeSecurityLog(db, tenantId, {
            action: 'login_ip_denied',
            uid: uid,
            email: context.auth.token.email || '',
            details: { portal: portal, ip: clientIp, rangesCount: ranges.length }
        });
        throw new functions.https.HttpsError('permission-denied', 'یہ IP address لاگ ان کے لیے مجاز نہیں: ' + clientIp);
    }
    return { ok: true, allowed: true, ip: clientIp };
});

const validateLoginCountry = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    const portal = String((data && data.portal) || 'teacher').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    const uid = context.auth.uid;
    const madrasaSnap = await db.collection('All_Madrasas').doc(tenantId).get();
    if (madrasaSnap.exists && madrasaSnap.data().ownerUid === uid) {
        return { ok: true, allowed: true, bypass: 'owner' };
    }
    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    if (!policy.enableCountryAllowlist) {
        return { ok: true, allowed: true, skipped: true };
    }
    const countries = parseCountries(policy.allowedCountries);
    if (!countries.length) {
        return { ok: true, allowed: true, skipped: true, reason: 'no_countries' };
    }
    const country = extractCountryCode(context.rawRequest);
    if (!country) {
        return { ok: true, allowed: true, skipped: true, reason: 'no_country_header' };
    }
    if (!countryMatchesAllowlist(country, countries)) {
        await writeSecurityLog(db, tenantId, {
            action: 'login_country_denied',
            uid: uid,
            email: context.auth.token.email || '',
            details: { portal: portal, country: country, allowedCount: countries.length }
        });
        throw new functions.https.HttpsError('permission-denied', 'یہ ملک (' + country + ') لاگ ان کے لیے مجاز نہیں۔');
    }
    return { ok: true, allowed: true, country: country };
});

const getLoginIpPolicySummary = functions.https.onCall(async function (data, context) {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'لاگ ان لازمی ہے۔');
    }
    const tenantId = String((data && data.tenantId) || '').trim();
    if (!tenantId) {
        throw new functions.https.HttpsError('invalid-argument', 'tenantId درکار ہے۔');
    }
    const db = admin.firestore();
    await assertOwner(db, tenantId, context.auth.uid);
    const policySnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('TenantSettings').doc('securityPolicy').get();
    const policy = policySnap.exists ? policySnap.data() : {};
    const sinceMs = Date.now() - 7 * 86400000;
    const logSnap = await db.collection('All_Madrasas').doc(tenantId)
        .collection('SecurityLog')
        .orderBy('clientTs', 'desc')
        .limit(100)
        .get();
    let denied7d = 0;
    let countryDenied7d = 0;
    logSnap.forEach(function (doc) {
        const e = doc.data() || {};
        if (e.action === 'login_ip_denied' && e.clientTs >= sinceMs) denied7d++;
        if (e.action === 'login_country_denied' && e.clientTs >= sinceMs) countryDenied7d++;
    });
    return {
        enabled: !!policy.enableIpAllowlist,
        ranges: parseIpRanges(policy.allowedIpRanges),
        denied7d: denied7d,
        clientIpHint: extractClientIp(context.rawRequest) || '',
        countryAllowlist: {
            enabled: !!policy.enableCountryAllowlist,
            countries: parseCountries(policy.allowedCountries),
            denied7d: countryDenied7d,
            clientCountryHint: extractCountryCode(context.rawRequest) || ''
        }
    };
});

module.exports = {
    parseIpRanges,
    parseCountries,
    ipToLong,
    parseCidr,
    ipMatchesAllowlist,
    extractClientIp,
    extractCountryCode,
    countryMatchesAllowlist,
    validateLoginIpAddress,
    validateLoginCountry,
    getLoginIpPolicySummary
};
