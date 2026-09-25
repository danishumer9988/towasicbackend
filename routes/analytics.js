const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

/* ============================================================
   MODELS — optimized for minimum size
   ============================================================ */
const TTL_90D = 90 * 24 * 60 * 60; // 90 days

const Visitor = mongoose.models.Visitor || mongoose.model('Visitor', new mongoose.Schema({
  visitor_id: { type: String, required: true, unique: true, index: true },
  ip:         { type: String, default: '' },
  device:     { type: String, default: 'desktop' },
  browser:    { type: String, default: 'Other' },
  os:         { type: String, default: 'Other' },
  sw:         { type: Number, default: null },
  sh:         { type: Number, default: null },
  vw:         { type: Number, default: null },
  vh:         { type: Number, default: null },
  first_seen: { type: Date, default: Date.now },
  last_seen:  { type: Date, default: Date.now, index: true, expires: TTL_90D },
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
const parseUA = (ua = '') => {
  const l = ua.toLowerCase();
  const device = /mobile|android|iphone|ipod|blackberry|opera mini/i.test(l) ? 'mobile'
    : /ipad|tablet/i.test(l) ? 'tablet' : 'desktop';

  let browser = 'Other';
  if (/edg\//i.test(l))              browser = 'Edge';
  else if (/chrome|crios/i.test(l))  browser = 'Chrome';
  else if (/firefox|fxios/i.test(l)) browser = 'Firefox';
  else if (/opr\//i.test(l))         browser = 'Opera';
  else if (/safari/i.test(l))        browser = 'Safari';

  let os = 'Other';
  if (/windows/i.test(l))               os = 'Windows';
  else if (/mac os|macintosh/i.test(l)) os = 'macOS';
  else if (/android/i.test(l))          os = 'Android';
  else if (/iphone|ipad|ipod/i.test(l)) os = 'iOS';
  else if (/linux/i.test(l))            os = 'Linux';

  return { device, browser, os };
};

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

/* ============================================================
   POST /api/track
   ============================================================ */
router.post('/track', async (req, res) => {
  try {
    const d = req.body || {};
    const {
      type, visitorId, sessionId, url, path, title, referrer,
      screen, viewport, element, text, destination,
    } = d;

    if (!visitorId || !sessionId || !type) {
      return res.status(400).json({ ok: false, error: 'Missing required fields' });
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
    const ua = req.headers['user-agent'] || '';
    const { device, browser, os } = parseUA(ua);

    if (type === 'pageview') {
      await Visitor.findOneAndUpdate(
        { visitor_id: visitorId },
        {
          $set: {
            ip, device, browser, os,
            sw: screen?.w   ?? null,
            sh: screen?.h   ?? null,
            vw: viewport?.w ?? null,
            vh: viewport?.h ?? null,
            last_seen: new Date(),
          },
          $setOnInsert: { visitor_id: visitorId, first_seen: new Date() },
        },
        { upsert: true, new: true }
      );

      const existing = await Session.findOne({ session_id: sessionId }).lean();
      if (!existing) {
        await Session.create({
          session_id: sessionId, visitor_id: visitorId,
          landing: path || '/', exit: path || '/',
          ref_host: hostOf(referrer),
          page_views: 1, clicks: 0, duration_ms: 0,
          started_at: new Date(), ended_at: new Date(),
        });
      } else {
        const lastTs = existing.ended_at ? new Date(existing.ended_at).getTime() : Date.now();
        const idleMs = Math.min(Date.now() - lastTs, 30 * 60 * 1000);
        const duration = (existing.duration_ms || 0) + (idleMs > 0 ? idleMs : 0);
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
        try { return new URL(destination, window?.location?.origin || 'http://x').pathname; }
        catch { return destination || ''; }
      })();

      await Activity.create({
        visitor_id: visitorId, session_id: sessionId, type: 'click',
        path: path || '',
        element: (element || '').slice(0, 16),
        text: (text || '').slice(0, 60),
        destination: dest.slice(0, 120),
        timestamp: new Date(),
      });

      // If a click arrives for a session we haven't seen (edge case), create it now
      await Session.updateOne(
        { session_id: sessionId },
        { $inc: { clicks: 1 }, $set: { ended_at: new Date() },
          $setOnInsert: {
            visitor_id: visitorId, landing: path || '/', exit: path || '/',
            page_views: 0, duration_ms: 0,
            started_at: new Date(),
          } },
        { upsert: true }
      );
    } else {
      return res.status(400).json({ ok: false, error: 'Unknown type' });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('[track] error:', err);
    return res.status(500).json({ ok: false });
  }
});

/* ============================================================
   GET /api/analytics?type=...
   ============================================================ */
router.get('/analytics', async (req, res) => {
  try {
    const type  = req.query.type;
    const range = req.query.range || '7d';
    const start = rangeStart(range);

    /* ---------------- SUMMARY (with advanced metrics) ---------------- */
    if (type === 'summary') {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

      const [
        uv, ss, pv, cl, avgRow,
        activeRow, bounced, newVs, avgPerSession,
      ] = await Promise.all([
        Visitor.countDocuments({ last_seen: { $gte: start } }),
        Session.countDocuments({ started_at: { $gte: start } }),
        PageView.countDocuments({ timestamp: { $gte: start } }),
        Activity.countDocuments({ type: 'click', timestamp: { $gte: start } }),
        Session.aggregate([
          { $match: { started_at: { $gte: start } } },
          { $group: { _id: null, avg: { $avg: '$duration_ms' } } },
        ]),
        // Active now — distinct visitors with a pageview in last 5 min
        PageView.aggregate([
          { $match: { timestamp: { $gte: fiveMinAgo } } },
          { $group: { _id: '$visitor_id' } },
          { $count: 'n' },
        ]),
        // Bounce: sessions with ≤ 1 pageview
        Session.countDocuments({ started_at: { $gte: start }, page_views: { $lte: 1 } }),
        // New vs Returning
        Promise.all([
          Visitor.countDocuments({ first_seen: { $gte: start }, last_seen: { $gte: start } }),
          Visitor.countDocuments({ last_seen: { $gte: start } }),
        ]),
        // Avg pages / clicks per session
        Session.aggregate([
          { $match: { started_at: { $gte: start } } },
          { $group: { _id: null, avgPages: { $avg: '$page_views' }, avgClicks: { $avg: '$clicks' } } },
        ]),
      ]);

      return res.json({
        uniqueVisitors: uv,
        sessions: ss,
        pageViews: pv,
        clicks: cl,
        avgSessionMs: Math.round(avgRow[0]?.avg || 0),
        activeNow: activeRow[0]?.n || 0,
        bounceRate: ss ? bounced / ss : 0,
        newVisitors: newVs[0],
        returningVisitors: Math.max(0, newVs[1] - newVs[0]),
        avgPagesPerSession: +(avgPerSession[0]?.avgPages || 0).toFixed(2),
        avgClicksPerSession: +(avgPerSession[0]?.avgClicks || 0).toFixed(2),
      });
    }

    /* ---------------- TIMESERIES ---------------- */
    if (type === 'timeseries') {
      const rows = await PageView.aggregate([
        { $match: { timestamp: { $gte: start } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            pageViews: { $sum: 1 },
            visitors: { $addToSet: '$visitor_id' },
          },
        },
        { $project: { _id: 0, date: '$_id', pageViews: 1, visitors: { $size: '$visitors' } } },
        { $sort: { date: 1 } },
      ]);
      return res.json(rows);
    }

    /* ---------------- VISITORS LIST ---------------- */
    if (type === 'visitors') {
      const q = (req.query.q || '').trim();
      const filter = { last_seen: { $gte: start } };
      if (q) {
        const like = new RegExp(q, 'i');
        filter.$or = [
          { ip: like }, { browser: like }, { os: like },
          { device: like }, { visitor_id: like },
        ];
      }

      const visitors = await Visitor.find(filter).sort({ last_seen: -1 }).limit(500).lean();
      const ids = visitors.map((v) => v.visitor_id);
      const agg = await Session.aggregate([
        { $match: { visitor_id: { $in: ids }, started_at: { $gte: start } } },
        {
          $group: {
            _id: '$visitor_id',
            sessions: { $sum: 1 },
            pages: { $sum: '$page_views' },
            clicks: { $sum: '$clicks' },
          },
        },
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

    /* ---------------- SINGLE VISITOR ---------------- */
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
        sessions: sessions.map((s) => ({
          ...strip(s), landing_page: s.landing, exit_page: s.exit,
        })),
        pageViews: pageViews.map(strip),
        activities: activities.map(strip),
      });
    }

    /* ---------------- BREAKDOWNS (with advanced) ---------------- */
    if (type === 'breakdowns') {
      const [devices, browsers, os, topPages,
             referrers, entryPages, exitPages, hourly] = await Promise.all([
        Visitor.aggregate([
          { $match: { last_seen: { $gte: start } } },
          { $group: { _id: '$device', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: { $gte: start } } },
          { $group: { _id: '$browser', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Visitor.aggregate([
          { $match: { last_seen: { $gte: start } } },
          { $group: { _id: '$os', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        PageView.aggregate([
          { $match: { timestamp: { $gte: start } } },
          { $group: { _id: '$path', views: { $sum: 1 }, unique: { $addToSet: '$visitor_id' } } },
          { $project: { _id: 1, views: 1, unique: { $size: '$unique' } } },
          { $sort: { views: -1 } },
          { $limit: 15 },
        ]),
        // Top Referrers
        PageView.aggregate([
          { $match: { timestamp: { $gte: start }, ref_host: { $nin: ['', null] } } },
          { $group: { _id: '$ref_host', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),
        // Entry Pages
        Session.aggregate([
          { $match: { started_at: { $gte: start } } },
          { $group: { _id: '$landing', views: { $sum: 1 }, unique: { $addToSet: '$visitor_id' } } },
          { $project: { _id: 1, views: 1, unique: { $size: '$unique' } } },
          { $sort: { views: -1 } },
          { $limit: 10 },
        ]),
        // Exit Pages
        Session.aggregate([
          { $match: { started_at: { $gte: start } } },
          { $group: { _id: '$exit', views: { $sum: 1 }, unique: { $addToSet: '$visitor_id' } } },
          { $project: { _id: 1, views: 1, unique: { $size: '$unique' } } },
          { $sort: { views: -1 } },
          { $limit: 10 },
        ]),
        // Hourly activity (24 buckets)
        PageView.aggregate([
          { $match: { timestamp: { $gte: start } } },
          { $group: { _id: { $hour: '$timestamp' }, count: { $sum: 1 } } },
          { $project: { _id: 0, hour: '$_id', count: 1 } },
          { $sort: { hour: 1 } },
        ]),
      ]);

      // Fill missing hours with 0
      const hourlyFull = Array.from({ length: 24 }, (_, h) =>
        hourly.find((r) => r.hour === h) || { hour: h, count: 0 }
      );

      return res.json({
        devices, browsers, os, topPages,
        referrers, entryPages, exitPages,
        hourly: hourlyFull,
        countries: [], cities: [],
      });
    }

    return res.status(400).json({ error: 'Unknown type' });
  } catch (err) {
    console.error('[analytics] error:', err);
    return res.status(500).json({ error: 'Failed to load analytics' });
  }
});

module.exports = router;