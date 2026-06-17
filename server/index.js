const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { exec } = require('child_process');
const { marked } = require('marked');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Config ──
const OUTPUT_DIR = path.resolve(__dirname, '..', 'output');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ''; // 可選：GitHub webhook secret

// ── Middleware ──
app.use(express.json());

// ── Helpers ──

/** Parse a filename like "2026-06-18-孕36周.md" or "2026-06-18-孕36周-简化版.txt"
 *  → { date: '2026-06-18', week: 36 } or null */
function parseFilename(file) {
  const m = file.match(/^(\d{4}-\d{2}-\d{2})-孕(\d+)周/);
  if (!m) return null;
  return { date: m[1], week: parseInt(m[2], 10) };
}

/** Read all full meal plan .md files from disk, sorted by date desc */
function getAllMealPlans() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  const files = fs.readdirSync(OUTPUT_DIR);
  const plans = files
    .filter(f => f.endsWith('.md'))  // only full markdown plans, not -简化版.txt
    .map(f => {
      const info = parseFilename(f);
      if (!info) return null;
      return { ...info, filename: f, filepath: path.join(OUTPUT_DIR, f) };
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));
  return plans;
}

/** Render markdown to HTML with customisation */
function renderMarkdown(raw) {
  let html = marked.parse(raw, {
    breaks: true,
    gfm: true,
  });

  // Add anchor IDs to 午餐/晚餐 section headings for jump navigation
  html = html
    .replace(/<h2>(.*?午餐.*?)<\/h2>/g, '<h2 id="section-lunch">$1</h2>')
    .replace(/<h2>(.*?晚餐.*?)<\/h2>/g, '<h2 id="section-dinner">$1</h2>');

  return html;
}

/** Preprocess simplified text to add markdown formatting for nicer rendering */
function preprocessSimplified(text) {
  return text
    // Convert ══════ title underline → h1 heading (keep the title, drop the ══ line)
    .replace(/^(.+)\n═+$/m, '# $1')
    // Convert ──── section headers ──── → h2 headings
    .replace(/^─{3,}\s*(.+?)\s*─{3,}$/gm, '## $1')
    // Convert 【dish name】 → bold
    .replace(/【(.+?)】/g, '**$1**');
}

// ── API Routes ──

/** GET /api/dates — list available dates */
app.get('/api/dates', (req, res) => {
  const plans = getAllMealPlans().map(p => ({
    date: p.date,
    week: p.week,
    label: `${p.date} · 孕${p.week}周`,
  }));
  res.json(plans);
});

/** GET /api/meal-plan/:date — get full meal plan for a date */
app.get('/api/meal-plan/:date', (req, res) => {
  const { date } = req.params;

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
  }

  const plans = getAllMealPlans();
  const plan = plans.find(p => p.date === date);

  if (!plan) {
    return res.status(404).json({ error: `No meal plan found for ${date}` });
  }

  const raw = fs.readFileSync(plan.filepath, 'utf-8');
  const html = renderMarkdown(raw);

  res.json({
    date: plan.date,
    week: plan.week,
    html,
    raw,
  });
});

/** GET /api/meal-plan/:date/simplified — get simplified version (rendered as HTML) */
app.get('/api/meal-plan/:date/simplified', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format.' });
  }

  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith(date) && f.endsWith('-简化版.txt'));
  if (files.length === 0) {
    return res.status(404).json({ error: `No simplified version for ${date}` });
  }

  const info = parseFilename(files[0]);
  const raw = fs.readFileSync(path.join(OUTPUT_DIR, files[0]), 'utf-8');
  const html = renderMarkdown(preprocessSimplified(raw));
  res.json({ date, week: info?.week ?? null, html, text: raw });
});

/** GET /api/network-info — detect LAN IP for display */
app.get('/api/network-info', (req, res) => {
  const os = require('os');
  const nets = os.networkInterfaces();
  let ip = '127.0.0.1';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // Match common private IPv4 ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
      if (net.family === 'IPv4' && !net.internal) {
        const a = net.address.split('.').map(Number);
        if (a[0] === 10 || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && a[1] === 168)) {
          ip = net.address;
          break;
        }
      }
    }
    if (ip !== '127.0.0.1') break;
  }
  res.json({ ip, port: PORT });
});

/** POST /api/webhook — GitHub push 事件 → 自動 git pull + 重啟 */
app.post('/api/webhook', (req, res) => {
  // 驗證 GitHub webhook signature（如有設定 secret）
  if (WEBHOOK_SECRET) {
    const sig = req.headers['x-hub-signature-256'] || '';
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
    const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest))) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } catch {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // 只處理 push 事件
  const event = req.headers['x-github-event'];
  if (event !== 'push') {
    return res.json({ status: 'ignored', message: `Event: ${event}` });
  }

  res.json({ status: 'ok', message: 'Webhook received, pulling...' });

  const repoDir = path.resolve(__dirname, '..');
  exec('git pull origin main', { cwd: repoDir }, (err, stdout, stderr) => {
    if (err) {
      console.error('[webhook] git pull failed:', stderr);
      return;
    }
    const msg = stdout.trim();
    console.log('[webhook]', msg);

    if (!msg.includes('Already up to date')) {
      console.log('[webhook] 檢測到更新，3秒後重啟 server...');
      setTimeout(() => {
        console.log('[webhook] 正在重啟...');
        process.exit(0); // pm2 會自動重啟
      }, 3000);
    }
  });
});

// ── Static files ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Start ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🍽️  Eat What TMR — Meal Plan Viewer`);
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   Network:  http://0.0.0.0:${PORT}`);
  console.log(`   Plans found: ${getAllMealPlans().length}`);
});
