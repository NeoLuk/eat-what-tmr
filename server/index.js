const express = require('express');
const path = require('path');
const fs = require('fs');
const { marked } = require('marked');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Config ──
const OUTPUT_DIR = path.resolve(__dirname, '..', 'output');

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

  // Add anchor IDs to section headings for jump navigation
  html = html
    .replace(/<h2>(.*?午餐.*?)<\/h2>/g, '<h2 id="section-lunch">$1</h2>')
    .replace(/<h2>(.*?晚餐.*?)<\/h2>/g, '<h2 id="section-dinner">$1</h2>')
    .replace(/<h2>(.*?總結.*?)<\/h2>/g, '<h2 id="section-summary">$1</h2>');

  // Wrap each dish (h3 → next h3 / h2 / hr) in a card for visual grouping
  // 跳過營養總覽，不包卡片
  html = html.replace(
    /(<h3[^>]*>[\s\S]*?<\/h3>[\s\S]*?)(?=<h[23][^>]*>|<hr\b|$)/g,
    (match) => {
      if (match.includes('營養總覽')) return match;
      return '<div class="dish-card">' + match + '</div>';
    }
  );

  // Remove <hr> between consecutive dish cards so they can be grouped into tabs
  html = html.replace(
    /<\/div>\s*<hr\s*\/?>\s*<div class="dish-card">/g,
    '</div><div class="dish-card">'
  );

  // Group consecutive dish cards into tab containers (per meal)
  html = html.replace(
    /((?:<div class="dish-card">[\s\S]*?<\/div>\s*)+)(?=<hr|<h[23]|$)/g,
    (match) => {
      const cards = match.match(/<div class="dish-card">[\s\S]*?<\/div>/g);
      if (!cards || cards.length <= 1) return match;

      const titles = cards.map(card => {
        const m = card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
        return m ? m[1].trim() : '';
      });

      const nav = titles.map((t, i) =>
        `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="t${i}">${t}</button>`
      ).join('');

      const panels = cards.map((c, i) =>
        `<div class="tab-panel${i === 0 ? ' active' : ''}" data-tab="t${i}">${c}</div>`
      ).join('');

      return `<div class="meal-tabs"><div class="tab-nav">${nav}</div><div class="tab-panels">${panels}</div></div>`;
    }
  );

  return html;
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
  const mtime = fs.statSync(plan.filepath).mtime;

  res.json({
    date: plan.date,
    week: plan.week,
    html,
    raw,
    modifiedAt: mtime.toISOString(),
  });
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

// ── Static files ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Start ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🍽️  Eat What TMR — Meal Plan Viewer`);
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   Network:  http://0.0.0.0:${PORT}`);
  console.log(`   Plans found: ${getAllMealPlans().length}`);
});
