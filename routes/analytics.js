const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

/* ============================================================
   MODELS — optimized for minimum size
   ============================================================ */

// TTL: auto-delete docs older than 90 days (in seconds)
const TTL_90D = 90 * 24 * 60 * 60;

const Visitor = mongoose.models.Visitor || mongoose.model('Visitor', new mongoose.Schema({
  visitor_id: { type: String, required: true, unique: true, index: true },
  ip:         { type: String, default: '' },
  device:     { type: String, default: 'desktop' },  // 'mobile' | 'tablet' | 'desktop'
  browser:    { type: String, default: 'Other' },    // 'Chrome' | 'Safari' | ...
  os:         { type: String, default: 'Other' },    // 'Windows' | 'macOS' | ...
  sw:         { type: Number, default: null },       // screen width
  sh:         { type: Number, default: null },       // screen height
  vw:         { type: Number, default: null },       // viewport width
  vh:         { type: Number, default: null },       // viewport height
  first_seen: { type: Date, default: Date.now },
  last_seen:  { type: Date, default: Date.now, index: true, expires: TTL_90D },
}));

const Session = mongoose.models.Session || mongoose.model('Session', new mongoose.Schema({
  session_id:  { type: String, required: true, unique: true, index: true },
  visitor_id:  { type: String, required: true, index: true },
  landing:     { type: String, default: '/' },
  exit:        { type: String, default: '/' },
  ref_host:    { type: String, default: '' },        // referrer hostname only
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
  ref_host:   { type: String, default: '' },         // hostname only
  timestamp:  { type: Date, default: Date.now, index: true, expires: TTL_90D },
}));

const Activity = mongoose.models.Activity || mongoose.model('Activity', new mongoose.Schema({
  visitor_id:  { type: String, required: true, index: true },
  session_id:  { type: String, required: true, index: true },
  type:        { type: String, required: true, index: true },
  path:        { type: String, default: '' },
  element:     { type: String, default: '' },        // 'a' | 'button' | ...
  text:        { type: String, default: '' },        // truncated to 60 chars
  destination: { type: String, default: '' },        // path only
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
  if (/windows/i.test(l))                    os = 'Windows';
  else if (/mac os|macintosh/i.test(l))      os = 'macOS';
  else if (/android/i.test(l))               os = 'Android';
  else if (/iphone|ipad|ipod/i.test(l))      os = 'iOS';
  else if (/linux/i.test(l))                 os = 'Linux';

  return { device, browser, os };
};

// Extract just the hostname from a referrer URL — saves ~80% of the string
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
      // Visitor — shorter field names (sw/sh/vw/vh), no user_agent
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
        title: (title || '').slice(0, 120),          // cap title length
        ref_host: hostOf(referrer),
        timestamp: new Date(),
      });
    } else if (type === 'click') {
      // Trim text to 60 chars, destination to path only
      const dest = (() => {
        try { return new URL(destination).pathname; } catch { return destination || ''; }
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
        { $inc: { clicks: 1 }, $set: { ended_at: new Date() } }
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

    if (type === 'summary') {
      const [uv, ss, pv, cl, avgRow] = await Promise.all([
        Visitor.countDocuments({ last_seen: { $gte: start } }),
        Session.countDocuments({ started_at: { $gte: start } }),
        PageView.countDocuments({ timestamp: { $gte: start } }),
        Activity.countDocuments({ type: 'click', timestamp: { $gte: start } }),
        Session.aggregate([
          { $match: { started_at: { $gte: start } } },
          { $group: { _id: null, avg: { $avg: '$duration_ms' } } },
        ]),
      ]);
      return res.json({
        uniqueVisitors: uv, sessions: ss, pageViews: pv, clicks: cl,
        avgSessionMs: Math.round(avgRow[0]?.avg || 0),
      });
    }

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

      // Remap short field names back to the long ones the UI expects
      return res.json(visitors.map((v) => ({
        ...strip(v),
        screen_w:   v.sw, screen_h: v.sh,
        viewport_w: v.vw, viewport_h: v.vh,
        sessions:   aggMap[v.visitor_id]?.sessions || 0,
        pages:      aggMap[v.visitor_id]?.pages    || 0,
        clicks:     aggMap[v.visitor_id]?.clicks   || 0,
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
        sessions: sessions.map((s) => ({
          ...strip(s),
          landing_page: s.landing,
          exit_page: s.exit,
        })),
        pageViews: pageViews.map(strip),
        activities: activities.map(strip),
      });
    }

    if (type === 'breakdowns') {
      const [devices, browsers, os, topPages] = await Promise.all([
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
      ]);

      return res.json({
        devices, browsers, os,
        countries: [], cities: [], topPages, referrers: [],
      });
    }

    return res.status(400).json({ error: 'Unknown type' });
  } catch (err) {
    console.error('[analytics] error:', err);
    return res.status(500).json({ error: 'Failed to load analytics' });
  }
});

module.exports = router;