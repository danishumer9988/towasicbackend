const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

/* ============================================================
   MODELS (defined inline — no separate model files)
   ============================================================ */

const Visitor = mongoose.models.Visitor || mongoose.model('Visitor', new mongoose.Schema({
  visitor_id: { type: String, required: true, unique: true, index: true },
  ip:         { type: String, default: '' },
  user_agent: { type: String, default: '' },
  device:     { type: String, default: 'desktop' },
  browser:    { type: String, default: 'Other' },
  os:         { type: String, default: 'Other' },
  screen_w:   { type: Number, default: null },
  screen_h:   { type: Number, default: null },
  viewport_w: { type: Number, default: null },
  viewport_h: { type: Number, default: null },
  first_seen: { type: Date, default: Date.now },
  last_seen:  { type: Date, default: Date.now, index: true },
}));

const Session = mongoose.models.Session || mongoose.model('Session', new mongoose.Schema({
  session_id:   { type: String, required: true, unique: true, index: true },
  visitor_id:   { type: String, required: true, index: true },
  landing_page: { type: String, default: '/' },
  exit_page:    { type: String, default: '/' },
  referrer:     { type: String, default: '' },
  page_views:   { type: Number, default: 1 },
  clicks:       { type: Number, default: 0 },
  duration_ms:  { type: Number, default: 0 },
  started_at:   { type: Date, default: Date.now, index: true },
  ended_at:     { type: Date, default: Date.now },
}));

const PageView = mongoose.models.PageView || mongoose.model('PageView', new mongoose.Schema({
  visitor_id: { type: String, required: true, index: true },
  session_id: { type: String, required: true, index: true },
  url:        { type: String, default: '' },
  path:       { type: String, default: '/', index: true },
  title:      { type: String, default: '' },
  referrer:   { type: String, default: '' },
  timestamp:  { type: Date, default: Date.now, index: true },
}));

const Activity = mongoose.models.Activity || mongoose.model('Activity', new mongoose.Schema({
  visitor_id:  { type: String, required: true, index: true },
  session_id:  { type: String, required: true, index: true },
  type:        { type: String, required: true, index: true },
  path:        { type: String, default: '' },
  url:         { type: String, default: '' },
  element:     { type: String, default: '' },
  text:        { type: String, default: '' },
  destination: { type: String, default: '' },
  timestamp:   { type: Date, default: Date.now, index: true },
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
   POST /api/track   (called by the frontend tracker)
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
            ip, user_agent: ua, device, browser, os,
            screen_w:   screen?.w   ?? null,
            screen_h:   screen?.h   ?? null,
            viewport_w: viewport?.w ?? null,
            viewport_h: viewport?.h ?? null,
            last_seen:  new Date(),
          },
          $setOnInsert: { visitor_id: visitorId, first_seen: new Date() },
        },
        { upsert: true, new: true }
      );

      const existing = await Session.findOne({ session_id: sessionId }).lean();
      if (!existing) {
        await Session.create({
          session_id: sessionId, visitor_id: visitorId,
          landing_page: path || '/', exit_page: path || '/',
          referrer: referrer || '', page_views: 1, clicks: 0,
          duration_ms: 0, started_at: new Date(), ended_at: new Date(),
        });
      } else {
        const lastTs = existing.ended_at ? new Date(existing.ended_at).getTime() : Date.now();
        const idleMs = Math.min(Date.now() - lastTs, 30 * 60 * 1000);
        const duration = (existing.duration_ms || 0) + (idleMs > 0 ? idleMs : 0);
        await Session.updateOne(
          { session_id: sessionId },
          { $set: { ended_at: new Date(), duration_ms: duration, exit_page: path || '/' }, $inc: { page_views: 1 } }
        );
      }

      await PageView.create({
        visitor_id: visitorId, session_id: sessionId,
        url: url || '', path: path || '/', title: title || '',
        referrer: referrer || '', timestamp: new Date(),
      });
    } else if (type === 'click') {
      await Activity.create({
        visitor_id: visitorId, session_id: sessionId, type: 'click',
        path: path || '', url: url || '', element: element || '',
        text: text || '', destination: destination || '', timestamp: new Date(),
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

      return res.json(visitors.map((v) => ({
        ...strip(v),
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
        visitor: strip(visitor),
        sessions: sessions.map(strip),
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