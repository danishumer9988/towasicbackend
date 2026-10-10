const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const { protect } = require('../middleware/auth');

/* ============================================================
   MODELS
   ============================================================ */
const TTL_90D = 90 * 24 * 60 * 60;   // 90 days

/* ---------- Visitor (always stored — never auto-deleted) ---------- */
const Visitor = mongoose.models.Visitor || mongoose.model('Visitor', new mongoose.Schema({
  visitor_id:  { type: String, required: true, unique: true, index: true },

  // FIX: 'consent' was missing entirely. Now it's stored on every visitor.
  // 'unknown' from the client is normalized to 'declined'.
  consent:     { type: String, enum: ['accepted', 'declined'], default: 'declined', index: true },

  ip:          { type: String, default: '' },
  country:     { type: String, default: '' },
  countryName: { type: String, default: '' },
  region:      { type: String, default: '' },
  city:        { type: String, default: '' },
  lat:         { type: Number, default: null },
  lon:         { type: Number, default: null },
  accuracy:    { type: Number, default: null },
  geoSource:   { type: String, default: '' },
  device:      { type: String, default: '' },
  browser:     { type: String, default: '' },
  os:          { type: String, default: '' },
  sw:          { type: Number, default: null },
  sh:          { type: Number, default: null },
  vw:          { type: Number, default: null },
  vh:          { type: Number, default: null },

  last_page:   { type: String, default: '' },   // NEW — useful for the table

  first_seen:  { type: Date, default: Date.now },
  last_seen:   { type: Date, default: Date.now, index: true, expires: TTL_90D },
}));

/* ---------- Security log (declined users — activity trail) ---------- */
const SecurityLog = mongoose.models.SecurityLog || mongoose.model('SecurityLog', new mongoose.Schema({
  ip:        { type: String, required: true, index: true },
  isBot:     { type: Boolean, default: false },
  consent:   { type: String, enum: ['declined'], default: 'declined', index: true },
  startTime: { type: Date, default: Date.now },
  endTime:   { type: Date, default: Date.now },
  timestamp: { type: Date, default: Date.now, index: true, expires: TTL_90D },
}));

const Session = mongoose.models.Session || mongoose.model('Session', new mongoose.Schema({
  session_id:  { type: String, required: true, unique: true, index: true },
  visitor_id:  { type: String, required: true, index: true },
  landing:     { type: String, default: '/' },
  exit:        { type: String, default: '/' },
  ref_host:    { type: String, default: '' },
  page_views:  { type: Number, default: 1 },
  clicks:      { type: Number, default: 0 },
  duration_ms: { type: Number, default: 0 },
  started_at:  { type: Date, default: Date.now, index: true },
  ended_at:    { type: Date, default: Date.now },
}));

const PageView = mongoose.models.PageView || mongoose.model('PageView', new mongoose.Schema({
  visitor_id: { type: String, required: true, index: true },
  session_id: { type: String, required: true, index: true },
  path:       { type: String, default: '/', index: true },
  title:      { type: String, default: '' },
  ref_host:   { type: String, default: '' },
  timestamp:  { type: Date, default: Date.now, index: true, expires: TTL_90D },
}));

const Activity = mongoose.models.Activity || mongoose.model('Activity', new mongoose.Schema({
  visitor_id:  { type: String, required: true, index: true },
  session_id:  { type: String, required: true, index: true },
  type:        { type: String, required: true, index: true },
  path:        { type: String, default: '' },
  element:     { type: String, default: '' },
  text:        { type: String, default: '' },
  destination: { type: String, default: '' },
  timestamp:   { type: Date, default: Date.now, index: true, expires: TTL_90D },
}));

/* ============================================================
   HELPERS
   ============================================================ */
function parseUA(ua = '') {
  const l = ua.toLowerCase();
  const isBot = /bot|crawler|spider|crawling|slurp|facebookexternalhit|headlesschrome/i.test(l);

  let device = 'desktop';
  if (/ipad|tablet/i.test(l)) device = 'tablet';
  else if (/mobile|android.*mobile|iphone|ipod|windows phone|blackberry|opera mini/i.test(l)) device = 'mobile';

  let os = 'Other';
  if (/windows phone/i.test(l))                            os = 'Windows Phone';
  else if (/windows/i.test(l))                             os = 'Windows';
  else if (/iphone|ipad|ipod|ios/i.test(l))                os = 'iOS';
  else if (/android/i.test(l))                             os = 'Android';
  else if (/mac os|macintosh|mac_powerpc/i.test(l))        os = 'macOS';
  else if (/cros\s/i.test(l))                              os = 'ChromeOS';
  else if (/ubuntu/i.test(l))                              os = 'Ubuntu';
  else if (/fedora/i.test(l))                              os = 'Fedora';
  else if (/linux/i.test(l))                               os = 'Linux';
  else if (/freebsd|openbsd|netbsd/i.test(l))              os = 'BSD';

  let browser = 'Other';
  if (/edg\//i.test(l))              browser = 'Edge';
  else if (/opr\/|opera/i.test(l))   browser = 'Opera';
  else if (/chrome|crios/i.test(l))  browser = 'Chrome';
  else if (/firefox|fxios/i.test(l)) browser = 'Firefox';
  else if (/safari/i.test(l))        browser = 'Safari';

  return { device, browser, os, isBot };
}

const geoCache = new Map();
const GEO_TTL = 24 * 60 * 60 * 1000;

const isPrivateIp = (ip) => {
  if (!ip || ip === '::1' || ip === '127.0.0.1') return true;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m) { const n = Number(m[1]); if (n >= 16 && n <= 31) return true; }
  return false;
};

// FIX: fetch with a hard 3s timeout so a slow geo API can never block the upsert.
async function fetchWithTimeout(url, options = {}, ms = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function lookupFromIpApiCo(ip) {
  try {
    const res = await fetchWithTimeout(`https://ipapi.co/${ip}/json/`, { headers: { 'User-Agent': 'towasic-analytics/1.0' } });
    const j = await res.json();
    if (j.error) return null;
    return {
      country: (j.country_code || '').toUpperCase(), countryName: j.country_name || '',
      region: j.region || '', city: j.city || '',
      lat: typeof j.latitude === 'number' ? j.latitude : null,
      lon: typeof j.longitude === 'number' ? j.longitude : null,
    };
  } catch { return null; }
}

async function lookupFromIpWhoIs(ip) {
  try {
    const res = await fetchWithTimeout(`https://ipwho.is/${ip}`);
    const j = await res.json();
    if (!j.success) return null;
    return {
      country: (j.country_code || '').toUpperCase(), countryName: j.country || '',
      region: j.region || '', city: j.city || '',
      lat: typeof j.latitude === 'number' ? j.latitude : null,
      lon: typeof j.longitude === 'number' ? j.longitude : null,
    };
  } catch { return null; }
}

async function lookupGeo(ip, headers = {}) {
  const vc = headers['x-vercel-ip-country'];
  if (vc) {
    const city = (headers['x-vercel-ip-city'] || '').replace(/%20/g, ' ');
    return {
      country: vc.toUpperCase(),
      countryName: headers['x-vercel-ip-country-name'] || '',
      region: headers['x-vercel-ip-country-region'] || '',
      city,
      lat: parseFloat(headers['x-vercel-ip-latitude']) || null,
      lon: parseFloat(headers['x-vercel-ip-longitude']) || null,
    };
  }
  if (isPrivateIp(ip)) return { country: '', countryName: '', region: '', city: '', lat: null, lon: null };

  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.ts < GEO_TTL) return cached.data;

  let data = await lookupFromIpApiCo(ip);
  if (!data || !data.country) data = await lookupFromIpWhoIs(ip);
  if (!data) data = { country: '', countryName: '', region: '', city: '', lat: null, lon: null };

  geoCache.set(ip, { data, ts: Date.now() });
  return data;
}

const hostOf = (url = '') => {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return ''; }
};

// FIX: was previously just a start date — 'yesterday' leaked into today.
// Now returns a proper { $gte, $lte } window.
const rangeBounds = (range = '7d') => {
  const now = new Date();
  const endOfToday   = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);

  if (range === 'today') {
    return { $gte: startOfToday, $lte: endOfToday };
  }
  if (range === 'yesterday') {
    const yStart = new Date(startOfToday); yStart.setDate(yStart.getDate() - 1);
    const yEnd   = new Date(startOfToday); yEnd.setMilliseconds(-1);
    return { $gte: yStart, $lte: yEnd };
  }
  const days = { '7d': 7, '30d': 30, '90d': 90 }[range] || 7;
  const s = new Date(startOfToday);
  s.setDate(s.getDate() - (days - 1));
  return { $gte: s, $lte: endOfToday };
};

const strip = (doc) => {
  if (!doc) return doc;
  const { _id, __v, ...rest } = doc;
  return { ...rest, id: _id.toString() };
};

// FIX: upsert with duplicate-key retry. Two parallel requests from a new
// visitor used to collide on the unique visitor_id index and error out,
// which could silently drop the record.
async function safeUpsertVisitor(filter, update) {
  try {
    return await Visitor.findOneAndUpdate(filter, update, { upsert: true, new: true });
  } catch (err) {
    if (err && err.code === 11000) {
      return await Visitor.findOneAndUpdate(filter, { $set: update.$set }, { new: true });
    }
    throw err;
  }
}

/* ============================================================
   SECURITY LOG — declined users activity trail (30-min grouping)
   ============================================================ */
async function writeSecurityLog({ ip, isBot }) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);

  const existing = await SecurityLog
    .findOne({ ip, consent: 'declined', timestamp: { $gte: cutoff } })
    .sort({ timestamp: -1 });

  if (existing) {
    existing.endTime   = new Date();
    existing.timestamp = new Date();
    await existing.save();
  } else {
    await SecurityLog.create({
      ip, isBot, consent: 'declined',
      startTime: new Date(), endTime: new Date(), timestamp: new Date(),
    });
  }
}

/* ============================================================
   POST /api/track
   ------------------------------------------------------------
   Rules (per product spec):
     • accepted  → full data capture (sessions, pageviews, clicks)
     • declined  → limited data capture (visitor row + security log)
     • unknown / missing consent → treated as declined
     • NEVER delete a Visitor row
   ============================================================ */
router.post('/track', async (req, res) => {
  try {
    const d = req.body || {};
    const {
      type, visitorId, sessionId, url, path, title, referrer,
      screen, viewport, element, text, destination, clientGeo,
      consent: rawConsent,
    } = d;

    if (!visitorId || !sessionId || !type) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
            || req.headers['cf-connecting-ip']
            || req.ip
            || '';
    const ua = req.headers['user-agent'] || '';
    const { device, browser, os, isBot } = parseUA(ua);

    if (isBot) return res.json({ ok: true, skipped: 'bot' });

    /* ---------- Normalize incoming consent ---------- */
    let incoming = rawConsent;
    if (incoming === true)  incoming = 'accepted';
    if (incoming === false) incoming = 'declined';
    if (typeof incoming === 'string') incoming = incoming.toLowerCase();
    if (incoming !== 'accepted') incoming = null;   // anything else is ignored

    const existing = await Visitor.findOne({ visitor_id: visitorId }).lean();

    // Effective consent:
    //   1. If client explicitly says 'accepted' → accepted
    //   2. If they've previously accepted and don't send anything now → stay accepted
    //   3. Otherwise → declined
    let consent = 'declined';
    if (incoming === 'accepted') consent = 'accepted';
    else if (!rawConsent && existing?.consent === 'accepted') consent = 'accepted';

    /* ---------- Base update: applies to BOTH accepted and declined ---------- */
    const update = {
      $set: {
        ip, device, browser, os,
        consent,
        last_seen: new Date(),
      },
      $setOnInsert: {
        visitor_id: visitorId,
        first_seen: new Date(),
      },
    };

    if (type === 'pageview' && path) {
      update.$set.last_page = path.slice(0, 120);
    }

    /* ---------- Geo: only on first sight, IP-based for both consent types ---------- */
    if (!existing) {
      const ipGeo = await lookupGeo(ip, req.headers);
      if (ipGeo) {
        update.$set.country     = ipGeo.country;
        update.$set.countryName = ipGeo.countryName;
        update.$set.region      = ipGeo.region;
        update.$set.city        = ipGeo.city;
        if (ipGeo.lat !== null && ipGeo.lon !== null) {
          update.$set.lat       = ipGeo.lat;
          update.$set.lon       = ipGeo.lon;
          update.$set.geoSource = 'ip';
        }
      }
    }

    /* ---------- Extra fields only for ACCEPTED ---------- */
    if (consent === 'accepted') {
      update.$set.sw = screen?.w ?? null;
      update.$set.sh = screen?.h ?? null;
      update.$set.vw = viewport?.w ?? null;
      update.$set.vh = viewport?.h ?? null;

      const hasGps = clientGeo
        && typeof clientGeo.lat === 'number'
        && typeof clientGeo.lon === 'number';
      if (hasGps) {
        update.$set.lat       = clientGeo.lat;
        update.$set.lon       = clientGeo.lon;
        update.$set.accuracy  = typeof clientGeo.accuracy === 'number' ? clientGeo.accuracy : null;
        update.$set.geoSource = 'gps';
      }
    }

    /* ---------- Always upsert — never delete ---------- */
    await safeUpsertVisitor({ visitor_id: visitorId }, update);

    /* ---------- DECLINED path: security log only, no sessions/pageviews ---------- */
    if (consent === 'declined') {
      if (type === 'pageview') {
        await writeSecurityLog({ ip, isBot: false });
      }
      return res.json({ ok: true, consent, stored: 'minimal' });
    }

    /* ---------- ACCEPTED path: full tracking ---------- */
    if (type === 'pageview') {
      const sess = await Session.findOne({ session_id: sessionId }).lean();
      if (!sess) {
        await Session.create({
          session_id: sessionId, visitor_id: visitorId,
          landing: path || '/', exit: path || '/',
          ref_host: hostOf(referrer),
          page_views: 1, clicks: 0, duration_ms: 0,
          started_at: new Date(), ended_at: new Date(),
        });
      } else {
        const lastTs = sess.ended_at ? new Date(sess.ended_at).getTime() : Date.now();
        const idleMs = Math.min(Date.now() - lastTs, 30 * 60 * 1000);
        const duration = (sess.duration_ms || 0) + (idleMs > 0 ? idleMs : 0);
        await Session.updateOne(
          { session_id: sessionId },
          { $set: { ended_at: new Date(), duration_ms: duration, exit: path || '/' }, $inc: { page_views: 1 } }
        );
      }

      await PageView.create({
        visitor_id: visitorId, session_id: sessionId,
        path: path || '/',
        title: (title || '').slice(0, 120),
        ref_host: hostOf(referrer),
        timestamp: new Date(),
      });
    } else if (type === 'click') {
      const dest = (() => {
        try { return new URL(destination, 'http://x').pathname; } catch { return destination || ''; }
      })();

      await Activity.create({
        visitor_id: visitorId, session_id: sessionId, type: 'click',
        path: path || '',
        element: (element || '').slice(0, 16),
        text: (text || '').slice(0, 60),
        destination: dest.slice(0, 120),
        timestamp: new Date(),
      });

      await Session.updateOne(
        { session_id: sessionId },
        {
          $inc: { clicks: 1 },
          $set: { ended_at: new Date() },
          $setOnInsert: {
            visitor_id: visitorId, landing: path || '/', exit: path || '/',
            page_views: 0, duration_ms: 0, started_at: new Date(),
          },
        },
        { upsert: true }
      );
    } else {
      return res.status(400).json({ ok: false, error: 'Unknown type' });
    }

    return res.json({ ok: true, consent, stored: 'full' });
  } catch (err) {
    console.error('[track] error:', err);
    return res.status(500).json({ ok: false });
  }
});

/* ============================================================
   GET /api/analytics?type=...
   (Now protected — previously anyone could read everything)
   ============================================================ */
router.get('/analytics', protect, async (req, res) => {
  try {
    const type   = req.query.type;
    const range  = req.query.range || '7d';
    const bounds = rangeBounds(range);

    /* ---------- SUMMARY ---------- */
    if (type === 'summary') {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

      const [
        uv, acceptedCount, declinedCount, ss, pv, cl,
        avgRow, activeNow, bounced, newVs, avgPerSession,
      ] = await Promise.all([
        Visitor.countDocuments({ last_seen: bounds }),
        Visitor.countDocuments({ last_seen: bounds, consent: 'accepted' }),
        Visitor.countDocuments({ last_seen: bounds, consent: 'declined' }),
        Session.countDocuments({ started_at: bounds }),
        PageView.countDocuments({ timestamp: bounds }),
        Activity.countDocuments({ type: 'click', timestamp: bounds }),
        Session.aggregate([
          { $match: { started_at: bounds } },
          { $group: { _id: null, avg: { $avg: '$duration_ms' } } },
        ]),
        Visitor.countDocuments({ last_seen: { $gte: fiveMinAgo } }),
        Session.countDocuments({ started_at: bounds, page_views: { $lte: 1 } }),
        Promise.all([
          Visitor.countDocuments({ first_seen: bounds, last_seen: bounds }),
          Visitor.countDocuments({ last_seen: bounds }),
        ]),
        Session.aggregate([
          { $match: { started_at: bounds } },
          { $group: { _id: null, avgPages: { $avg: '$page_views' }, avgClicks: { $avg: '$clicks' } } },
        ]),
      ]);

      return res.json({
        // totals
        uniqueVisitors:     uv,
        acceptedVisitors:   acceptedCount,
        declinedVisitors:   declinedCount,
        sessions:           ss,
        pageViews:          pv,
        clicks:             cl,
        avgSessionMs:       Math.round(avgRow[0]?.avg || 0),
        activeNow:          activeNow,
        bounceRate:         ss ? bounced / ss : 0,
        newVisitors:        newVs[0],
        returningVisitors:  Math.max(0, newVs[1] - newVs[0]),
        avgPagesPerSession:  +(avgPerSession[0]?.avgPages  || 0).toFixed(2),
        avgClicksPerSession: +(avgPerSession[0]?.avgClicks || 0).toFixed(2),

        // backwards-compatible aliases
        consentAccepted: acceptedCount,
        consentDeclined: declinedCount,
      });
    }

    /* ---------- TIMESERIES ---------- */
    if (type === 'timeseries') {
      const rows = await PageView.aggregate([
        { $match: { timestamp: bounds } },
        { $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            pageViews: { $sum: 1 },
            visitors: { $addToSet: '$visitor_id' },
        } },
        { $project: { _id: 0, date: '$_id', pageViews: 1, visitors: { $size: '$visitors' } } },
        { $sort: { date: 1 } },
      ]);
      return res.json(rows);
    }

    /* ---------- VISITORS (both accepted AND declined) ---------- */
    if (type === 'visitors') {
      const q = (req.query.q || '').trim();
      const consentFilter = req.query.consent;   // optional: 'accepted' | 'declined'

      const filter = { last_seen: bounds };
      if (consentFilter === 'accepted' || consentFilter === 'declined') {
        filter.consent = consentFilter;
      }
      if (q) {
        const like = new RegExp(q, 'i');
        filter.$or = [
          { ip: like }, { browser: like }, { os: like },
          { device: like }, { visitor_id: like },
          { country: like }, { countryName: like }, { region: like }, { city: like },
        ];
      }

      const visitors = await Visitor.find(filter).sort({ last_seen: -1 }).limit(500).lean();
      const ids = visitors.map((v) => v.visitor_id);

      const agg = await Session.aggregate([
        { $match: { visitor_id: { $in: ids }, started_at: bounds } },
        { $group: {
            _id: '$visitor_id',
            sessions: { $sum: 1 },
            pages:    { $sum: '$page_views' },
            clicks:   { $sum: '$clicks' },
        } },
      ]);
      const aggMap = agg.reduce((m, r) => (m[r._id] = r, m), {});

      return res.json(visitors.map((v) => ({
        ...strip(v),
        screen_w:   v.sw, screen_h: v.sh,
        viewport_w: v.vw, viewport_h: v.vh,
        sessions:   aggMap[v.visitor_id]?.sessions || 0,
        pages:      aggMap[v.visitor_id]?.pages    || 0,
        clicks:     aggMap[v.visitor_id]?.clicks   || 0,
        consent:    v.consent || 'declined',
      })));
    }

    /* ---------- SINGLE VISITOR ---------- */
    if (type === 'visitor') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const [visitor, sessions, pageViews, activities] = await Promise.all([
        Visitor.findOne({ visitor_id: id }).lean(),
        Session.find({ visitor_id: id }).sort({ started_at: -1 }).limit(100).lean(),
        PageView.find({ visitor_id: id }).sort({ timestamp: -1 }).limit(500).lean(),
        Activity.find({ visitor_id: id }).sort({ timestamp: -1 }).limit(500).lean(),
      ]);

      if (!visitor) return res.status(404).json({ error: 'Not found' });

      return res.json({
        visitor: {
          ...strip(visitor),
          screen_w:   visitor.sw, screen_h: visitor.sh,
          viewport_w: visitor.vw, viewport_h: visitor.vh,
          consent:    visitor.consent || 'declined',
        },
        sessions:   sessions.map((s) => ({ ...strip(s), landing_page: s.landing, exit_page: s.exit })),
        pageViews:  pageViews.map(strip),
        activities: activities.map(strip),
      });
    }

    /* ---------- BREAKDOWNS ---------- */
    if (type === 'breakdowns') {
      const [
        devices, browsers, os, topPages, referrers,
        entryPages, exitPages, hourly, countries, regions, cities,
      ] = await Promise.all([
        Visitor.aggregate([
          { $match: { last_seen: bounds, device: { $ne: '' } } },
          { $group: { _id: '$device', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: bounds, browser: { $ne: '' } } },
          { $group: { _id: '$browser', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: bounds, os: { $ne: '' } } },
          { $group: { _id: '$os', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        PageView.aggregate([
          { $match: { timestamp: bounds } },
          { $group: { _id: '$path', views: { $sum: 1 }, unique: { $addToSet: '$visitor_id' } } },
          { $project: { _id: 1, views: 1, unique: { $size: '$unique' } } },
          { $sort: { views: -1 } }, { $limit: 15 },
        ]),
        PageView.aggregate([
          { $match: { timestamp: bounds, ref_host: { $nin: ['', null] } } },
          { $group: { _id: '$ref_host', count: { $sum: 1 } } },
          { $sort: { count: -1 } }, { $limit: 10 },
        ]),
        Session.aggregate([
          { $match: { started_at: bounds } },
          { $group: { _id: '$landing', views: { $sum: 1 }, unique: { $addToSet: '$visitor_id' } } },
          { $project: { _id: 1, views: 1, unique: { $size: '$unique' } } },
          { $sort: { views: -1 } }, { $limit: 10 },
        ]),
        Session.aggregate([
          { $match: { started_at: bounds } },
          { $group: { _id: '$exit', views: { $sum: 1 }, unique: { $addToSet: '$visitor_id' } } },
          { $project: { _id: 1, views: 1, unique: { $size: '$unique' } } },
          { $sort: { views: -1 } }, { $limit: 10 },
        ]),
        PageView.aggregate([
          { $match: { timestamp: bounds } },
          { $group: { _id: { $hour: '$timestamp' }, count: { $sum: 1 } } },
          { $project: { _id: 0, hour: '$_id', count: 1 } },
          { $sort: { hour: 1 } },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: bounds, country: { $ne: '' } } },
          { $group: { _id: { code: '$country', name: '$countryName' }, count: { $sum: 1 } } },
          { $sort: { count: -1 } }, { $limit: 15 },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: bounds, region: { $ne: '' } } },
          { $group: { _id: '$region', count: { $sum: 1 } } },
          { $sort: { count: -1 } }, { $limit: 15 },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: bounds, city: { $ne: '' } } },
          { $group: { _id: '$city', count: { $sum: 1 } } },
          { $sort: { count: -1 } }, { $limit: 15 },
        ]),
      ]);

      const hourlyFull = Array.from({ length: 24 }, (_, h) =>
        hourly.find((r) => r.hour === h) || { hour: h, count: 0 }
      );

      return res.json({
        devices, browsers, os, topPages,
        referrers, entryPages, exitPages,
        hourly: hourlyFull,
        countries, regions, cities,
      });
    }

    /* ---------- SECURITY LOG ---------- */
    if (type === 'security-log') {
      const logs = await SecurityLog
        .find({ timestamp: bounds })
        .sort({ timestamp: -1 })
        .limit(500)
        .lean();

      return res.json(logs.map((l) => ({
        ...strip(l),
        durationMs: l.endTime && l.startTime
          ? new Date(l.endTime).getTime() - new Date(l.startTime).getTime()
          : 0,
      })));
    }

    /* ---------- CONSENT BREAKDOWN ---------- */
    if (type === 'consent-breakdown') {
      const [accepted, declined] = await Promise.all([
        Visitor.countDocuments({ last_seen: bounds, consent: 'accepted' }),
        Visitor.countDocuments({ last_seen: bounds, consent: 'declined' }),
      ]);
      return res.json({ accepted, declined });
    }

    return res.status(400).json({ error: 'Unknown type' });
  } catch (err) {
    console.error('[analytics] error:', err);
    return res.status(500).json({ error: 'Failed to load analytics' });
  }
});

/* ============================================================
   DELETE
   ============================================================ */
router.delete('/analytics/visitor/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ ok: false, error: 'Missing visitor id' });

    const [v, s, p, a] = await Promise.all([
      Visitor.deleteOne({ visitor_id: id }),
      Session.deleteMany({ visitor_id: id }),
      PageView.deleteMany({ visitor_id: id }),
      Activity.deleteMany({ visitor_id: id }),
    ]);

    return res.json({
      ok: true,
      deleted: {
        visitors: v.deletedCount, sessions: s.deletedCount,
        pageViews: p.deletedCount, activities: a.deletedCount,
      },
    });
  } catch (err) {
    console.error('[analytics delete] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/analytics/visitors/delete', protect, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'No visitor IDs provided' });
    }

    const [v, s, p, a] = await Promise.all([
      Visitor.deleteMany({ visitor_id: { $in: ids } }),
      Session.deleteMany({ visitor_id: { $in: ids } }),
      PageView.deleteMany({ visitor_id: { $in: ids } }),
      Activity.deleteMany({ visitor_id: { $in: ids } }),
    ]);

    return res.json({
      ok: true, deletedCount: ids.length,
      breakdown: {
        visitors: v.deletedCount, sessions: s.deletedCount,
        pageViews: p.deletedCount, activities: a.deletedCount,
      },
    });
  } catch (err) {
    console.error('[analytics bulk delete] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/analytics/security-log/:id', protect, async (req, res) => {
  try {
    const result = await SecurityLog.deleteOne({ _id: req.params.id });
    return res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    console.error('[security-log delete] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/analytics/security-log/bulk-delete', protect, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'No IDs provided' });
    }
    const result = await SecurityLog.deleteMany({ _id: { $in: ids } });
    return res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('[security-log bulk delete] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;