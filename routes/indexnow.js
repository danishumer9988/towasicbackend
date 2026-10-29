const express = require('express')
const router = express.Router()

/* Replace this with your IndexNow key from indexnow.org */
const INDEXNOW_KEY = 'REPLACE-WITH-YOUR-INDEXNOW-KEY'
const HOST = 'towasicsolutions.com'
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`

/**
 * POST /api/indexnow/notify
 * body: { urls: ['https://towasicsolutions.com/blogs/my-post'] }
 *
 * Notifies Bing/Yandex/etc. that these URLs changed → they re-crawl instantly.
 */
router.post('/notify', async (req, res) => {
  const { urls } = req.body || {}
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'No URLs provided' })
  }

  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: HOST,
        key: INDEXNOW_KEY,
        keyLocation: KEY_LOCATION,
        urlList: urls,
      }),
    })
    res.json({ ok: true, status: response.status, urls })
  } catch (err) {
    console.error('[indexnow] error:', err)
    res.status(500).json({ ok: false, error: err.message })
  }
})

module.exports = router