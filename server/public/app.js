/* ── State ── */
let state = {
  dates: [],          // [{ date, week, label }] sorted desc
  currentIndex: 0,    // index into dates
  view: 'full',       // 'full' | 'simplified'
  isLoading: false,
};

/* ── DOM References ── */
const $ = id => document.getElementById(id);
const dom = {
  loading: $('loading'),
  error: $('error'),
  errorMessage: $('errorMessage'),
  retryBtn: $('retryBtn'),
  content: $('content'),
  datePicker: $('datePicker'),
  weekLabel: $('weekLabel'),
  prevBtn: $('prevBtn'),
  nextBtn: $('nextBtn'),
  dateList: $('dateList'),
  dateListToggle: $('dateListToggle'),
  toggleArrow: $('dateListToggle').querySelector('.toggle-arrow'),
  viewFull: $('viewFullBtn'),
  viewSimplified: $('viewSimplifiedBtn'),
  networkBadge: $('networkBadge'),
  footerDate: $('footerDate'),
  sectionNav: $('sectionNav'),
  sectionBtns: document.querySelectorAll('.section-btn'),
};

/* ── Helpers ── */

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  return `${dateStr}（${days[d.getDay()]}）`;
}

function showLoading() {
  dom.loading.classList.add('active');
  dom.error.classList.remove('active');
  dom.content.innerHTML = '';
}

function hideLoading() {
  dom.loading.classList.remove('active');
}

function showError(msg) {
  hideLoading();
  dom.error.classList.add('active');
  dom.errorMessage.textContent = msg;
}

function hideError() {
  dom.error.classList.remove('active');
}

/* ── Network info (show IP) ── */
async function updateNetworkInfo() {
  try {
    const resp = await fetch('/api/network-info');
    const data = await resp.json();
    if (data.ip) {
      dom.networkBadge.textContent = `內網: ${data.ip}:${data.port}`;
    }
  } catch {
    // fallback: keep badge as-is
  }
}

/* ── Load dates from API ── */
async function loadDates() {
  const resp = await fetch('/api/dates');
  if (!resp.ok) throw new Error('無法載入日期列表');
  const dates = await resp.json();
  if (dates.length === 0) throw new Error('還沒有任何菜譜記錄');
  state.dates = dates;
  return dates;
}

/* ── Load meal plan for a date ── */
async function loadMealPlan(date, view) {
  const endpoint = view === 'simplified'
    ? `/api/meal-plan/${date}/simplified`
    : `/api/meal-plan/${date}`;

  const resp = await fetch(endpoint);
  if (!resp.ok) {
    if (resp.status === 404) throw new Error(`${formatDate(date)} 還沒有菜譜`);
    throw new Error('載入失敗，請稍後重試');
  }
  return resp.json();
}

/* ── Render meal plan ── */
function renderFull(html) {
  return `<div class="content-inner">${html}</div>`;
}

/* ── Navigate to a specific date ── */
async function goToDate(dateStr) {
  showLoading();
  hideError();

  try {
    const data = await loadMealPlan(dateStr, state.view);

    dom.datePicker.value = dateStr;

    // Derive week from API response or fall back to our dates list
    const week = data.week ?? state.dates.find(d => d.date === dateStr)?.week;
    dom.weekLabel.textContent = week ? `孕${week}周` : '';
    dom.footerDate.textContent = formatDate(dateStr);

    dom.content.innerHTML = renderFull(data.html);

    // Show section jump nav if content has anchored sections
    const hasLunch = document.getElementById('section-lunch');
    const hasDinner = document.getElementById('section-dinner');
    dom.sectionNav.hidden = !(hasLunch || hasDinner);

    // Update nav button states
    const idx = state.dates.findIndex(d => d.date === dateStr);
    state.currentIndex = idx >= 0 ? idx : 0;
    updateNavButtons();

    // Highlight active date in list
    document.querySelectorAll('.date-list a').forEach(a => {
      a.classList.toggle('active', a.dataset.date === dateStr);
    });

    hideLoading();
  } catch (err) {
    hideLoading();
    showError(err.message);
  }
}

/* ── Update nav buttons ── */
function updateNavButtons() {
  dom.prevBtn.disabled = state.currentIndex >= state.dates.length - 1;
  dom.nextBtn.disabled = state.currentIndex <= 0;
}

/* ── Switch view (full / simplified) ── */
async function switchView(view) {
  state.view = view;
  dom.viewFull.classList.toggle('active', view === 'full');
  dom.viewSimplified.classList.toggle('active', view === 'simplified');

  const currentDate = dom.datePicker.value;
  if (currentDate) {
    await goToDate(currentDate);
  }
}

/* ── Build date list sidebar ── */
function buildDateList(dates) {
  dom.dateList.innerHTML = '';
  dates.forEach(d => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#';
    a.dataset.date = d.date;
    a.textContent = `${d.label}`;
    a.addEventListener('click', e => {
      e.preventDefault();
      goToDate(d.date);
      // Close the list on mobile
      dom.dateList.classList.remove('open');
      dom.toggleArrow.classList.remove('open');
    });
    li.appendChild(a);
    dom.dateList.appendChild(li);
  });
}

/* ── Init ── */
async function init() {
  showLoading();

  try {
    // Update network badge (non-blocking)
    updateNetworkInfo();

    const dates = await loadDates();
    buildDateList(dates);

    // Go to latest date
    const latest = dates[0];
    await goToDate(latest.date);

    // Set date picker min/max and event
    const lastDate = dates[0].date;
    const firstDate = dates[dates.length - 1].date;

    dom.datePicker.addEventListener('change', () => {
      const picked = dom.datePicker.value;
      if (dates.some(d => d.date === picked)) {
        goToDate(picked);
      } else {
        showError(`${picked} 還沒有菜譜記錄`);
      }
    });
  } catch (err) {
    hideLoading();
    showError(err.message);
  }
}

/* ── Event Listeners ── */

// Prev / Next buttons
dom.prevBtn.addEventListener('click', () => {
  if (state.currentIndex < state.dates.length - 1) {
    goToDate(state.dates[state.currentIndex + 1].date);
  }
});

dom.nextBtn.addEventListener('click', () => {
  if (state.currentIndex > 0) {
    goToDate(state.dates[state.currentIndex - 1].date);
  }
});

// Date list toggle
dom.dateListToggle.addEventListener('click', () => {
  dom.dateList.classList.toggle('open');
  dom.toggleArrow.classList.toggle('open');
});

// View toggle
dom.viewFull.addEventListener('click', () => switchView('full'));
dom.viewSimplified.addEventListener('click', () => switchView('simplified'));

// Retry button
dom.retryBtn.addEventListener('click', () => {
  const currentDate = dom.datePicker.value;
  if (currentDate) goToDate(currentDate);
  else init();
});

// Section jump buttons — smooth scroll to anchored heading
dom.sectionBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const section = document.getElementById('section-' + btn.dataset.section);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' && !dom.prevBtn.disabled) {
    dom.prevBtn.click();
  }
  if (e.key === 'ArrowRight' && !dom.nextBtn.disabled) {
    dom.nextBtn.click();
  }
});

/* ── Start ── */
init();
