const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const { protect } = require('../middleware/auth');

/* ============================================================
   MODELS
   ============================================================ */
const TTL_90D = 90 * 24 * 60 * 60;

const Visitor = mongoose.models.Visitor || mongoose.model('Visitor', new mongoose.Schema({
  visitor_id:  { type: String, required: true, unique: true, index: true },
  // consent: 'accepted' (full tracking) | 'declined' (essentials only) | 'unknown'
  consent:     { type: String, enum: ['accepted', 'declined', 'unknown'], default: 'unknown', index: true },
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
  first_seen:  { type: Date, default: Date.now },
  last_seen:   { type: Date, default: Date.now, index: true, expires: TTL_90D },
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
const REQUIRED_ESSENTIALS = [
  // Only what's strictly necessary for a functioning site + security
  'visitor_id', 'session_id', 'ip', 'country', 'countryName', 'path', 'timestamp',
];

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

const isPrivateIp = (ip) =>
  !ip || ip === '::1' || ip === '127.0.0.1' ||
  ip.startsWith('192.168.') || ip.startsWith('10.') ||
  ip.startsWith('172.16.') || ip.startsWith('172.17.') ||
  ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
  ip.startsWith('172.2') || ip.startsWith('172.30.') || ip.startsWith('172.31.');

async function lookupFromIpApiCo(ip) {
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, { headers: { 'User-Agent': 'towasic-analytics/1.0' } });
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
    const res = await fetch(`https://ipwho.is/${ip}`);
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

const rangeStart = (range = '7d') => {
  const days = { today: 1, yesterday: 2, '7d': 7, '30d': 30, '90d': 90 }[range] || 7;
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  d.setHours(0, 0, 0, 0);
  return d;
};

const strip = (doc) => {
  if (!doc) return doc;
  const { _id, __v, ...rest } = doc;
  return { ...rest, id: _id.toString() };
};

/* Strip non-essential fields from a visitor doc (used when consent = declined) */
async function stripNonEssential(visitorId) {
  await Visitor.updateOne(
    { visitor_id: visitorId },
    {
      $set: {
        region: '', city: '', lat: null, lon: null, accuracy: null, geoSource: '',
        device: '', browser: '', os: '',
        sw: null, sh: null, vw: null, vh: null,
      },
    }
  );
  // Also remove click activity (non-essential)
  await Activity.deleteMany({ visitor_id: visitorId });
}

/* ============================================================
   POST /api/track
   ============================================================ */
router.post('/track', async (req, res) => {
  try {
    const d = req.body || {};
    const {
      type, visitorId, sessionId, url, path, title, referrer,
      screen, viewport, element, text, destination, clientGeo,
      consent: incomingConsent,
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

    // Determine effective consent: prefer incoming, else what we already have
    const existing = await Visitor.findOne({ visitor_id: visitorId }).lean();
    const consent = incomingConsent
      || existing?.consent
      || 'unknown';
    const hasFullConsent = consent === 'accepted';
    const wasAccepted = existing?.consent === 'accepted';

    // If user flipped from accepted → declined, strip previously saved non-essential data
    if (consent === 'declined' && wasAccepted) {
      await stripNonEssential(visitorId);
    }

    if (type === 'pageview') {
      let ipGeo = null;
      if (!existing || !existing.country) {
        ipGeo = await lookupGeo(ip, req.headers);
      }

      const hasGps = hasFullConsent
        && clientGeo
        && typeof clientGeo.lat === 'number'
        && typeof clientGeo.lon === 'number';

      /* ---------- Essential fields (always saved) ---------- */
      const update = {
        $set: {
          ip,
          consent,
          last_seen: new Date(),
        },
        $setOnInsert: { visitor_id: visitorId, first_seen: new Date() },
      };

      // Country is saved for everyone (coarse geo — needed for security/abuse)
      if (ipGeo) {
        update.$set.country     = ipGeo.country;
        update.$set.countryName = ipGeo.countryName;
      }

      /* ---------- Non-essential fields (only if consent accepted) ---------- */
      if (hasFullConsent) {
        update.$set.device  = device;
        update.$set.browser = browser;
        update.$set.os      = os;
        update.$set.sw      = screen?.w   ?? null;
        update.$set.sh      = screen?.h   ?? null;
        update.$set.vw      = viewport?.w ?? null;
        update.$set.vh      = viewport?.h ?? null;

        if (ipGeo) {
          update.$set.region = ipGeo.region;
          update.$set.city   = ipGeo.city;
        }

        if (hasGps) {
          update.$set.lat       = clientGeo.lat;
          update.$set.lon       = clientGeo.lon;
          update.$set.accuracy  = typeof clientGeo.accuracy === 'number' ? clientGeo.accuracy : null;
          update.$set.geoSource = 'gps';
        } else if (ipGeo && ipGeo.lat !== null && ipGeo.lon !== null) {
          update.$set.lat       = ipGeo.lat;
          update.$set.lon       = ipGeo.lon;
          update.$set.accuracy  = null;
          update.$set.geoSource = 'ip';
        }
      } else {
        // Ensure declined visitors never carry non-essential data
        update.$set.region = '';
        update.$set.city   = '';
        update.$set.lat    = null;
        update.$set.lon    = null;
        update.$set.accuracy = null;
        update.$set.geoSource = '';
        update.$set.device  = '';
        update.$set.browser = '';
        update.$set.os      = '';
        update.$set.sw      = null;
        update.$set.sh      = null;
        update.$set.vw      = null;
        update.$set.vh      = null;
      }

      await Visitor.findOneAndUpdate({ visitor_id: visitorId }, update, { upsert: true });

      /* ---------- Session ---------- */
      const sess = await Session.findOne({ session_id: sessionId }).lean();
      if (!sess) {
        await Session.create({
          session_id: sessionId, visitor_id: visitorId,
          landing: path || '/', exit: path || '/',
          ref_host: hasFullConsent ? hostOf(referrer) : '',
          page_views: 1, clicks: 0, duration_ms: 0,
          started_at: new Date(), ended_at: new Date(),
        });
      } else {
        const lastTs = sess.ended_at ? new Date(sess.ended_at).getTime() : Date.now();
        const idleMs = Math.min(Date.now() - lastTs, 30 * 60 * 1000);
        const duration = (sess.duration_ms || 0) + (idleMs > 0 ? idleMs : 0);
        await Session.updateOne(
          { session_id: sessionId },
          {
            $set: {
              ended_at: new Date(),
              duration_ms: duration,
              exit: path || '/',
              ...(hasFullConsent && !sess.ref_host ? { ref_host: hostOf(referrer) } : {}),
            },
            $inc: { page_views: 1 },
          }
        );
      }

      /* ---------- PageView ---------- */
      await PageView.create({
        visitor_id: visitorId, session_id: sessionId,
        path: path || '/',
        title: hasFullConsent ? (title || '').slice(0, 120) : '',
        ref_host: hasFullConsent ? hostOf(referrer) : '',
        timestamp: new Date(),
      });
    } else if (type === 'click') {
      // Click activity is non-essential — skip entirely for declined users
      if (!hasFullConsent) {
        return res.json({ ok: true, skipped: 'no-consent' });
      }

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

    return res.json({ ok: true, consent });
  } catch (err) {
    console.error('[track] error:', err);
    return res.status(500).json({ ok: false });
  }
});

/* ============================================================
   GET /api/analytics?type=...&consent=...
   ============================================================ */
router.get('/analytics', async (req, res) => {
  try {
    const type     = req.query.type;
    const range    = req.query.range || '7d';
    const consentQ = req.query.consent || 'all';   // 'all' | 'accepted' | 'declined' | 'unknown'
    const start    = rangeStart(range);

    /* Build the consent part of the query */
    const consentMatch = consentQ === 'all' ? {} : { consent: consentQ };

    if (type === 'summary') {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

      const [uv, ss, pv, cl, avgRow, activeRow, bounced, newVs, avgPerSession, accepted, declined] = await Promise.all([
        Visitor.countDocuments({ last_seen: { $gte: start }, ...consentMatch }),
        Session.countDocuments({ started_at: { $gte: start } }),
        PageView.countDocuments({ timestamp: { $gte: start } }),
        Activity.countDocuments({ type: 'click', timestamp: { $gte: start } }),
        Session.aggregate([
          { $match: { started_at: { $gte: start } } },
          { $group: { _id: null, avg: { $avg: '$duration_ms' } } },
        ]),
        PageView.aggregate([
          { $match: { timestamp: { $gte: fiveMinAgo } } },
          { $group: { _id: '$visitor_id' } },
          { $count: 'n' },
        ]),
        Session.countDocuments({ started_at: { $gte: start }, page_views: { $lte: 1 } }),
        Promise.all([
          Visitor.countDocuments({ first_seen: { $gte: start }, last_seen: { $gte: start }, ...consentMatch }),
          Visitor.countDocuments({ last_seen: { $gte: start }, ...consentMatch }),
        ]),
        Session.aggregate([
          { $match: { started_at: { $gte: start } } },
          { $group: { _id: null, avgPages: { $avg: '$page_views' }, avgClicks: { $avg: '$clicks' } } },
        ]),
        Visitor.countDocuments({ last_seen: { $gte: start }, consent: 'accepted' }),
        Visitor.countDocuments({ last_seen: { $gte: start }, consent: 'declined' }),
      ]);

      return res.json({
        uniqueVisitors: uv, sessions: ss, pageViews: pv, clicks: cl,
        avgSessionMs: Math.round(avgRow[0]?.avg || 0),
        activeNow: activeRow[0]?.n || 0,
        bounceRate: ss ? bounced / ss : 0,
        newVisitors: newVs[0],
        returningVisitors: Math.max(0, newVs[1] - newVs[0]),
        avgPagesPerSession: +(avgPerSession[0]?.avgPages || 0).toFixed(2),
        avgClicksPerSession: +(avgPerSession[0]?.avgClicks || 0).toFixed(2),
        consentAccepted: accepted,
        consentDeclined: declined,
      });
    }

    if (type === 'timeseries') {
      const rows = await PageView.aggregate([
        { $match: { timestamp: { $gte: start } } },
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

    if (type === 'visitors') {
      const q = (req.query.q || '').trim();
      const filter = { last_seen: { $gte: start }, ...consentMatch };
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
        { $match: { visitor_id: { $in: ids }, started_at: { $gte: start } } },
        { $group: {
            _id: '$visitor_id',
            sessions: { $sum: 1 },
            pages: { $sum: '$page_views' },
            clicks: { $sum: '$clicks' },
        } },
      ]);
      const aggMap = agg.reduce((m, r) => (m[r._id] = r, m), {});

      return res.json(visitors.map((v) => ({
        ...strip(v),
        screen_w: v.sw, screen_h: v.sh,
        viewport_w: v.vw, viewport_h: v.vh,
        sessions: aggMap[v.visitor_id]?.sessions || 0,
        pages:    aggMap[v.visitor_id]?.pages    || 0,
        clicks:   aggMap[v.visitor_id]?.clicks   || 0,
      })));
    }

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
          screen_w: visitor.sw, screen_h: visitor.sh,
          viewport_w: visitor.vw, viewport_h: visitor.vh,
        },
        sessions: sessions.map((s) => ({ ...strip(s), landing_page: s.landing, exit_page: s.exit })),
        pageViews: pageViews.map(strip),
        activities: activities.map(strip),
      });
    }

    if (type === 'breakdowns') {
      const [devices, browsers, os, topPages, referrers, entryPages, exitPages, hourly, countries, regions, cities] = await Promise.all([
        Visitor.aggregate([
          { $match: { last_seen: { $gte: start }, ...consentMatch, device: { $ne: '' } } },
          { $group: { _id: '$device', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: { $gte: start }, ...consentMatch, browser: { $ne: '' } } },
          { $group: { _id: '$browser', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: { $gte: start }, ...consentMatch, os: { $ne: '' } } },
          { $group: { _id: '$os', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        PageView.aggregate([
          { $match: { timestamp: { $gte: start } } },
          { $group: { _id: '$path', views: { $sum: 1 }, unique: { $addToSet: '$visitor_id' } } },
          { $project: { _id: 1, views: 1, unique: { $size: '$unique' } } },
          { $sort: { views: -1 } }, { $limit: 15 },
        ]),
        PageView.aggregate([
          { $match: { timestamp: { $gte: start }, ref_host: { $nin: ['', null] } } },
          { $group: { _id: '$ref_host', count: { $sum: 1 } } },
          { $sort: { count: -1 } }, { $limit: 10 },
        ]),
        Session.aggregate([
          { $match: { started_at: { $gte: start } } },
          { $group: { _id: '$landing', views: { $sum: 1 }, unique: { $addToSet: '$visitor_id' } } },
          { $project: { _id: 1, views: 1, unique: { $size: '$unique' } } },
          { $sort: { views: -1 } }, { $limit: 10 },
        ]),
        Session.aggregate([
          { $match: { started_at: { $gte: start } } },
          { $group: { _id: '$exit', views: { $sum: 1 }, unique: { $addToSet: '$visitor_id' } } },
          { $project: { _id: 1, views: 1, unique: { $size: '$unique' } } },
          { $sort: { views: -1 } }, { $limit: 10 },
        ]),
        PageView.aggregate([
          { $match: { timestamp: { $gte: start } } },
          { $group: { _id: { $hour: '$timestamp' }, count: { $sum: 1 } } },
          { $project: { _id: 0, hour: '$_id', count: 1 } },
          { $sort: { hour: 1 } },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: { $gte: start }, ...consentMatch, country: { $ne: '' } } },
          { $group: { _id: { code: '$country', name: '$countryName' }, count: { $sum: 1 } } },
          { $sort: { count: -1 } }, { $limit: 15 },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: { $gte: start }, ...consentMatch, region: { $ne: '' } } },
          { $group: { _id: '$region', count: { $sum: 1 } } },
          { $sort: { count: -1 } }, { $limit: 15 },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: { $gte: start }, ...consentMatch, city: { $ne: '' } } },
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

    if (type === 'consent-breakdown') {
      const [accepted, declined, unknown] = await Promise.all([
        Visitor.countDocuments({ last_seen: { $gte: start }, consent: 'accepted' }),
        Visitor.countDocuments({ last_seen: { $gte: start }, consent: 'declined' }),
        Visitor.countDocuments({ last_seen: { $gte: start }, consent: 'unknown' }),
      ]);
      return res.json({ accepted, declined, unknown });
    }

    return res.status(400).json({ error: 'Unknown type' });
  } catch (err) {
    console.error('[analytics] error:', err);
    return res.status(500).json({ error: 'Failed to load analytics' });
  }
});

/* ============================================================
   DELETE — visitor + all related records
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

module.exports = router;