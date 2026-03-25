/**
 * Frontend JavaScript для Avito Price Monitoring Dashboard
 */

const API_BASE = `${window.location.origin}/api`;

const state = {
  avitoSources: [],
  monitoringResults: null,
  parseResult: null,
  appliedChanges: null,
  selectedPriceChanges: new Set(),
  selectedRemoved: new Set(),
  avitoCheckResults: {}, // {id: {removed, error}}
  avitoCheckPolling: null,
  selectedBackOnSale: new Set(),
  currentPage: {
    priceChanges: 1,
    removed: 1,
    newItems: 1,
    backOnSale: 1,
    actualize: 1
  },
  itemsPerPage: 20,
  searchQuery: {
    priceChanges: '',
    removed: '',
    newItems: '',
    backOnSale: '',
    actualize: ''
  },
  sortPriceChanges: { dir: null }, // null | 'asc' | 'desc'
  nacenka: {
    items: [],       // все загруженные строки (с учётом фильтров)
    edited: {},      // { id: nacenkaValue } — изменённые пользователем
    currentPage: 1
  },
  lastMonitoringAlias: null,
  resultAlias: null       // псевдоним, для которого показаны результаты в секциях изменения цен
};

// ============================================================================
// API Wrapper Functions
// ============================================================================

async function apiRequest(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    const text = await response.text();
    const isJson = response.headers.get('content-type')?.includes('application/json');
    if (!isJson || (text && text.trim().startsWith('<'))) {
      if (!response.ok) {
        throw new Error('Сервер вернул не JSON (возможно HTML). Убедитесь, что на этом порту запущен дашборд Avito Monitor и перезапустите сервер.');
      }
      throw new Error('Сервер вернул не JSON. Перезапустите сервер дашборда.');
    }
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const msg = data?.details ? `${data.error}: ${data.details}` : (data?.error || 'API request failed');
      throw new Error(msg);
    }
    return data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Сервер вернул не JSON. Перезапустите сервер дашборда (npm start в папке price-monitoring).');
    }
    console.error('API Error:', error);
    throw error;
  }
}

// ============================================================================
// Navigation
// ============================================================================

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.section');
  
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetSection = item.dataset.section;
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      sections.forEach(section => section.classList.remove('active'));
      document.getElementById(targetSection).classList.add('active');
      // Глобальные вкладки alias (мониторинг) скрываем в разделах без них
      const sectionsWithoutAliasTabs = new Set(['add-items', 'settings', 'nacenka', 'applied-changes', 'avito-upload']);
      const aliasTabsEl = document.getElementById('result-alias-tabs');
      if (aliasTabsEl) aliasTabsEl.style.display = sectionsWithoutAliasTabs.has(targetSection) ? 'none' : '';

      if (targetSection === 'applied-changes') { loadAppliedChanges(); loadSyncTables(); }
      if (targetSection === 'avito-upload') { loadAvitoSettings(); }
      if (targetSection === 'nacenka') {
        // Сбрасываем фильтры при входе только если данных нет
        if (state.nacenka.items.length === 0) {
          ['nacenka-filter-maker','nacenka-filter-model','nacenka-filter-diam'].forEach(fid => {
            const el = document.getElementById(fid);
            if (el) el.value = '';
          });
        }
      }
    });
  });
}

// ============================================================================
// Settings Section
// ============================================================================

const ALIAS_COLORS = ['#f59e0b','#3b82f6','#10b981','#f43f5e','#a78bfa','#fb923c'];

function applyAliasColor() {
  const aliases = state.avitoSources.map(s => s.alias);
  const idx = state.resultAlias ? aliases.indexOf(state.resultAlias) : -1;
  const color = idx >= 0 ? ALIAS_COLORS[idx % ALIAS_COLORS.length] : null;
  const resultSections = ['price-changes','removed','back-on-sale'].map(id => document.getElementById(id));
  resultSections.forEach(el => {
    if (!el) return;
    if (color) {
      el.style.setProperty('--active-alias-color', color);
      el.classList.add('alias-colored');
    } else {
      el.style.removeProperty('--active-alias-color');
      el.classList.remove('alias-colored');
    }
  });
}

function renderResultAliasTabs() {
  const container = document.getElementById('result-alias-tabs');
  if (!container) return;
  const aliases = state.avitoSources.map(s => s.alias);
  if (aliases.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  container.innerHTML = aliases.map((alias, i) =>
    `<button class="section-tab-btn${state.resultAlias === alias ? ' active' : ''}" data-result-alias="${alias}" data-color="${i % 6}">${alias}</button>`
  ).join('');
  container.querySelectorAll('[data-result-alias]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.resultAlias = btn.dataset.resultAlias;
      renderResultAliasTabs();
      applyAliasColor();
      loadStoredMonitoringResults();
    });
  });
  applyAliasColor();
}

function fillSourceSelects() {
  const options = state.avitoSources.map(s => {
    const opt = document.createElement('option');
    opt.value = s.alias;
    opt.textContent = s.alias;
    return opt;
  });
  const selectActualize = document.getElementById('actualize-alias-select');
  if (!selectActualize) return;
  selectActualize.innerHTML = '';
  if (options.length === 0) {
    selectActualize.innerHTML = '<option value="">Нет источников. Добавьте в Настройках.</option>';
  } else {
    options.forEach(opt => selectActualize.appendChild(opt));
  }
  renderResultAliasTabs();
}

function renderSourcesList() {
  const ul = document.getElementById('sources-list');
  ul.innerHTML = state.avitoSources.map(s => `
    <li data-id="${s.id}">
      <span class="source-alias">${escapeHtml(s.alias)}</span>
      <span class="source-url" title="${escapeHtml(s.url)}">${escapeHtml(s.url.substring(0, 50))}…</span>
      <button type="button" class="btn btn-danger source-delete">Удалить</button>
    </li>
  `).join('');
  ul.querySelectorAll('.source-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('li').dataset.id;
      state.avitoSources = state.avitoSources.filter(s => s.id !== id);
      renderSourcesList();
      fillSourceSelects();
      await persistSources();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadAvitoSources() {
  try {
    const data = await apiRequest('/config/avito-urls');
    state.avitoSources = data.avitoSources || [];
    fillSourceSelects();
    renderSourcesList();
  } catch (error) {
    console.error('Error loading sources:', error);
    showStatus('sources-status', 'Ошибка загрузки источников', 'error');
  }
}

async function loadConfig() {
  try {
    const config = await apiRequest('/config');
    state.avitoSources = config.avitoSources || [];
    fillSourceSelects();
    renderSourcesList();
    document.getElementById('config-api-url').value = config.siteApiUrl || '';
    document.getElementById('config-db-path').value = config.dbPath || '';
    if (config.sshHost)    document.getElementById('ssh-host').value    = config.sshHost;
    if (config.sshPort)    document.getElementById('ssh-port').value    = config.sshPort;
    if (config.sshUser)    document.getElementById('ssh-user').value    = config.sshUser;
    if (config.sshDbPath)       document.getElementById('ssh-db-path').value       = config.sshDbPath;
    if (config.localSiteDbPath) document.getElementById('local-site-db-path').value = config.localSiteDbPath;
  } catch (error) {
    console.error('Error loading config:', error);
  }
}

async function saveSshConfig() {
  const config = {
    avitoSources: state.avitoSources,
    siteApiUrl: document.getElementById('config-api-url').value.trim(),
    dbPath: document.getElementById('config-db-path').value.trim(),
    sshHost:    document.getElementById('ssh-host').value.trim(),
    sshPort:    parseInt(document.getElementById('ssh-port').value) || 22,
    sshUser:    document.getElementById('ssh-user').value.trim(),
    sshKeyPath:      document.getElementById('ssh-key-path').value.trim(),
    sshDbPath:       document.getElementById('ssh-db-path').value.trim(),
    localSiteDbPath: document.getElementById('local-site-db-path').value.trim()
  };
  try {
    await apiRequest('/config', { method: 'PUT', body: JSON.stringify(config) });
    showStatus('ssh-status', '✅ SSH настройки сохранены', 'success');
  } catch (e) {
    showStatus('ssh-status', `Ошибка: ${e.message}`, 'error');
  }
}

async function testSshConnection() {
  showStatus('ssh-status', 'Проверяю соединение...', 'loading');
  try {
    const data = await apiRequest('/site-db/test', { method: 'POST' });
    showStatus('ssh-status', `✅ ${data.message}`, 'success');
  } catch (e) {
    showStatus('ssh-status', `❌ ${e.message}`, 'error');
  }
}

// ── БД сайта: синхронизация таблиц через SSH ─────────────────────────────────
async function loadSyncTables() {
  try {
    const data = await apiRequest('/site-db/tables');
    const container = document.getElementById('sync-tables-list');
    if (!container) return;
    container.innerHTML = data.tables.map(t =>
      `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
        <input type="checkbox" class="sync-table-cb" value="${t}"${t === 'VSE4' ? ' checked' : ''}> ${t}
      </label>`
    ).join('');
  } catch (_) {}
}

async function syncSiteDb() {
  const tables = [...document.querySelectorAll('.sync-table-cb:checked')].map(cb => cb.value);
  if (tables.length === 0) {
    showStatus('site-db-sync-status', 'Выберите хотя бы одну таблицу', 'error');
    return;
  }

  const btn = document.getElementById('site-db-sync-btn');
  if (btn) btn.disabled = true;
  document.getElementById('site-db-sync-results').style.display = 'none';
  showStatus('site-db-sync-status', `⏳ Синхронизирую: ${tables.join(', ')}...`, 'loading');

  try {
    const data = await apiRequest('/site-db/sync-tables', {
      method: 'POST',
      body: JSON.stringify({ tables })
    });

    // Показываем результат по каждой таблице
    const resultsEl = document.getElementById('site-db-sync-results');
    resultsEl.innerHTML = (data.results || []).map(r =>
      `<div style="padding:4px 0;border-bottom:1px solid var(--border);">
        ${r.success ? '✅' : '❌'} <b>${r.table}</b>
        ${r.success ? `— ${r.rows} строк` : `— ${r.error}`}
      </div>`
    ).join('');
    resultsEl.style.display = 'block';

    showStatus('site-db-sync-status', data.success ? `✅ ${data.message}` : `⚠️ ${data.message}`,
      data.success ? 'success' : 'error');
  } catch (e) {
    showStatus('site-db-sync-status', `❌ ${e.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function runMonitoring() {
  const select = document.getElementById('actualize-alias-select');
  const alias = select?.value;
  if (!alias) {
    showStatus('actualize-status', 'Выберите источник по псевдониму', 'error');
    return;
  }
  const source = state.avitoSources.find(s => s.alias === alias);
  const avitoUrl = source?.url || null;
  const btn = document.getElementById('run-monitoring');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Выполняется...';
  }
  showStatus('actualize-status', 'Запуск мониторинга (парсинг + сравнение с БД)... Это может занять несколько минут.', 'loading');
  try {
    const result = await apiRequest('/monitor/run', {
      method: 'POST',
      body: JSON.stringify({ alias, avitoUrl, headless: false })
    });
    state.monitoringResults = result;
    state.lastMonitoringAlias = alias;
    state.resultAlias = alias;
    state.parseResult = result.items || [];
    renderResultAliasTabs();
    applyAliasColor();
    state.currentPage.actualize = 1;
    showStatus('actualize-status',
      `✅ Мониторинг завершён! Спарсено: ${state.parseResult.length}, изменений цен: ${result.priceChanges.length}, снято: ${result.removedItems.length}, снова в продаже: ${(result.backOnSaleItems||[]).length}, новинок: ${result.newItems.length}`,
      'success'
    );
    renderActualizeTable();
    renderPriceChangesTable();
    renderRemovedTable();
    renderBackOnSaleTable();
    renderNewItemsTable();
    const exportBtn = document.getElementById('export-parsed-excel');
    if (exportBtn) exportBtn.disabled = false;
  } catch (error) {
    showStatus('actualize-status', `Ошибка: ${error.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🚀 Запустить мониторинг';
    }
  }
}

function exportParsedExcel() {
  window.location.href = '/api/monitor/export-parsed';
}

// ============================================================================
// Загрузка сохранённых результатов мониторинга
// ============================================================================

async function loadStoredMonitoringResults(triggerSection) {
  const alias = state.resultAlias || state.lastMonitoringAlias
    || document.getElementById('actualize-alias-select')?.value;
  if (!alias) {
    showStatus('actualize-status', 'Выберите псевдоним источника в табах выше', 'error');
    return;
  }

  try {
    showStatus('actualize-status', 'Загрузка сохранённых результатов мониторинга...', 'loading');
    const result = await apiRequest(`/monitor/stored?alias=${encodeURIComponent(alias)}`);
    state.monitoringResults = {
      priceChanges: result.priceChanges || [],
      removedItems: result.removedItems || [],
      newItems: result.newItems || [],
      backOnSaleItems: result.backOnSaleItems || []
    };
    state.currentPage.priceChanges = 1;
    state.currentPage.removed = 1;
    state.currentPage.newItems = 1;
    state.currentPage.backOnSale = 1;
    showStatus(
      'actualize-status',
      `✅ Загружены сохранённые результаты для «${alias}». Изменений: ${state.monitoringResults.priceChanges.length}, снято: ${state.monitoringResults.removedItems.length}, снова в продаже: ${state.monitoringResults.backOnSaleItems.length}, новинок: ${state.monitoringResults.newItems.length}`,
      'success'
    );
    renderPriceChangesTable();
    renderRemovedTable();
    renderBackOnSaleTable();
    renderNewItemsTable();
  } catch (error) {
    showStatus('actualize-status', `Ошибка загрузки сохранённых результатов: ${error.message}`, 'error');
  }
}

// ============================================================================
// Выбор файла БД через проводник Windows
// ============================================================================

async function pickDbFileWithExplorer() {
  const btn = document.getElementById('browse-db-path');
  const input = document.getElementById('config-db-path');
  if (!btn || !input) return;
  btn.disabled = true;
  btn.textContent = 'Открытие проводника...';
  try {
    const data = await apiRequest('/config/pick-db-file', {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (data.path) {
      input.value = data.path;
    }
    // cancelled — ничего не делаем
  } catch (e) {
    if (!e.message.includes('cancelled')) {
      const msg = e.message || '';
      const hint = msg.includes('Not found') || msg.includes('404')
        ? '\n\nПерезапустите сервер дашборда (в папке price-monitoring выполните: npm start) и обновите страницу.'
        : '';
      alert('Не удалось открыть проводник: ' + msg + hint);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Обзор...';
  }
}

function initBrowseDbPath() {
  const btn = document.getElementById('browse-db-path');
  if (btn) btn.addEventListener('click', pickDbFileWithExplorer);
}

async function saveConfig() {
  const config = {
    avitoSources: state.avitoSources,
    siteApiUrl: document.getElementById('config-api-url').value.trim(),
    dbPath: document.getElementById('config-db-path').value.trim(),
    bearerToken: document.getElementById('config-token').value.trim() || undefined
  };
  try {
    await apiRequest('/config', {
      method: 'PUT',
      body: JSON.stringify(config)
    });
    alert('✅ Конфигурация сохранена');
    await loadAvitoSources();
  } catch (error) {
    alert(`❌ Ошибка сохранения: ${error.message}`);
  }
}

async function addSource() {
  const aliasEl = document.getElementById('source-alias');
  const alias = aliasEl.value.trim();
  const url = document.getElementById('source-url').value.trim();
  if (!alias || !url) {
    alert('Укажите тип источника и ссылку');
    return;
  }
  try {
    new URL(url);
  } catch (e) {
    alert('Неверный формат URL');
    return;
  }
  // Заменяем существующий источник с тем же alias (один источник на тип)
  state.avitoSources = state.avitoSources.filter(s => s.alias !== alias);
  state.avitoSources.push({ id: String(Date.now()), alias, url });
  document.getElementById('source-url').value = '';
  renderSourcesList();
  fillSourceSelects();
  await persistSources();
}

async function persistSources() {
  try {
    await apiRequest('/config/sources', {
      method: 'PUT',
      body: JSON.stringify({ avitoSources: state.avitoSources })
    });
    showStatus('sources-status', 'Источники сохранены на сервере.', 'success');
    setTimeout(() => showStatus('sources-status', '', 'success'), 2000);
  } catch (e) {
    console.error('Не удалось сохранить источники:', e);
    const msg = e.message || '';
    const hint = msg.includes('HTML') || msg.includes('не JSON')
      ? ' Перезапустите сервер из папки price-monitoring: npm start'
      : '';
    showStatus('sources-status', 'Источники не сохранены на сервере: ' + e.message + hint, 'error');
  }
}

// ============================================================================
// Actualize Section (парсинг по псевдониму, результат — список объявлений)
// ============================================================================

async function runActualize() {
  const select = document.getElementById('actualize-alias-select');
  const alias = select.value;
  if (!alias) {
    showStatus('actualize-status', 'Выберите источник по псевдониму', 'error');
    return;
  }
  const source = state.avitoSources.find(s => s.alias === alias);
  const avitoUrl = source?.url || null;
  const btn = document.getElementById('run-actualize');
  btn.disabled = true;
  btn.textContent = '⏳ Парсинг...';
  showStatus('actualize-status', 'Парсинг страницы Avito. Подождите…', 'loading');
  try {
    const result = await apiRequest('/parse/run', {
      method: 'POST',
      body: JSON.stringify({ alias, avitoUrl, headless: false })
    });
    state.parseResult = result.items || [];
    state.currentPage.actualize = 1;
    showStatus('actualize-status', `Спарсено объявлений: ${state.parseResult.length}`, 'success');
    renderActualizeTable();
  } catch (error) {
    showStatus('actualize-status', `Ошибка: ${error.message}`, 'error');
    state.parseResult = [];
    renderActualizeTable();
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Актуализировать';
  }
}

function renderActualizeTable() {
  const tbody = document.getElementById('actualize-tbody');
  if (!state.parseResult || state.parseResult.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">Нет данных. Выберите источник и нажмите «Запустить мониторинг».</td></tr>';
    document.getElementById('actualize-pagination').innerHTML = '';
    return;
  }
  const q = (state.searchQuery.actualize || '').toLowerCase().trim();
  const filtered = q
    ? state.parseResult.filter(i => (i.name || '').toLowerCase().includes(q))
    : state.parseResult;
  const paginated = paginateItems(filtered, state.currentPage.actualize);
  tbody.innerHTML = paginated.length === 0
    ? '<tr><td colspan="3" class="empty">Ничего не найдено</td></tr>'
    : paginated.map(item => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${formatPrice(item.price)}</td>
          <td><a href="${escapeHtml(item.url)}" target="_blank">Открыть</a></td>
        </tr>
      `).join('');
  renderPagination('actualize-pagination', filtered.length, state.currentPage.actualize, (page) => {
    state.currentPage.actualize = page;
    renderActualizeTable();
  });
}

// ============================================================================
// Applied Changes Section (внесённые в локальную БД изменения)
// ============================================================================

async function loadAppliedChanges() {
  try {
    const data = await apiRequest('/apply/changes');
    state.appliedChanges = data;
    renderAppliedChangesSection();
  } catch (e) {
    console.error('loadAppliedChanges:', e);
  }
}

function renderAppliedChangesSection() {
  const priceTbody = document.getElementById('applied-price-tbody');
  const statusTbody = document.getElementById('applied-status-tbody');
  const pu = state.appliedChanges?.priceUpdates || [];
  const su = state.appliedChanges?.statusUpdates || [];
  priceTbody.innerHTML = pu.length
    ? pu.map(p => `<tr><td>${escapeHtml(p.id)}</td><td>${escapeHtml(p.name)}</td><td>${formatPrice(p.newPrice)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">Нет данных. Замените цены в разделе «Изменение цен».</td></tr>';
  statusTbody.innerHTML = su.length
    ? su.map(s => `<tr><td>${escapeHtml(s.id)}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.salesStatus)}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">Нет данных. Внесите изменения в разделе «Снято с продажи».</td></tr>';

  // Render site sync tab
  const sync = state.appliedChanges?.syncResults || { total: 0, success: 0, failed: 0, results: [] };
  const summaryEl = document.getElementById('site-sync-summary');
  const syncTbody = document.getElementById('site-sync-tbody');
  if (summaryEl) {
    summaryEl.innerHTML = sync.total > 0
      ? `<span>Всего: <b>${sync.total}</b></span>
         <span style="color:var(--green)">✓ Успешно: <b>${sync.success}</b></span>
         <span style="color:var(--red)">✗ Ошибок: <b>${sync.failed}</b></span>`
      : '';
  }
  if (syncTbody) {
    const rows = sync.results || [];
    syncTbody.innerHTML = rows.length
      ? rows.map(r => `<tr>
          <td>${escapeHtml(r.productId || '')}</td>
          <td>${r.success
            ? '<span style="color:var(--green)">✓ Синхронизировано</span>'
            : '<span style="color:var(--red)">✗ Ошибка</span>'}</td>
          <td>${r.error ? escapeHtml(r.error) : '—'}</td>
        </tr>`).join('')
      : '<tr><td colspan="3" class="empty">Нет данных. Синхронизация происходит автоматически при применении изменений.</td></tr>';
  }
}

// ============================================================================
// Price Changes Section
// ============================================================================

function renderPriceChangesTable() {
  if (!state.monitoringResults || !state.monitoringResults.priceChanges) {
    return;
  }

  const isBaikal = (state.resultAlias || state.lastMonitoringAlias) === 'baikal';

  // Обновляем заголовки колонок под текущий источник
  const thId = document.getElementById('th-price-id-col');
  const thNew = document.getElementById('th-price-new-col');
  const thOld = document.getElementById('th-price-old-col');
  if (thId) thId.textContent = isBaikal ? 'URL (кратко)' : 'ID';
  if (thNew) thNew.textContent = isBaikal ? 'Цена сайта' : 'Цена Avito (parser)';
  if (thOld) thOld.textContent = isBaikal ? 'Цена БД (price_bai)' : 'Цена БД (price_vse)';

  const tbody = document.getElementById('price-changes-tbody');
  let items = filterItems(state.monitoringResults.priceChanges, state.searchQuery.priceChanges);

  // Сортировка по изменению цены
  const dir = state.sortPriceChanges.dir;
  if (dir) {
    items = [...items].sort((a, b) => {
      const da = a.newPrice - a.oldPrice;
      const db = b.newPrice - b.oldPrice;
      return dir === 'asc' ? da - db : db - da;
    });
  }

  // Обновляем иконку в заголовке
  const sortTh = document.getElementById('th-price-change-sort');
  if (sortTh) {
    sortTh.dataset.dir = dir || '';
    sortTh.innerHTML = `Изменение цены ${dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕'}`;
  }

  const paginatedItems = paginateItems(items, state.currentPage.priceChanges);

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Нет данных</td></tr>';
    return;
  }

  tbody.innerHTML = paginatedItems.map(item => {
    // Для baikal ключ = url, для VSE4 ключ = id
    const key = item.id;
    const isSelected = state.selectedPriceChanges.has(key);
    const displayId = escapeHtml(item.id || '');
    const priceChange = item.newPrice - item.oldPrice;
    const nacenka = item.nacenka != null ? item.nacenka : 0;
    const owPrice = item.newPrice + nacenka;
    return `
      <tr class="${isSelected ? 'selected' : ''}" data-id="${escapeHtml(key)}">
        <td><input type="checkbox" ${isSelected ? 'checked' : ''} data-id="${escapeHtml(key)}"></td>
        <td>${displayId}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${formatPrice(item.newPrice)}</td>
        <td>${formatPrice(item.oldPrice)}</td>
        <td>${formatPrice(priceChange)}</td>
        <td>${formatPrice(owPrice)}</td>
        <td><a href="${escapeHtml(item.url)}" target="_blank">Открыть</a></td>
      </tr>
    `;
  }).join('');
  
  renderPagination('price-pagination', items.length, state.currentPage.priceChanges, (page) => {
    state.currentPage.priceChanges = page;
    renderPriceChangesTable();
  });
  
  // Add event listeners
  tbody.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        state.selectedPriceChanges.add(id);
      } else {
        state.selectedPriceChanges.delete(id);
      }
      renderPriceChangesTable();
    });
  });
  
  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox' || e.target.tagName === 'A') return;
      const checkbox = row.querySelector('input[type="checkbox"]');
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });
  });
}

async function applyPrices() {
  if (state.selectedPriceChanges.size === 0) {
    alert('Выберите товары для применения цен');
    return;
  }

  const isBaikal = (state.resultAlias || state.lastMonitoringAlias) === 'baikal';

  const items = state.monitoringResults.priceChanges
    .filter(item => state.selectedPriceChanges.has(item.id))
    .map(item => ({ id: item.id, newPrice: item.newPrice, nacenka: item.nacenka != null ? item.nacenka : 0 }));

  const btn = document.getElementById('apply-prices');
  btn.disabled = true;
  btn.textContent = '⏳ Применяется...';

  try {
    const result = await apiRequest('/apply/prices', {
      method: 'POST',
      body: JSON.stringify({ items, tableType: isBaikal ? 'baikal' : 'VSE4' })
    });
    alert(`✅ Применено ${result.updated} изменений.`);
    state.selectedPriceChanges.clear();
    renderPriceChangesTable();
    loadAppliedChanges();
  } catch (error) {
    alert(`❌ Ошибка: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Заменить цены в базе';
  }
}

// ============================================================================
// Removed Items Section
// ============================================================================

function renderRemovedTable() {
  if (!state.monitoringResults || !state.monitoringResults.removedItems) {
    return;
  }
  
  const tbody = document.getElementById('removed-tbody');
  const items = filterItems(state.monitoringResults.removedItems, state.searchQuery.removed);
  const paginatedItems = paginateItems(items, state.currentPage.removed);
  
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">Нет данных</td></tr>';
    return;
  }
  
  const hasAvitoCheck = Object.keys(state.avitoCheckResults || {}).length > 0;
  const colHeader = document.getElementById('avito-check-col-header');
  if (colHeader) colHeader.style.display = hasAvitoCheck ? '' : 'none';

  tbody.innerHTML = paginatedItems.map(item => {
    const isSelected = state.selectedRemoved.has(item.id);
    const chk = (state.avitoCheckResults || {})[item.id];
    let statusCell = '';
    if (hasAvitoCheck) {
      if (!chk) statusCell = '<td style="color:var(--text-2)">—</td>';
      else if (chk.error) statusCell = `<td style="color:var(--yellow)" title="${chk.error}">⚠ Ошибка</td>`;
      else if (chk.removed === true) statusCell = '<td style="color:var(--green)">✅ Снято</td>';
      else statusCell = '<td style="color:var(--red)">❌ Активно</td>';
    }
    return `
      <tr class="${isSelected ? 'selected' : ''}" data-id="${item.id}">
        <td><input type="checkbox" ${isSelected ? 'checked' : ''} data-id="${item.id}"></td>
        <td>${item.id}</td>
        <td>${item.name}</td>
        <td><a href="${item.url}" target="_blank">Открыть</a></td>
        ${statusCell}
      </tr>
    `;
  }).join('');
  
  renderPagination('removed-pagination', items.length, state.currentPage.removed, (page) => {
    state.currentPage.removed = page;
    renderRemovedTable();
  });
  
  // Add event listeners
  tbody.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) {
        state.selectedRemoved.add(id);
      } else {
        state.selectedRemoved.delete(id);
      }
      renderRemovedTable();
    });
  });
  
  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox' || e.target.tagName === 'A') return;
      const checkbox = row.querySelector('input[type="checkbox"]');
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });
  });
}

async function applyRemoved() {
  if (state.selectedRemoved.size === 0) {
    alert('Выберите товары для снятия с продажи');
    return;
  }
  
  const ids = Array.from(state.selectedRemoved);
  const isBaikal = (state.resultAlias || state.lastMonitoringAlias) === 'baikal';

  const btn = document.getElementById('apply-removed');
  btn.disabled = true;
  btn.textContent = '⏳ Применяется...';

  try {
    const result = await apiRequest('/apply/status', {
      method: 'POST',
      body: JSON.stringify({
        ids,
        salesStatus: 'removed',
        tableType: isBaikal ? 'baikal' : 'VSE4'
      })
    });

    alert(`✅ Применено ${result.updated} изменений.`);
    state.selectedRemoved.clear();
    renderRemovedTable();
    loadAppliedChanges();
  } catch (error) {
    alert(`❌ Ошибка: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Внести изменения в базу';
  }
}

async function startAvitoCheck() {
  if (!state.monitoringResults?.removedItems?.length) {
    alert('Нет объявлений для проверки. Запустите мониторинг.');
    return;
  }
  const items = state.monitoringResults.removedItems.map(i => ({ id: i.id, name: i.name, url: i.url }));
  state.avitoCheckResults = {};
  renderRemovedTable();

  const btn = document.getElementById('check-avito-removed');
  const stopBtn = document.getElementById('stop-avito-check');
  btn.disabled = true;
  btn.textContent = '⏳ Проверяем...';
  stopBtn.style.display = '';

  try {
    await apiRequest('/avito-check/removed', { method: 'POST', body: JSON.stringify({ items }) });
    state.avitoCheckPolling = setInterval(pollAvitoCheck, 2000);
  } catch (err) {
    alert(`Ошибка запуска: ${err.message}`);
    btn.disabled = false;
    btn.textContent = '🔍 Проверить через Avito';
    stopBtn.style.display = 'none';
  }
}

async function stopAvitoCheck() {
  await apiRequest('/avito-check/stop', { method: 'POST' }).catch(() => {});
  clearInterval(state.avitoCheckPolling);
  state.avitoCheckPolling = null;
  const btn = document.getElementById('check-avito-removed');
  btn.disabled = false;
  btn.textContent = '🔍 Проверить через Avito';
  document.getElementById('stop-avito-check').style.display = 'none';
}

async function pollAvitoCheck() {
  try {
    const status = await apiRequest('/avito-check/status');
    // Обновляем результаты
    for (const r of status.results || []) {
      state.avitoCheckResults[r.id] = r;
    }
    const btn = document.getElementById('check-avito-removed');
    if (status.captcha) {
      btn.textContent = `⚠️ Решите капчу в браузере... (${status.done}/${status.total})`;
      btn.style.color = 'var(--yellow, orange)';
    } else {
      btn.textContent = `⏳ Проверяем... ${status.done}/${status.total}`;
      btn.style.color = '';
    }
    renderRemovedTable();

    if (!status.running) {
      clearInterval(state.avitoCheckPolling);
      state.avitoCheckPolling = null;
      btn.disabled = false;
      btn.textContent = '🔍 Проверить через Avito';
      btn.style.color = '';
      document.getElementById('stop-avito-check').style.display = 'none';
    }
  } catch {}
}

// ============================================================================
// Back On Sale Section
// ============================================================================

function renderBackOnSaleTable() {
  if (!state.monitoringResults || !state.monitoringResults.backOnSaleItems) return;

  const tbody = document.getElementById('back-on-sale-tbody');
  if (!tbody) return;
  const items = filterItems(state.monitoringResults.backOnSaleItems, state.searchQuery.backOnSale);
  const paginatedItems = paginateItems(items, state.currentPage.backOnSale);

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Нет данных</td></tr>';
    return;
  }

  tbody.innerHTML = paginatedItems.map(item => {
    const isSelected = state.selectedBackOnSale.has(item.id);
    const priceDiff = item.newPrice != null && item.oldPrice != null
      ? item.newPrice - item.oldPrice
      : null;
    const diffHtml = priceDiff != null
      ? `<span style="color:${priceDiff > 0 ? '#e74c3c' : priceDiff < 0 ? '#27ae60' : 'inherit'}">${priceDiff > 0 ? '+' : ''}${formatPrice(priceDiff)}</span>`
      : '—';

    return `
      <tr class="${isSelected ? 'selected' : ''}" data-id="${item.id}">
        <td><input type="checkbox" ${isSelected ? 'checked' : ''} data-id="${item.id}"></td>
        <td>${item.id}</td>
        <td>${item.name || '—'}</td>
        <td>${item.newPrice != null ? formatPrice(item.newPrice) : '—'}</td>
        <td>${item.oldPrice != null ? formatPrice(item.oldPrice) : '—'}</td>
        <td>${diffHtml}</td>
        <td><a href="${item.url}" target="_blank">Открыть</a></td>
      </tr>
    `;
  }).join('');

  renderPagination('back-on-sale-pagination', items.length, state.currentPage.backOnSale, (page) => {
    state.currentPage.backOnSale = page;
    renderBackOnSaleTable();
  });

  tbody.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) state.selectedBackOnSale.add(id);
      else state.selectedBackOnSale.delete(id);
      renderBackOnSaleTable();
    });
  });

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox' || e.target.tagName === 'A') return;
      const checkbox = row.querySelector('input[type="checkbox"]');
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });
  });
}

async function applyBackOnSale() {
  if (state.selectedBackOnSale.size === 0) {
    alert('Выберите товары для восстановления');
    return;
  }

  const ids = Array.from(state.selectedBackOnSale);
  const btn = document.getElementById('apply-back-on-sale');
  btn.disabled = true;
  btn.textContent = '⏳ Применяется...';

  try {
    const result = await apiRequest('/apply/status', {
      method: 'POST',
      body: JSON.stringify({ ids, salesStatus: null })
    });
    alert(`✅ Восстановлено ${result.updated} товаров. Синхронизировано: ${result.sync.success}/${result.sync.total}`);
    state.selectedBackOnSale.clear();
    renderBackOnSaleTable();
    loadAppliedChanges();
  } catch (error) {
    alert(`❌ Ошибка: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Восстановить в базе';
  }
}

// ============================================================================
// New Items Section
// ============================================================================

function renderNewItemsTable() {
  if (!state.monitoringResults || !state.monitoringResults.newItems) {
    return;
  }
  
  const tbody = document.getElementById('new-items-tbody');
  const items = filterItems(state.monitoringResults.newItems, state.searchQuery.newItems);
  const paginatedItems = paginateItems(items, state.currentPage.newItems);
  
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty">Нет данных</td></tr>';
    return;
  }
  
  tbody.innerHTML = paginatedItems.map(item => `
    <tr>
      <td>${item.name}</td>
      <td>${formatPrice(item.price)}</td>
      <td><a href="${item.url}" target="_blank">Открыть</a></td>
    </tr>
  `).join('');
  
  renderPagination('new-pagination', items.length, state.currentPage.newItems, (page) => {
    state.currentPage.newItems = page;
    renderNewItemsTable();
  });
}

async function exportToExcel() {
  if (!state.monitoringResults || !state.monitoringResults.newItems || 
      state.monitoringResults.newItems.length === 0) {
    alert('Нет данных для экспорта');
    return;
  }
  
  const btn = document.getElementById('export-excel');
  btn.disabled = true;
  btn.textContent = '⏳ Экспорт...';
  
  try {
    const response = await fetch(`${API_BASE}/export/new-items`);
    
    if (!response.ok) {
      throw new Error('Export failed');
    }
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `new-items-${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    alert('✅ Excel файл скачан');
    
  } catch (error) {
    alert(`❌ Ошибка экспорта: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '📊 Экспорт в Excel';
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function showStatus(elementId, message, type) {
  const statusEl = document.getElementById(elementId);
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function formatPrice(price) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0
  }).format(price);
}

function filterItems(items, query) {
  if (!query) return items;
  
  const lowerQuery = query.toLowerCase();
  return items.filter(item => {
    const searchText = `${item.id || ''} ${item.name || ''} ${item.url || ''}`.toLowerCase();
    return searchText.includes(lowerQuery);
  });
}

function paginateItems(items, page) {
  const start = (page - 1) * state.itemsPerPage;
  const end = start + state.itemsPerPage;
  return items.slice(start, end);
}

function renderPagination(containerId, totalItems, currentPage, onPageChange) {
  const container = document.getElementById(containerId);
  const totalPages = Math.ceil(totalItems / state.itemsPerPage);
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  let html = '';
  
  // Previous button
  html += `<button ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">←</button>`;
  
  // Page numbers
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
      html += `<button class="${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      html += '<span>...</span>';
    }
  }
  
  // Next button
  html += `<button ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">→</button>`;
  
  container.innerHTML = html;
  
  // Add event listeners
  container.querySelectorAll('button[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = parseInt(btn.dataset.page);
      onPageChange(page);
    });
  });
}

// ============================================================================
// Nacenka Section
// ============================================================================

async function loadNacenkaItems() {
  const btn = document.getElementById('nacenka-load');
  btn.disabled = true; btn.textContent = '⏳ Загрузка...';
  showStatus('nacenka-status', 'Загрузка данных из VSE4...', 'loading');

  const maker  = document.getElementById('nacenka-filter-maker').value;
  const model  = document.getElementById('nacenka-filter-model').value;
  const diam   = document.getElementById('nacenka-filter-diam').value;
  const search = document.getElementById('nacenka-search').value.trim();

  const params = new URLSearchParams();
  if (maker)  params.set('maker', maker);
  if (model)  params.set('model', model);
  if (diam)   params.set('diam', diam);
  if (search) params.set('search', search);

  try {
    const data = await apiRequest(`/nacenka/items?${params}`);
    state.nacenka.items = data.items;
    state.nacenka.edited = {};
    state.nacenka.currentPage = 1;

    // Заполняем фильтры при первой загрузке
    fillNacenkaFilter('nacenka-filter-maker', data.filters.makers, maker, 'Все производители');
    fillNacenkaFilter('nacenka-filter-model', data.filters.models, model, 'Все модели');
    fillNacenkaFilter('nacenka-filter-diam',  data.filters.diams,  diam,  'Все диаметры');

    renderNacenkaTable();
    document.getElementById('nacenka-save').disabled = true;
    showStatus('nacenka-status', `Загружено ${data.items.length} позиций`, 'success');
  } catch (e) {
    showStatus('nacenka-status', `Ошибка: ${e.message}`, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Показать данные';
  }
}

function fillNacenkaFilter(id, values, current, placeholder) {
  const sel = document.getElementById(id);
  const prev = sel.value;
  const active = current || prev;
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    values.map(v => {
      const val = String(v);
      const selected = active && (val === active || parseFloat(val) === parseFloat(active)) ? 'selected' : '';
      return `<option value="${escapeHtml(val)}" ${selected}>${escapeHtml(val)}</option>`;
    }).join('');
}

function renderNacenkaTable() {
  const tbody = document.getElementById('nacenka-tbody');
  const items = state.nacenka.items;

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Нет данных</td></tr>';
    renderPagination('nacenka-pagination', 0, 1, () => {});
    return;
  }

  const paginated = paginateItems(items, state.nacenka.currentPage);

  tbody.innerHTML = paginated.map(item => {
    const nacenka = state.nacenka.edited.hasOwnProperty(item.ID)
      ? state.nacenka.edited[item.ID]
      : (item.nacenka ?? '');
    const priceOw = (parseFloat(item.price_vse) || 0) + (parseFloat(nacenka) || 0);

    return `<tr>
      <td>${escapeHtml(String(item.ID))}</td>
      <td>${escapeHtml(item.name || '')}</td>
      <td>${escapeHtml(item.maker || '')}</td>
      <td>${escapeHtml(item.model || '')}</td>
      <td>${item.diam ?? ''}</td>
      <td>${formatPrice(item.price_vse)}</td>
      <td><input type="number" class="nacenka-input" data-id="${escapeHtml(String(item.ID))}"
            value="${nacenka}" style="width:90px;padding:3px 6px;background:var(--bg-secondary,#1e2130);border:1px solid var(--border,#2a2f45);border-radius:4px;color:inherit;text-align:right;"
            step="1"></td>
      <td class="price-ow-cell" data-id="${escapeHtml(String(item.ID))}">${formatPrice(priceOw)}</td>
    </tr>`;
  }).join('');

  renderPagination('nacenka-pagination', items.length, state.nacenka.currentPage, (page) => {
    state.nacenka.currentPage = page;
    renderNacenkaTable();
  });

  // Обработка редактирования наценки
  tbody.querySelectorAll('.nacenka-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const id = e.target.dataset.id;
      const val = e.target.value;
      state.nacenka.edited[id] = val;
      // Обновляем price_ow в той же строке
      const item = state.nacenka.items.find(i => String(i.ID) === id);
      const priceOw = (parseFloat(item?.price_vse) || 0) + (parseFloat(val) || 0);
      const owCell = tbody.querySelector(`.price-ow-cell[data-id="${id}"]`);
      if (owCell) owCell.textContent = formatPrice(priceOw);
      document.getElementById('nacenka-save').disabled = Object.keys(state.nacenka.edited).length === 0;
    });
  });
}

async function saveNacenka() {
  const edited = state.nacenka.edited;
  if (Object.keys(edited).length === 0) return;

  const btn = document.getElementById('nacenka-save');
  btn.disabled = true; btn.textContent = '⏳ Сохранение...';

  const items = Object.entries(edited).map(([id, nacenka]) => ({ id, nacenka: parseFloat(nacenka) || 0 }));

  try {
    const result = await apiRequest('/nacenka/update', {
      method: 'POST',
      body: JSON.stringify({ items })
    });
    state.nacenka.edited = {};
    // Обновляем локальные данные
    items.forEach(({ id, nacenka }) => {
      const row = state.nacenka.items.find(i => String(i.ID) === id);
      if (row) { row.nacenka = nacenka; row.price_ow_calc = (row.price_vse || 0) + nacenka; }
    });
    showStatus('nacenka-status', `✅ Обновлено ${result.updated} позиций`, 'success');
    btn.disabled = true;
  } catch (e) {
    showStatus('nacenka-status', `Ошибка: ${e.message}`, 'error');
    btn.disabled = false;
  } finally {
    btn.textContent = 'Обновить в БД';
  }
}

// ============================================================================
// Event Listeners
// ============================================================================

function initEventListeners() {
  // Меняем подсказку URL в зависимости от выбранного типа источника
  const sourceAliasSelect = document.getElementById('source-alias');
  const sourceUrlInput = document.getElementById('source-url');
  const sourceUrlLabel = document.getElementById('source-url-label');
  if (sourceAliasSelect) {
    sourceAliasSelect.addEventListener('change', () => {
      if (sourceAliasSelect.value === 'baikal') {
        sourceUrlLabel && (sourceUrlLabel.textContent = 'Ссылка на каталог Baikal Wheels:');
        sourceUrlInput && sourceUrlInput.setAttribute('placeholder', 'https://irkutsk.baikalwheels.ru/catalog?page=1');
      } else {
        sourceUrlLabel && (sourceUrlLabel.textContent = 'Ссылка на страницу Avito:');
        sourceUrlInput && sourceUrlInput.setAttribute('placeholder', 'https://www.avito.ru/...');
      }
    });
  }

  document.getElementById('add-source').addEventListener('click', addSource);
  document.getElementById('save-config').addEventListener('click', saveConfig);
  const runMonitoringBtn = document.getElementById('run-monitoring');
  if (runMonitoringBtn) runMonitoringBtn.addEventListener('click', runMonitoring);
  const exportExcelBtn = document.getElementById('export-parsed-excel');
  if (exportExcelBtn) exportExcelBtn.addEventListener('click', exportParsedExcel);

  // SSH настройки
  const saveSshBtn = document.getElementById('save-ssh-config');
  if (saveSshBtn) saveSshBtn.addEventListener('click', saveSshConfig);
  const testSshBtn = document.getElementById('test-ssh');
  if (testSshBtn) testSshBtn.addEventListener('click', testSshConnection);

  // БД сайта — синхронизация
  const siteDbSyncBtn = document.getElementById('site-db-sync-btn');
  if (siteDbSyncBtn) siteDbSyncBtn.addEventListener('click', syncSiteDb);
  const showPriceBtn = document.getElementById('show-price-results');
  if (showPriceBtn) showPriceBtn.addEventListener('click', () => loadStoredMonitoringResults('price'));
  
  // Actualize search
  document.getElementById('search-actualize').addEventListener('input', (e) => {
    state.searchQuery.actualize = e.target.value;
    state.currentPage.actualize = 1;
    renderActualizeTable();
  });

  // Price Changes
  document.getElementById('search-price').addEventListener('input', (e) => {
    state.searchQuery.priceChanges = e.target.value;
    state.currentPage.priceChanges = 1;
    renderPriceChangesTable();
  });
  
  document.getElementById('select-all-price').addEventListener('click', () => {
    if (!state.monitoringResults) return;
    
    const items = filterItems(state.monitoringResults.priceChanges, state.searchQuery.priceChanges);
    
    if (state.selectedPriceChanges.size === items.length) {
      // Deselect all
      state.selectedPriceChanges.clear();
    } else {
      // Select all
      items.forEach(item => state.selectedPriceChanges.add(item.id));
    }
    
    renderPriceChangesTable();
  });
  
  document.getElementById('apply-prices').addEventListener('click', applyPrices);

  // Обновить результат (пересчёт без парсинга)
  async function recalculate(renderFn, btnId) {
    const btn = document.getElementById(btnId);
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Пересчёт...'; }
    try {
      const alias = state.resultAlias || state.lastMonitoringAlias || document.getElementById('actualize-alias-select')?.value || null;
      const result = await apiRequest('/monitor/recalculate', {
        method: 'POST',
        body: JSON.stringify({ alias })
      });
      state.monitoringResults = {
        priceChanges: result.priceChanges || [],
        removedItems: result.removedItems || [],
        newItems: result.newItems || [],
        noChangeItems: result.noChangeItems || [],
        backOnSaleItems: result.backOnSaleItems || []
      };
      renderFn();
    } catch (e) {
      alert(`❌ Ошибка пересчёта: ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Обновить результат'; }
    }
  }

  document.getElementById('recalc-price').addEventListener('click', () => recalculate(renderPriceChangesTable, 'recalc-price'));
  document.getElementById('recalc-removed').addEventListener('click', () => recalculate(renderRemovedTable, 'recalc-removed'));
  document.getElementById('recalc-back-on-sale').addEventListener('click', () => recalculate(renderBackOnSaleTable, 'recalc-back-on-sale'));

  // Наценка
  const nacenkaLoadBtn = document.getElementById('nacenka-load');
  if (nacenkaLoadBtn) nacenkaLoadBtn.addEventListener('click', loadNacenkaItems);
  const nacenkaSaveBtn = document.getElementById('nacenka-save');
  if (nacenkaSaveBtn) nacenkaSaveBtn.addEventListener('click', saveNacenka);
  ['nacenka-filter-maker','nacenka-filter-model','nacenka-filter-diam'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', loadNacenkaItems);
  });
  const nacenkaSearch = document.getElementById('nacenka-search');
  if (nacenkaSearch) {
    let searchTimer;
    nacenkaSearch.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadNacenkaItems, 400);
    });
  }

  const sortTh = document.getElementById('th-price-change-sort');
  if (sortTh) sortTh.addEventListener('click', () => {
    const cur = state.sortPriceChanges.dir;
    state.sortPriceChanges.dir = cur === null ? 'desc' : cur === 'desc' ? 'asc' : null;
    state.currentPage.priceChanges = 1;
    renderPriceChangesTable();
  });
  
  // Removed Items
  document.getElementById('search-removed').addEventListener('input', (e) => {
    state.searchQuery.removed = e.target.value;
    state.currentPage.removed = 1;
    renderRemovedTable();
  });
  
  document.getElementById('select-all-removed').addEventListener('click', () => {
    if (!state.monitoringResults) return;
    
    const items = filterItems(state.monitoringResults.removedItems, state.searchQuery.removed);
    
    if (state.selectedRemoved.size === items.length) {
      // Deselect all
      state.selectedRemoved.clear();
    } else {
      // Select all
      items.forEach(item => state.selectedRemoved.add(item.id));
    }
    
    renderRemovedTable();
  });
  
  document.getElementById('apply-removed').addEventListener('click', applyRemoved);
  const showRemovedBtn = document.getElementById('show-removed-results');
  if (showRemovedBtn) showRemovedBtn.addEventListener('click', () => loadStoredMonitoringResults('removed'));

  document.getElementById('check-avito-removed').addEventListener('click', startAvitoCheck);
  document.getElementById('stop-avito-check').addEventListener('click', stopAvitoCheck);

  // Back On Sale
  const searchBackOnSale = document.getElementById('search-back-on-sale');
  if (searchBackOnSale) searchBackOnSale.addEventListener('input', (e) => {
    state.searchQuery.backOnSale = e.target.value;
    state.currentPage.backOnSale = 1;
    renderBackOnSaleTable();
  });

  const selectAllBackOnSale = document.getElementById('select-all-back-on-sale');
  if (selectAllBackOnSale) selectAllBackOnSale.addEventListener('click', () => {
    if (!state.monitoringResults) return;
    const items = filterItems(state.monitoringResults.backOnSaleItems || [], state.searchQuery.backOnSale);
    if (state.selectedBackOnSale.size === items.length) state.selectedBackOnSale.clear();
    else items.forEach(item => state.selectedBackOnSale.add(item.id));
    renderBackOnSaleTable();
  });

  const applyBackOnSaleBtn = document.getElementById('apply-back-on-sale');
  if (applyBackOnSaleBtn) applyBackOnSaleBtn.addEventListener('click', applyBackOnSale);

  const showBackOnSaleBtn = document.getElementById('show-back-on-sale-results');
  if (showBackOnSaleBtn) showBackOnSaleBtn.addEventListener('click', () => loadStoredMonitoringResults('back-on-sale'));
  
  // New Items
  document.getElementById('search-new').addEventListener('input', (e) => {
    state.searchQuery.newItems = e.target.value;
    state.currentPage.newItems = 1;
    renderNewItemsTable();
  });
  
  document.getElementById('export-excel').addEventListener('click', exportToExcel);
  const showNewBtn = document.getElementById('show-new-results');
  if (showNewBtn) showNewBtn.addEventListener('click', () => loadStoredMonitoringResults('new'));

  // ЯД — ImageUrls
  const ydBtn    = document.getElementById('yd-image-urls-btn');
  const ydPrefix = document.getElementById('yd-prefix');
  const ydPreview = document.getElementById('yd-preview');

  if (ydPrefix && ydPreview) {
    ydPrefix.addEventListener('input', () => {
      const p = ydPrefix.value.trim();
      if (p) {
        const example = `${p}diski\\папка\\файл.jpg`;
        const result  = 'yandex_disk://diski/папка/файл.jpg';
        ydPreview.innerHTML = `Пример: <code>${escHtml(example)}</code> → <code>${escHtml(result)}</code>`;
      } else {
        ydPreview.textContent = 'Только замена \\ → /';
      }
    });
  }

  if (ydBtn) {
    ydBtn.addEventListener('click', async () => {
      const prefix = ydPrefix?.value ?? '';
      ydBtn.disabled = true;
      showStatus('yd-status', '⏳ Обновляю…', 'info');
      try {
        const res = await apiRequest('/import/yd-image-urls', {
          method: 'POST',
          body: JSON.stringify({ prefix, table: 'VSE4' }),
        });
        showStatus('yd-status', `✅ Обновлено строк: ${res.updated}`, 'success');
      } catch (e) {
        showStatus('yd-status', `Ошибка: ${e.message}`, 'error');
      } finally {
        ydBtn.disabled = false;
      }
    });
  }

  // Fix decimals
  const fixDecimalsBtn = document.getElementById('fix-decimals-btn');
  if (fixDecimalsBtn) {
    fixDecimalsBtn.addEventListener('click', async () => {
      fixDecimalsBtn.disabled = true;
      showStatus('fix-decimals-status', 'Обновляю...', 'loading');
      try {
        const result = await apiRequest('/import/fix-decimals', { method: 'POST' });
        const { centr_otv, diam_otv, width } = result.results;
        showStatus('fix-decimals-status',
          `✅ Обновлено: centr_otv — ${centr_otv}, diam_otv — ${diam_otv}, width — ${width}`,
          'success');
      } catch (e) {
        showStatus('fix-decimals-status', `Ошибка: ${e.message}`, 'error');
      } finally {
        fixDecimalsBtn.disabled = false;
      }
    });
  }

  // ImageUrls import
  const imageUrlsFile = document.getElementById('image-urls-file');
  const imageUrlsImportBtn = document.getElementById('image-urls-import');
  let imageUrlsRows = [];

  if (imageUrlsFile) {
    imageUrlsFile.addEventListener('change', () => {
      const file = imageUrlsFile.files[0];
      if (!file) return;
      document.getElementById('image-urls-filename').textContent = file.name;
      document.getElementById('image-urls-preview').textContent = 'Читаю файл...';
      imageUrlsRows = [];
      imageUrlsImportBtn.disabled = true;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { defval: '' });

          if (data.length === 0) {
            document.getElementById('image-urls-preview').textContent = 'Файл пуст.';
            return;
          }
          const keys = Object.keys(data[0]);
          const idKey = keys.find(k => k.trim().toLowerCase() === 'id');
          const urlsKey = keys.find(k => k.trim().toLowerCase() === 'imageurls');
          if (!idKey || !urlsKey) {
            document.getElementById('image-urls-preview').innerHTML =
              `<span style="color:var(--red)">Не найдены столбцы Id и/или ImageUrls. Найдены: ${keys.join(', ')}</span>`;
            return;
          }

          imageUrlsRows = data
            .filter(r => r[idKey] !== '' && r[idKey] != null)
            .map(r => ({ id: String(r[idKey]).trim(), imageUrls: String(r[urlsKey] ?? '').trim() }));

          document.getElementById('image-urls-preview').innerHTML =
            `Найдено строк: <b>${imageUrlsRows.length}</b>. ` +
            `Пример: ${imageUrlsRows.slice(0, 2).map(r => `${r.id} → ${r.imageUrls.slice(0, 40)}…`).join(', ')}`;
          imageUrlsImportBtn.disabled = imageUrlsRows.length === 0;
        } catch (err) {
          document.getElementById('image-urls-preview').innerHTML =
            `<span style="color:var(--red)">Ошибка чтения файла: ${err.message}</span>`;
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  if (imageUrlsImportBtn) {
    imageUrlsImportBtn.addEventListener('click', async () => {
      if (!imageUrlsRows.length) return;
      imageUrlsImportBtn.disabled = true;
      showStatus('image-urls-status', 'Записываю в БД...', 'loading');
      try {
        const result = await apiRequest('/import/image-urls', {
          method: 'POST',
          body: JSON.stringify({ rows: imageUrlsRows })
        });
        showStatus('image-urls-status',
          `✅ Обновлено: ${result.updated} из ${result.total}` +
          (result.notFound > 0 ? ` (не найдено в БД: ${result.notFound})` : ''),
          'success');
      } catch (err) {
        showStatus('image-urls-status', `Ошибка: ${err.message}`, 'error');
      } finally {
        imageUrlsImportBtn.disabled = false;
      }
    });
  }

  // Text import
  const textFile = document.getElementById('text-file');
  const textImportBtn = document.getElementById('text-import');
  let textRows = [];

  if (textFile) {
    textFile.addEventListener('change', () => {
      const file = textFile.files[0];
      if (!file) return;
      document.getElementById('text-filename').textContent = file.name;
      document.getElementById('text-preview').textContent = 'Читаю файл...';
      textRows = [];
      textImportBtn.disabled = true;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { defval: '' });

          if (data.length === 0) {
            document.getElementById('text-preview').textContent = 'Файл пуст.';
            return;
          }
          const keys = Object.keys(data[0]);
          const idKey = keys.find(k => k.trim().toLowerCase() === 'id');
          const descKey = keys.find(k => k.trim().toLowerCase() === 'description');
          if (!idKey || !descKey) {
            document.getElementById('text-preview').innerHTML =
              `<span style="color:var(--red)">Не найдены столбцы Id и/или Description. Найдены: ${keys.join(', ')}</span>`;
            return;
          }

          textRows = data
            .filter(r => r[idKey] !== '' && r[idKey] != null)
            .map(r => ({ id: String(r[idKey]).trim(), description: String(r[descKey] ?? '').trim() }));

          document.getElementById('text-preview').innerHTML =
            `Найдено строк: <b>${textRows.length}</b>. ` +
            `Пример: ${textRows.slice(0, 2).map(r => `${r.id} → ${r.description.slice(0, 30)}…`).join(', ')}`;
          textImportBtn.disabled = textRows.length === 0;
        } catch (err) {
          document.getElementById('text-preview').innerHTML =
            `<span style="color:var(--red)">Ошибка чтения файла: ${err.message}</span>`;
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  if (textImportBtn) {
    textImportBtn.addEventListener('click', async () => {
      if (!textRows.length) return;
      textImportBtn.disabled = true;
      showStatus('text-status', 'Записываю в БД...', 'loading');
      try {
        const result = await apiRequest('/import/text', {
          method: 'POST',
          body: JSON.stringify({ rows: textRows })
        });
        showStatus('text-status',
          `✅ Обновлено: ${result.updated} из ${result.total}` +
          (result.notFound > 0 ? ` (не найдено в БД: ${result.notFound})` : ''),
          'success');
      } catch (err) {
        showStatus('text-status', `Ошибка: ${err.message}`, 'error');
      } finally {
        textImportBtn.disabled = false;
      }
    });
  }

  // AvitoId import
  const avitoIdFile = document.getElementById('avito-id-file');
  const avitoIdImportBtn = document.getElementById('avito-id-import');
  let avitoIdRows = [];

  if (avitoIdFile) {
    avitoIdFile.addEventListener('change', () => {
      const file = avitoIdFile.files[0];
      if (!file) return;
      document.getElementById('avito-id-filename').textContent = file.name;
      document.getElementById('avito-id-preview').textContent = 'Читаю файл...';
      avitoIdRows = [];
      avitoIdImportBtn.disabled = true;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { defval: '' });

          // Ищем столбцы Id и AvitoId (без учёта регистра и пробелов)
          if (data.length === 0) {
            document.getElementById('avito-id-preview').textContent = 'Файл пуст.';
            return;
          }
          const keys = Object.keys(data[0]);
          const idKey = keys.find(k => k.trim().toLowerCase() === 'id');
          const avitoKey = keys.find(k => k.trim().toLowerCase() === 'avitoid');
          if (!idKey || !avitoKey) {
            document.getElementById('avito-id-preview').innerHTML =
              `<span style="color:var(--red)">Не найдены столбцы Id и/или AvitoId. Найдены: ${keys.join(', ')}</span>`;
            return;
          }

          avitoIdRows = data
            .filter(r => r[idKey] !== '' && r[idKey] != null)
            .map(r => ({ id: String(r[idKey]).trim(), avitoId: String(r[avitoKey] ?? '').trim() }));

          document.getElementById('avito-id-preview').innerHTML =
            `Найдено строк: <b>${avitoIdRows.length}</b>. ` +
            `Пример: ${avitoIdRows.slice(0, 3).map(r => `${r.id} → ${r.avitoId}`).join(', ')}`;
          avitoIdImportBtn.disabled = avitoIdRows.length === 0;
        } catch (err) {
          document.getElementById('avito-id-preview').innerHTML =
            `<span style="color:var(--red)">Ошибка чтения файла: ${err.message}</span>`;
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  if (avitoIdImportBtn) {
    avitoIdImportBtn.addEventListener('click', async () => {
      if (!avitoIdRows.length) return;
      avitoIdImportBtn.disabled = true;
      const statusEl = document.getElementById('avito-id-status');
      showStatus('avito-id-status', 'Записываю в БД...', 'loading');
      try {
        const result = await apiRequest('/import/avito-id', {
          method: 'POST',
          body: JSON.stringify({ rows: avitoIdRows })
        });
        showStatus('avito-id-status',
          `✅ Обновлено: ${result.updated} из ${result.total}` +
          (result.notFound > 0 ? ` (не найдено в БД: ${result.notFound})` : ''),
          'success');
      } catch (err) {
        showStatus('avito-id-status', `Ошибка: ${err.message}`, 'error');
      } finally {
        avitoIdImportBtn.disabled = false;
      }
    });
  }


  // Проверка статусов объявлений
  const checkStatusFile = document.getElementById('check-status-file');
  const checkStatusBtn = document.getElementById('check-status-btn');
  let checkStatusIds = [];
  let checkStatusLastResult = null;

  if (checkStatusFile) {
    checkStatusFile.addEventListener('change', () => {
      const file = checkStatusFile.files[0];
      if (!file) return;
      document.getElementById('check-status-filename').textContent = file.name;
      checkStatusIds = [];
      checkStatusBtn.disabled = true;
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
          const keys = data.length ? Object.keys(data[0]) : [];
          const idKey = keys.find(k => k.trim().toLowerCase() === 'id');
          if (!idKey) {
            document.getElementById('check-status-preview').innerHTML =
              `<span style="color:var(--red)">Не найден столбец Id. Найдены: ${keys.join(', ')}</span>`;
            return;
          }
          checkStatusIds = data.map(r => String(r[idKey]).trim()).filter(Boolean);
          document.getElementById('check-status-preview').innerHTML =
            `Найдено ID: <b>${checkStatusIds.length}</b>. Пример: ${checkStatusIds.slice(0, 3).join(', ')}`;
          checkStatusBtn.disabled = checkStatusIds.length === 0;
        } catch (err) {
          document.getElementById('check-status-preview').innerHTML =
            `<span style="color:var(--red)">Ошибка чтения файла: ${err.message}</span>`;
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  if (checkStatusBtn) {
    checkStatusBtn.addEventListener('click', async () => {
      if (!checkStatusIds.length) return;
      checkStatusBtn.disabled = true;
      const resultEl = document.getElementById('check-status-result');
      const exportDiv = document.getElementById('check-status-export');
      resultEl.innerHTML = '<span style="color:var(--text-2)">Проверяю...</span>';
      exportDiv.style.display = 'none';
      try {
        const resp = await fetch('/api/import/check-statuses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: checkStatusIds })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || resp.statusText);
        checkStatusLastResult = data;
        resultEl.innerHTML = `
          <div style="margin-bottom:8px;">
            <b>Проверка 1 — сняты с продажи:</b>
            <span style="color:${data.removed.length ? 'var(--red)' : 'var(--green)'}"> ${data.removed.length} объявлений</span>
            ${data.removed.length ? `<div style="font-size:12px;color:var(--text-2);margin-top:4px;">${data.removed.slice(0,5).map(r=>`${r.id}: ${r.name}`).join('<br>')}${data.removed.length>5?`<br>...ещё ${data.removed.length-5}`:''}</div>` : ''}
          </div>
          <div>
            <b>Проверка 2 — не опубликовано на Авито:</b>
            <span style="color:${data.notPublished.length ? 'var(--yellow,#f5a623)' : 'var(--green)'}"> ${data.notPublished.length} объявлений</span>
            ${data.notPublished.length ? `<div style="font-size:12px;color:var(--text-2);margin-top:4px;">${data.notPublished.slice(0,5).map(r=>`${r.id}: ${r.name}`).join('<br>')}${data.notPublished.length>5?`<br>...ещё ${data.notPublished.length-5}`:''}</div>` : ''}
          </div>`;
        if (data.removed.length || data.notPublished.length) exportDiv.style.display = 'block';
      } catch (err) {
        resultEl.innerHTML = `<span style="color:var(--red)">Ошибка: ${err.message}</span>`;
      } finally {
        checkStatusBtn.disabled = false;
      }
    });
  }

  const checkStatusExportBtn = document.getElementById('check-status-export-btn');
  if (checkStatusExportBtn) {
    checkStatusExportBtn.addEventListener('click', () => {
      if (!checkStatusLastResult) return;
      const wb = XLSX.utils.book_new();
      // Лист 1: сняты с продажи
      const removed = checkStatusLastResult.removed.map(r => ({ ID: r.id, Название: r.name }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(removed.length ? removed : [{ ID: '', Название: 'Нет данных' }]), 'Сняты с продажи');
      // Лист 2: не опубликованы
      const notPub = checkStatusLastResult.notPublished.map(r => ({ ID: r.id, Название: r.name }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(notPub.length ? notPub : [{ ID: '', Название: 'Нет данных' }]), 'Не опубликованы');
      XLSX.writeFile(wb, `check-statuses-${new Date().toISOString().slice(0,10)}.xlsx`);
    });
  }

  // ---- Baikal tab: Обновить текст ----
  let bTextLastResult = null;
  const bTextFile = document.getElementById('b-text-file');
  const bTextPreview = document.getElementById('b-text-preview');
  const bTextBtn = document.getElementById('b-text-import');
  const bTextResult = document.getElementById('b-text-status');
  if (bTextFile) {
    bTextFile.addEventListener('change', () => {
      const file = bTextFile.files[0];
      if (!file) return;
      const fnSpan = document.getElementById('b-text-filename');
      if (fnSpan) fnSpan.textContent = file.name;
      const reader = new FileReader();
      reader.onload = e => {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const keys = data.length ? Object.keys(data[0]) : [];
        const idKey = keys.find(k => k.trim().toLowerCase() === 'id') || 'id';
        const textKey = keys.find(k => ['text', 'text_avito', 'description', 'текст', 'описание'].includes(k.trim().toLowerCase()));
        const rows = data.map(r => {
          const id = r[idKey] ?? r['id'] ?? r['Id'] ?? r['ID'] ?? '';
          const text = textKey ? r[textKey] : '';
          return { id: String(id).trim(), text: String(text ?? '').trim() };
        }).filter(r => r.id);
        bTextLastResult = rows;
        if (bTextPreview) bTextPreview.textContent = `Загружено строк: ${rows.length}. Колонка текста: "${textKey ?? 'не найдена'}". Пример: id=${rows[0]?.id}, text=${String(rows[0]?.text ?? '').slice(0,50)}`;
        if (bTextBtn) bTextBtn.disabled = false;
      };
      reader.readAsArrayBuffer(file);
    });
  }
  if (bTextBtn) {
    bTextBtn.addEventListener('click', async () => {
      if (!bTextLastResult || !bTextLastResult.length) return;
      bTextBtn.disabled = true;
      if (bTextResult) bTextResult.innerHTML = 'Отправка...';
      try {
        const res = await fetch('/api/import/baikal/text', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: bTextLastResult })
        });
        const data = await res.json();
        if (bTextResult) bTextResult.innerHTML = data.success
          ? `<span style="color:var(--green)">Обновлено: ${data.updated} из ${data.total}</span>`
          : `<span style="color:var(--red)">Ошибка: ${data.error}</span>`;
      } catch (err) {
        if (bTextResult) bTextResult.innerHTML = `<span style="color:var(--red)">Ошибка: ${err.message}</span>`;
      } finally {
        bTextBtn.disabled = false;
      }
    });
  }

  // ---- Baikal tab: Внести ImageUrls ----
  let bImageUrlsLastResult = null;
  const bImageUrlsFile = document.getElementById('b-image-urls-file');
  const bImageUrlsPreview = document.getElementById('b-image-urls-preview');
  const bImageUrlsBtn = document.getElementById('b-image-urls-import');
  const bImageUrlsResult = document.getElementById('b-image-urls-status');
  if (bImageUrlsFile) {
    bImageUrlsFile.addEventListener('change', () => {
      const file = bImageUrlsFile.files[0];
      if (!file) return;
      const fnSpan = document.getElementById('b-image-urls-filename');
      if (fnSpan) fnSpan.textContent = file.name;
      const reader = new FileReader();
      reader.onload = e => {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const rows = data.map(r => {
          const id = r['id'] ?? r['Id'] ?? r['ID'] ?? '';
          const imageUrls = r['ImageUrls'] ?? r['imageUrls'] ?? r['image_urls'] ?? '';
          return { id: String(id), imageUrls: String(imageUrls) };
        }).filter(r => r.id);
        bImageUrlsLastResult = rows;
        if (bImageUrlsPreview) bImageUrlsPreview.textContent = `Загружено строк: ${rows.length}. Пример: id=${rows[0]?.id}, urls=${String(rows[0]?.imageUrls ?? '').slice(0,40)}`;
        if (bImageUrlsBtn) bImageUrlsBtn.disabled = false;
      };
      reader.readAsArrayBuffer(file);
    });
  }
  if (bImageUrlsBtn) {
    bImageUrlsBtn.addEventListener('click', async () => {
      if (!bImageUrlsLastResult || !bImageUrlsLastResult.length) return;
      bImageUrlsBtn.disabled = true;
      if (bImageUrlsResult) bImageUrlsResult.innerHTML = 'Отправка...';
      try {
        const res = await fetch('/api/import/baikal/image-urls', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: bImageUrlsLastResult })
        });
        const data = await res.json();
        if (bImageUrlsResult) bImageUrlsResult.innerHTML = data.success
          ? `<span style="color:var(--green)">Обновлено: ${data.updated} из ${data.total}</span>`
          : `<span style="color:var(--red)">Ошибка: ${data.error}</span>`;
      } catch (err) {
        if (bImageUrlsResult) bImageUrlsResult.innerHTML = `<span style="color:var(--red)">Ошибка: ${err.message}</span>`;
      } finally {
        bImageUrlsBtn.disabled = false;
      }
    });
  }

  // ---- Baikal tab: Исправить десятичные разделители ----
  const bFixDecimalsBtn = document.getElementById('b-fix-decimals-btn');
  const bFixDecimalsResult = document.getElementById('b-fix-decimals-status');
  if (bFixDecimalsBtn) {
    bFixDecimalsBtn.addEventListener('click', async () => {
      bFixDecimalsBtn.disabled = true;
      if (bFixDecimalsResult) bFixDecimalsResult.innerHTML = 'Обработка...';
      try {
        const res = await fetch('/api/import/baikal/fix-decimals', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const data = await res.json();
        if (bFixDecimalsResult) bFixDecimalsResult.innerHTML = data.success
          ? `<span style="color:var(--green)">Исправлено: centr_otv=${data.results.centr_otv}, diam_otv=${data.results.diam_otv}, width=${data.results.width}</span>`
          : `<span style="color:var(--red)">Ошибка: ${data.error}</span>`;
      } catch (err) {
        if (bFixDecimalsResult) bFixDecimalsResult.innerHTML = `<span style="color:var(--red)">Ошибка: ${err.message}</span>`;
      } finally {
        bFixDecimalsBtn.disabled = false;
      }
    });
  }

  // ---- Baikal tab: Внести AvitoId ----
  let bAvitoIdLastResult = null;
  const bAvitoIdFile = document.getElementById('b-avito-id-file');
  const bAvitoIdPreview = document.getElementById('b-avito-id-preview');
  const bAvitoIdBtn = document.getElementById('b-avito-id-import');
  const bAvitoIdResult = document.getElementById('b-avito-id-status');
  if (bAvitoIdFile) {
    bAvitoIdFile.addEventListener('change', () => {
      const file = bAvitoIdFile.files[0];
      if (!file) return;
      const fnSpan = document.getElementById('b-avito-id-filename');
      if (fnSpan) fnSpan.textContent = file.name;
      const reader = new FileReader();
      reader.onload = e => {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const rows = data.map(r => {
          const id = r['id'] ?? r['Id'] ?? r['ID'] ?? '';
          const avitoId = r['avitoId'] ?? r['avito_id'] ?? r['AvitoId'] ?? r['Avito_id'] ?? '';
          return { id: String(id), avitoId: String(avitoId) };
        }).filter(r => r.id);
        bAvitoIdLastResult = rows;
        if (bAvitoIdPreview) bAvitoIdPreview.textContent = `Загружено строк: ${rows.length}. Пример: id=${rows[0]?.id}, avitoId=${rows[0]?.avitoId}`;
        if (bAvitoIdBtn) bAvitoIdBtn.disabled = false;
      };
      reader.readAsArrayBuffer(file);
    });
  }
  if (bAvitoIdBtn) {
    bAvitoIdBtn.addEventListener('click', async () => {
      if (!bAvitoIdLastResult || !bAvitoIdLastResult.length) return;
      bAvitoIdBtn.disabled = true;
      if (bAvitoIdResult) bAvitoIdResult.innerHTML = 'Отправка...';
      try {
        const res = await fetch('/api/import/baikal/avito-id', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: bAvitoIdLastResult })
        });
        const data = await res.json();
        if (bAvitoIdResult) bAvitoIdResult.innerHTML = data.success
          ? `<span style="color:var(--green)">Обновлено: ${data.updated} из ${data.total}</span>`
          : `<span style="color:var(--red)">Ошибка: ${data.error}</span>`;
      } catch (err) {
        if (bAvitoIdResult) bAvitoIdResult.innerHTML = `<span style="color:var(--red)">Ошибка: ${err.message}</span>`;
      } finally {
        bAvitoIdBtn.disabled = false;
      }
    });
  }

  // ---- Baikal tab: Проверка статусов объявлений ----
  let bCheckStatusLastResult = null;
  const bCheckStatusFile = document.getElementById('b-check-status-file');
  const bCheckStatusBtn = document.getElementById('b-check-status-btn');
  const bCheckStatusResult = document.getElementById('b-check-status-result');
  const bCheckStatusExportBtn = document.getElementById('b-check-status-export-btn');
  if (bCheckStatusFile) {
    bCheckStatusFile.addEventListener('change', () => {
      const file = bCheckStatusFile.files[0];
      const fnSpan = document.getElementById('b-check-status-filename');
      if (fnSpan && file) fnSpan.textContent = file.name;
      if (bCheckStatusBtn) bCheckStatusBtn.disabled = !file;
    });
  }
  if (bCheckStatusBtn) {
    bCheckStatusBtn.addEventListener('click', async () => {
      const file = bCheckStatusFile?.files[0];
      if (!file) return;
      bCheckStatusBtn.disabled = true;
      if (bCheckStatusResult) bCheckStatusResult.innerHTML = 'Обработка...';
      try {
        const arrayBuffer = await file.arrayBuffer();
        const wb = XLSX.read(arrayBuffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const ids = data.map(r => {
          const id = r['id'] ?? r['Id'] ?? r['ID'] ?? r['Id товара'] ?? '';
          return String(id).trim();
        }).filter(Boolean);
        if (!ids.length) {
          if (bCheckStatusResult) bCheckStatusResult.innerHTML = '<span style="color:var(--red)">Нет ID в файле</span>';
          bCheckStatusBtn.disabled = false;
          return;
        }
        const res = await fetch('/api/import/baikal/check-statuses', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids })
        });
        const resultData = await res.json();
        bCheckStatusLastResult = resultData;
        const exportDiv = document.getElementById('b-check-status-export');
        if (bCheckStatusResult) bCheckStatusResult.innerHTML = `
          <div>Снятые с продажи (в файле, но removed в БД): <b>${resultData.removed.length}</b></div>
          <div>Не опубликованы (в БД активные, но нет в файле): <b>${resultData.notPublished.length}</b></div>`;
        if (exportDiv) exportDiv.style.display = 'block';
      } catch (err) {
        if (bCheckStatusResult) bCheckStatusResult.innerHTML = `<span style="color:var(--red)">Ошибка: ${err.message}</span>`;
      } finally {
        bCheckStatusBtn.disabled = false;
      }
    });
  }
  if (bCheckStatusExportBtn) {
    bCheckStatusExportBtn.addEventListener('click', () => {
      if (!bCheckStatusLastResult) return;
      const wb = XLSX.utils.book_new();
      const removed = bCheckStatusLastResult.removed.map(r => ({ ID: r.id, Название: r.name }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(removed.length ? removed : [{ ID: '', Название: 'Нет данных' }]), 'Сняты с продажи');
      const notPub = bCheckStatusLastResult.notPublished.map(r => ({ ID: r.id, Название: r.name }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(notPub.length ? notPub : [{ ID: '', Название: 'Нет данных' }]), 'Не опубликованы');
      XLSX.writeFile(wb, `baikal-check-statuses-${new Date().toISOString().slice(0,10)}.xlsx`);
    });
  }

  // Section tabs (Корректировка БД)
  document.querySelectorAll('.section-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      document.querySelectorAll('.section-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.section-tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.getElementById(`tab-${tabId}`);
      if (pane) pane.classList.add('active');
    });
  });
}

// ============================================================================
// Initialization
// ============================================================================

async function checkServer() {
  const el = document.getElementById('server-check');
  if (!el) return;
  try {
    const res = await fetch(`${window.location.origin}/health`);
    const text = await res.text();
    const isJson = res.headers.get('content-type')?.includes('application/json');
    if (!res.ok || !isJson || (text && text.trim().startsWith('<'))) {
      el.className = 'server-check warn';
      el.textContent = 'На этом порту запущен не дашборд Avito Monitor. Остановите другой процесс и в папке price-monitoring выполните: npm start (в .env задайте PORT=3002 при необходимости).';
      return;
    }
    const data = JSON.parse(text);
    if (data?.status === 'healthy') {
      el.className = 'server-check ok';
      el.textContent = 'Сервер дашборда отвечает. Ссылки будут сохраняться на сервер.';
    } else {
      el.className = 'server-check warn';
      el.textContent = 'Сервер вернул неожиданный ответ. Запустите дашборд из папки price-monitoring: npm start';
    }
  } catch (e) {
    el.className = 'server-check warn';
    el.textContent = 'Не удалось подключиться к серверу. Запустите дашборд из папки price-monitoring: npm start';
  }
}

// ── Авито загрузка ─────────────────────────────────────────────────────────────

const AVITO_STATIC_FIELDS = [
  'AvitoStatus', 'AvitoDateEnd', 'ListingFee', 'Category', 'GoodsType',
  'ProductType', 'Condition', 'AddressID', 'Address', 'EMail',
  'ContactPhone', 'ContactMethod', 'AdType', 'CompanyName', 'MultiItem',
  'Quantity', 'TargetAudience', 'TypeID'
];

async function loadAvitoSettings() {
  try {
    const settings = await apiRequest('/avito-export/settings');
    for (const field of AVITO_STATIC_FIELDS) {
      const el = document.getElementById(`avito-${field}`);
      if (el && settings[field] !== undefined) el.value = settings[field];
    }
  } catch (e) {
    console.warn('Failed to load avito settings:', e.message);
  }
}

async function saveAvitoSettings() {
  const settings = {};
  for (const field of AVITO_STATIC_FIELDS) {
    const el = document.getElementById(`avito-${field}`);
    if (el) settings[field] = el.value;
  }
  try {
    await apiRequest('/avito-export/settings', { method: 'PUT', body: JSON.stringify(settings) });
    showStatus('avito-settings-status', '✅ Настройки сохранены', 'success');
  } catch (e) {
    showStatus('avito-settings-status', `Ошибка: ${e.message}`, 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Initializing Avito Price Monitoring Dashboard...');
  initNavigation();
  initEventListeners();
  initBrowseDbPath();
  initPhotoReplace();
  await checkServer();
  await loadConfig();
  await loadAvitoSources();

  // Авито загрузка: кнопки
  const avitoSaveBtn = document.getElementById('avito-settings-save');
  if (avitoSaveBtn) avitoSaveBtn.addEventListener('click', saveAvitoSettings);

  const avitoExportBtn = document.getElementById('avito-export-btn');
  if (avitoExportBtn) {
    avitoExportBtn.addEventListener('click', async () => {
      avitoExportBtn.disabled = true;
      showStatus('avito-settings-status', 'Генерирую файл...', 'loading');
      try {
        // Сначала сохраняем текущие настройки
        const settings = {};
        for (const field of AVITO_STATIC_FIELDS) {
          const el = document.getElementById(`avito-${field}`);
          if (el) settings[field] = el.value;
        }
        await apiRequest('/avito-export/settings', { method: 'PUT', body: JSON.stringify(settings) });
        // Затем скачиваем файл
        const tableSelect = document.getElementById('avito-export-table');
        const table = tableSelect ? tableSelect.value : 'VSE4';
        window.location.href = `/api/avito-export/export?table=${table}`;
        showStatus('avito-settings-status', '✅ Файл скачивается', 'success');
      } catch (e) {
        showStatus('avito-settings-status', `Ошибка: ${e.message}`, 'error');
      } finally {
        avitoExportBtn.disabled = false;
      }
    });
  }

  // ── Раздел «Новые объявления» ──────────────────────────────────────────────
  initAddItems();

  // ── Генератор текста ───────────────────────────────────────────────────────
  initTextGen();

  console.log('✅ Dashboard ready');
});

// ============================================================================
// Раздел «Новые объявления»
// ============================================================================

// Текущий активный alias (определяется активной вкладкой)
let addItemsAlias = 'VSE4';

function initAddItems() {
  const parseBtn    = document.getElementById('add-items-parse-btn');
  const loadBtn     = document.getElementById('add-items-load-btn');
  const urlsEl      = document.getElementById('add-items-urls');
  const resultsCard = document.getElementById('add-items-results-card');

  if (!parseBtn) return;

  // Переключение вкладок
  document.querySelectorAll('.add-items-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.add-items-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      addItemsAlias = btn.dataset.alias;
      // Скрываем результаты при смене вкладки (данные другого alias)
      resultsCard.style.display = 'none';
      document.getElementById('add-items-parse-status').textContent = '';
    });
  });

  // Запуск парсинга
  parseBtn.addEventListener('click', async () => {
    const alias = addItemsAlias;
    const rawUrls = (urlsEl.value || '').split('\n').map(s => s.trim()).filter(Boolean);

    if (rawUrls.length === 0) {
      showStatus('add-items-parse-status', 'Введите хотя бы одну ссылку', 'error');
      return;
    }

    const dbPath = document.getElementById('config-db-path')?.value?.trim();
    if (!dbPath) {
      showStatus('add-items-parse-status', 'Укажите DB Path в Настройках', 'error');
      return;
    }

    parseBtn.disabled = true;
    showStatus('add-items-parse-status', `⏳ Запуск парсинга ${rawUrls.length} ссылок…`, 'info');

    try {
      const res = await apiRequest('/new-items/parse', {
        method: 'POST',
        body: JSON.stringify({ alias, urls: rawUrls, dbPath }),
      });

      showStatus('add-items-parse-status',
        `✅ Парсинг запущен (${res.total} URL). Ожидайте результатов…`, 'success');

      // Поллинг: ждём завершения и загружаем результаты
      await pollUntilParseComplete(alias, dbPath, res.batchId);

    } catch (e) {
      showStatus('add-items-parse-status', `Ошибка: ${e.message}`, 'error');
    } finally {
      parseBtn.disabled = false;
    }
  });

  // Экспорт выбранных строк
  const exportBtn = document.getElementById('add-items-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      const alias  = addItemsAlias;
      const dbPath = document.getElementById('config-db-path')?.value?.trim();
      if (!dbPath) { showStatus('add-items-parse-status', 'Укажите DB Path', 'error'); return; }

      const checked = [...document.querySelectorAll('#add-items-tbody .ni-row-check:checked')];
      const rowids  = checked.map(cb => parseInt(cb.value));
      if (rowids.length === 0) return;

      if (!confirm(`Экспортировать ${rowids.length} строк из ${alias}_new → ${alias === 'baikal' ? 'baikal' : 'VSE4'}?\nПосле экспорта строки будут удалены из временной таблицы.`)) return;

      exportBtn.disabled = true;
      try {
        const res = await apiRequest(`/new-items/export/${alias}`, {
          method: 'POST',
          body: JSON.stringify({ dbPath, rowids }),
        });
        showStatus('add-items-parse-status',
          `✅ Экспортировано ${res.exported} строк. ID: ${res.ids.slice(0, 5).join(', ')}${res.ids.length > 5 ? '…' : ''}`,
          'success');
        await loadAndRenderNewItems(alias, dbPath, null);
      } catch (e) {
        showStatus('add-items-parse-status', `Ошибка экспорта: ${e.message}`, 'error');
        exportBtn.disabled = false;
      }
    });
  }

  // Загрузить сохранённые (из БД)
  loadBtn.addEventListener('click', async () => {
    const alias = addItemsAlias;
    const dbPath = document.getElementById('config-db-path')?.value?.trim();
    if (!dbPath) {
      showStatus('add-items-parse-status', 'Укажите DB Path в Настройках', 'error');
      return;
    }
    await loadAndRenderNewItems(alias, dbPath, null);
  });
}

function updateExportBtn() {
  const btn = document.getElementById('add-items-export-btn');
  if (!btn) return;
  const checked = document.querySelectorAll('#add-items-tbody .ni-row-check:checked');
  btn.disabled = checked.length === 0;
  btn.textContent = checked.length > 0
    ? `↑ Экспортировать (${checked.length})`
    : '↑ Экспортировать выбранные';
}

/** Поллит /status каждые 3с, после завершения загружает результаты */
async function pollUntilParseComplete(alias, dbPath, batchId) {
  const maxWait = 20 * 60 * 1000; // 20 минут
  const interval = 3000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, interval));
    try {
      const status = await apiRequest('/new-items/status');
      if (!status.running) {
        // Парсинг завершён — загружаем результаты
        await loadAndRenderNewItems(alias, dbPath, batchId);
        showStatus('add-items-parse-status', '✅ Парсинг завершён', 'success');
        return;
      }
    } catch { /* продолжаем поллинг */ }
  }
  showStatus('add-items-parse-status', '⚠️ Превышено время ожидания', 'error');
}

// Состояние сортировки таблицы
let niSortField = null;
let niSortDir   = 'asc';

/** Загружает строки из *_new и рендерит таблицу */
async function loadAndRenderNewItems(alias, dbPath, batchId) {
  const resultsCard = document.getElementById('add-items-results-card');
  const tbody       = document.getElementById('add-items-tbody');
  const batchLabel  = document.getElementById('add-items-batch-label');
  const statsEl     = document.getElementById('add-items-stats');
  const aliasBadge  = document.getElementById('add-items-alias-badge');

  try {
    const query = batchId ? `?dbPath=${encodeURIComponent(dbPath)}&batchId=${batchId}`
                          : `?dbPath=${encodeURIComponent(dbPath)}`;
    const data = await apiRequest(`/new-items/list/${alias}${query}`);
    const items = data.items || [];

    resultsCard.style.display = items.length > 0 ? '' : 'none';
    if (items.length === 0) {
      showStatus('add-items-parse-status', 'Нет сохранённых записей для этого источника', 'info');
      return;
    }

    if (aliasBadge) aliasBadge.textContent = alias;
    if (batchId) batchLabel.textContent = `batch: ${batchId.slice(0, 8)}…`;
    else batchLabel.textContent = '(все сохранённые)';

    const ok    = items.filter(i => !i.error_message).length;
    const errors = items.filter(i => i.error_message).length;
    statsEl.textContent = `Всего: ${items.length} | ✅ ${ok} | ❌ ${errors}`;

    // Сортировка
    if (niSortField) {
      items.sort((a, b) => {
        const av = a[niSortField] ?? '';
        const bv = b[niSortField] ?? '';
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'ru');
        return niSortDir === 'asc' ? cmp : -cmp;
      });
    }

    // Обновляем иконки сортировки
    document.querySelectorAll('#add-items-results-card .sortable').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === niSortField) th.classList.add(`sort-${niSortDir}`);
    });

    tbody.innerHTML = items.map((item, idx) => {
      const hasError = !!item.error_message;
      const photoStatus = item.photo_status || 'not_attached';
      const hasPhoto = photoStatus !== 'not_attached';

      return `<tr class="${hasError ? 'row-error' : ''}" data-rowid="${item.rowid}">
        <td style="text-align:center;">
          <input type="checkbox" class="ni-row-check" value="${item.rowid}">
        </td>
        <td style="color:var(--text-2);font-size:12px;">${idx + 1}</td>
        <td>
          <a href="${item.url_vse || item.url_bai || '#'}" target="_blank" class="link"
             title="${escHtml(item.url_corr || '')}">
            ${escHtml(item.name || (hasError ? '❌ ' + item.error_message : '—'))}
          </a>
        </td>
        <td style="text-align:right;">${item.price_vse ?? item.price_bai ?? '—'}</td>
        <td style="font-size:12px;">${escHtml(item.type_disk || '—')}</td>
        <td style="font-size:12px;">${escHtml(item.maker || '—')}</td>
        <td style="font-size:12px;">${escHtml(item.model || '—')}</td>
        <td style="text-align:center;">${item.diam ?? '—'}</td>
        <td style="text-align:center;">${item.width ?? '—'}</td>
        <td style="text-align:center;">${item.vylet ?? '—'}</td>
        <td style="text-align:center;">${item.diam_otv ?? '—'}</td>
        <td style="text-align:center;">${item.centr_otv ?? '—'}</td>
        <td style="font-size:12px;">${escHtml(item.color || '—')}</td>
        <td style="text-align:center;">
          <button class="btn btn-secondary btn-xs add-items-photo-btn"
            data-rowid="${item.rowid}" data-alias="${alias}" data-dbpath="${escHtml(dbPath)}"
            data-has-photo="${hasPhoto}"
            title="${hasPhoto ? 'Фото прикреплено. Нажмите чтобы изменить' : 'Выбрать папку с фото'}">
            ${hasPhoto ? '📁 ✅' : '📁'}
          </button>
        </td>
        <td style="text-align:center;font-size:11px;">
          <span class="badge badge-${photoStatus}">${photoStatusLabel(photoStatus)}</span>
        </td>
        <td style="text-align:center;">
          <button class="btn btn-secondary btn-xs add-items-gen-btn"
            data-rowid="${item.rowid}" data-alias="${alias}" data-dbpath="${escHtml(dbPath)}"
            title="${item.text_avito ? escHtml(item.text_avito.slice(0,120)) : 'Сгенерировать текст'}">
            ${item.text_avito ? '✍✅' : '✍'}
          </button>
        </td>
      </tr>`;
    }).join('');

    // Обработчики кнопок выбора папки с фото
    tbody.querySelectorAll('.add-items-photo-btn').forEach(btn => {
      btn.addEventListener('click', () => openPhotoPicker(btn));
    });

    // Обработчики кнопок генерации текста
    tbody.querySelectorAll('.add-items-gen-btn').forEach(btn => {
      btn.addEventListener('click', () => generateTextForRow(btn));
    });

    // Сортировка по заголовку
    document.querySelectorAll('#add-items-results-card .sortable').forEach(th => {
      th.onclick = () => {
        const field = th.dataset.sort;
        if (niSortField === field) {
          niSortDir = niSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          niSortField = field;
          niSortDir = 'asc';
        }
        loadAndRenderNewItems(alias, dbPath, batchId);
      };
    });

    // Чекбокс «выбрать все»
    const selectAll = document.getElementById('add-items-select-all');
    if (selectAll) {
      selectAll.checked = false;
      selectAll.onchange = () => {
        tbody.querySelectorAll('.ni-row-check').forEach(cb => { cb.checked = selectAll.checked; });
        updateExportBtn();
      };
    }
    tbody.querySelectorAll('.ni-row-check').forEach(cb => {
      cb.addEventListener('change', updateExportBtn);
    });
    updateExportBtn();

    // Кнопка «Текст для всех»
    const genAllBtn = document.getElementById('add-items-gen-all-btn');
    if (genAllBtn) {
      genAllBtn.onclick = async () => {
        const dbPath2 = document.getElementById('config-db-path')?.value?.trim();
        if (!dbPath2) return;
        genAllBtn.disabled = true;
        try {
          const res = await apiRequest('/text-gen/generate-batch', {
            method: 'POST',
            body: JSON.stringify({ alias, dbPath: dbPath2 }),
          });
          // Перерисовываем таблицу
          await loadAndRenderNewItems(alias, dbPath2, null);
          showStatus('add-items-parse-status', `✅ Текст сгенерирован для ${res.count} строк`, 'success');
        } catch (e) {
          showStatus('add-items-parse-status', `Ошибка генерации: ${e.message}`, 'error');
        } finally {
          genAllBtn.disabled = false;
        }
      };
    }

  } catch (e) {
    showStatus('add-items-parse-status', `Ошибка загрузки: ${e.message}`, 'error');
  }
}

/** Показывает диалог ввода пути к папке, сервер сканирует папку и сохраняет фото */
function openPhotoPicker(btn) {
  const rowid    = btn.dataset.rowid;
  const alias    = btn.dataset.alias;
  const dbPath   = btn.dataset.dbpath;
  const hasPhoto = btn.dataset.hasPhoto === 'true';

  // Удаляем предыдущий диалог если есть
  document.getElementById('photo-picker-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'photo-picker-modal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.5);
  `;
  modal.innerHTML = `
    <div style="background:var(--bg-card,#1e1e2e);border:1px solid var(--border,#333);border-radius:10px;
                padding:24px;min-width:480px;max-width:680px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
      <div style="font-size:15px;font-weight:600;margin-bottom:16px;">Папка с фотографиями</div>
      <div style="font-size:13px;color:var(--text-2,#aaa);margin-bottom:10px;">
        Введите полный путь к папке (например: <code>C:\\Photos\\Арт. VSE-30001</code>)
      </div>
      <input id="photo-picker-path" type="text" value=""
        placeholder="C:\\Users\\...\\папка с фото"
        style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;
               border:1px solid var(--border,#444);background:var(--bg,#12121e);
               color:inherit;font-size:13px;margin-bottom:6px;">
      <div id="photo-picker-status" style="font-size:12px;min-height:18px;margin-bottom:14px;"></div>
      <div style="display:flex;gap:10px;justify-content:space-between;">
        <div>
          ${hasPhoto ? `<button id="photo-picker-clear" class="btn btn-danger" style="font-size:12px;">
            Очистить фото
          </button>` : ''}
        </div>
        <div style="display:flex;gap:10px;">
          <button id="photo-picker-cancel" class="btn btn-secondary">Отмена</button>
          <button id="photo-picker-ok" class="btn btn-primary">Прикрепить</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const pathInput  = modal.querySelector('#photo-picker-path');
  const statusEl   = modal.querySelector('#photo-picker-status');
  const okBtn      = modal.querySelector('#photo-picker-ok');
  const cancelBtn  = modal.querySelector('#photo-picker-cancel');

  pathInput.focus();
  pathInput.select();

  const close = () => modal.remove();
  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  const clearBtn = modal.querySelector('#photo-picker-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      clearBtn.disabled = true;
      statusEl.style.color = 'var(--text-2,#aaa)';
      statusEl.textContent = '⏳ Очищаю…';
      try {
        await apiRequest(`/new-items/item/${alias}/${rowid}`, {
          method: 'PATCH',
          body: JSON.stringify({ dbPath, fields: { link_foto: null, photo_status: 'not_attached' } }),
        });
        btn.textContent = '📁';
        btn.title = 'Выбрать папку с фото';
        btn.dataset.hasPhoto = 'false';
        const badge = btn.closest('tr')?.querySelector('.badge');
        if (badge) { badge.className = 'badge badge-not_attached'; badge.textContent = photoStatusLabel('not_attached'); }
        close();
      } catch (e) {
        statusEl.style.color = 'var(--danger,#e55)';
        statusEl.textContent = `Ошибка: ${e.message}`;
        clearBtn.disabled = false;
      }
    });
  }

  const attach = async () => {
    const folderPath = pathInput.value.trim();
    if (!folderPath) {
      statusEl.style.color = 'var(--danger,#e55)';
      statusEl.textContent = 'Введите путь к папке';
      return;
    }

    okBtn.disabled = true;
    statusEl.style.color = 'var(--text-2,#aaa)';
    statusEl.textContent = '⏳ Сканирую папку…';

    try {
      const res = await apiRequest('/new-items/attach-photos', {
        method: 'POST',
        body: JSON.stringify({ alias, rowid, dbPath, folderPath }),
      });

      const count = res.files?.length ?? 0;
      statusEl.style.color = 'var(--success,#4c4)';
      statusEl.textContent = `✅ Найдено ${count} фото`;

      btn.textContent = '📁 ✅';
      btn.title = `${count} фото из: ${folderPath}`;
      const badge = btn.closest('tr')?.querySelector('.badge');
      if (badge) {
        badge.className = 'badge badge-attached';
        badge.textContent = photoStatusLabel('attached');
      }

      setTimeout(close, 800);
    } catch (e) {
      statusEl.style.color = 'var(--danger,#e55)';
      statusEl.textContent = `Ошибка: ${e.message}`;
      okBtn.disabled = false;
    }
  };

  okBtn.addEventListener('click', attach);
  pathInput.addEventListener('keydown', e => { if (e.key === 'Enter') attach(); });
}

function photoStatusLabel(status) {
  const map = {
    not_attached:    '—',
    attached:        'Фото ✓',
    uploaded_to_site:'На сайте',
    confirmed:       'Подтверждено',
  };
  return map[status] || status;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Генерация текста для одной строки ─────────────────────────────────────────

async function generateTextForRow(btn) {
  const rowid  = btn.dataset.rowid;
  const alias  = btn.dataset.alias;
  const dbPath = btn.dataset.dbpath;

  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '⏳';

  try {
    const res = await apiRequest('/text-gen/generate', {
      method: 'POST',
      body: JSON.stringify({ alias, rowid, dbPath }),
    });
    btn.textContent = '✍✅';
    btn.title = (res.text || '').slice(0, 120);
  } catch (e) {
    btn.textContent = orig;
    alert(`Ошибка генерации: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// Настройки генератора текста
// ============================================================================

let textGenConfig = { probability: 30, sentences: [] };

async function initTextGen() {
  const card = document.getElementById('text-gen-card');
  if (!card) return;

  try {
    textGenConfig = await apiRequest('/text-gen/config');
  } catch { /* используем дефолт */ }

  renderTextGenSentences();

  document.getElementById('text-gen-probability').value = textGenConfig.probability ?? 30;

  document.getElementById('text-gen-add-sentence-btn').addEventListener('click', () => {
    textGenConfig.sentences.push({
      id: crypto.randomUUID(),
      label: `Предложение ${textGenConfig.sentences.length + 1}`,
      tag: 'p',
      isColor: false,
      variants: [''],
    });
    renderTextGenSentences();
  });

  document.getElementById('text-gen-save-btn').addEventListener('click', async () => {
    textGenConfig.probability = parseInt(document.getElementById('text-gen-probability').value) || 0;
    try {
      await apiRequest('/text-gen/config', {
        method: 'PUT',
        body: JSON.stringify(textGenConfig),
      });
      showStatus('text-gen-status', '✅ Сохранено', 'success');
    } catch (e) {
      showStatus('text-gen-status', `Ошибка: ${e.message}`, 'error');
    }
  });
}

const TG_PRESET_TAGS = ['p', 'b', 'i', 'strong', 'em', 'u', 's', 'h2', 'h3', 'div', 'span'];

function renderTagsPreview(tags) {
  if (!tags || tags.length === 0) return '<span style="color:var(--text-2)">без тега</span>';
  const inner = '<em>текст</em>';
  let html = inner;
  for (const t of tags.slice().reverse()) html = `&lt;${t}&gt;${html}&lt;/${t}&gt;`;
  return `<code style="font-size:11px;">${html}</code>`;
}

function renderTextGenSentences() {
  const container = document.getElementById('text-gen-sentences');
  if (!container) return;

  container.innerHTML = textGenConfig.sentences.map((s, si) => {
    // Нормализуем: tags — массив; tag (старый формат) → tags
    if (!Array.isArray(s.tags)) s.tags = s.tag ? [s.tag] : [];
    // Нормализуем sourceField: isColor (старый формат) → sourceField
    const sourceField = s.sourceField ?? (s.isColor ? 'color' : 'text_replace');

    const SOURCE_OPTIONS = [
      { value: 'text_replace', label: 'Текст с заменой' },
      { value: 'text',         label: 'Текст без замен'  },
      { value: 'color',        label: 'Цвет (color)'     },
      { value: 'name',         label: 'Наименование (name)' },
    ];
    const selectOpts = SOURCE_OPTIONS.map(o =>
      `<option value="${o.value}" ${sourceField === o.value ? 'selected' : ''}>${o.label}</option>`
    ).join('');

    const isDbField = sourceField === 'color' || sourceField === 'name';
    const defaultPrefix = sourceField === 'color' ? 'Цвет - ' : '';
    const prefixVal = s.prefix ?? defaultPrefix;

    const tagsPreview = renderTagsPreview(s.tags);
    const presetBtns = TG_PRESET_TAGS.map(t => {
      const active = s.tags.includes(t);
      return `<button class="btn btn-xs tg-preset-tag ${active ? 'btn-primary' : 'btn-secondary'}"
        data-tag="${t}" style="font-family:monospace;">${t}</button>`;
    }).join('');

    return `
    <div class="card" style="padding:14px;background:var(--bg,#12121e);border:1px solid var(--border,#333);"
         data-sentence-idx="${si}">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap;">
        <input type="text" class="input tg-label" value="${escHtml(s.label)}" placeholder="Название"
          style="flex:1;min-width:120px;font-size:13px;">
        <label style="font-size:13px;display:flex;align-items:center;gap:6px;white-space:nowrap;">
          Тип:
          <select class="input tg-source-field" style="font-size:13px;padding:4px 6px;">${selectOpts}</select>
        </label>
        ${isDbField ? `<label style="font-size:13px;display:flex;align-items:center;gap:6px;">
          Префикс: <input type="text" class="input tg-prefix" value="${escHtml(prefixVal)}"
            style="width:110px;font-size:13px;">
        </label>` : ''}
        <button class="btn btn-danger btn-xs tg-del-sentence" style="margin-left:auto;">✕</button>
      </div>

      <div style="margin-bottom:8px;">
        <div style="font-size:12px;color:var(--text-2);margin-bottom:6px;">
          Теги (порядок = вложенность): ${tagsPreview}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;">${presetBtns}</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="text" class="input tg-custom-tag" placeholder="свой тег..."
            style="width:110px;font-size:12px;">
          <button class="btn btn-secondary btn-xs tg-add-custom-tag">+ добавить</button>
          <button class="btn btn-secondary btn-xs tg-clear-tags" style="color:var(--danger,#e55);">✕ очистить</button>
        </div>
        <div class="tg-selected-tags" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
          ${s.tags.map((t, ti) => `
            <span style="background:var(--accent,#c9a227);color:#000;border-radius:4px;
                         padding:2px 6px;font-size:12px;font-family:monospace;display:flex;align-items:center;gap:4px;">
              ${ti > 0 ? `<span style="opacity:.6;font-size:10px;">${ti + 1}</span>` : ''}
              ${escHtml(t)}
              <button class="tg-remove-tag" data-ti="${ti}"
                style="background:none;border:none;cursor:pointer;padding:0;color:#000;font-size:11px;">✕</button>
            </span>
          `).join('')}
        </div>
      </div>

      ${isDbField
        ? `<div style="font-size:12px;color:var(--text-2);">Значение берётся из поля <code>${sourceField}</code> текущей строки.</div>`
        : `<div class="tg-variants" style="display:flex;flex-direction:column;gap:6px;">
          ${(s.variants || []).map((v, vi) => `
            <div style="display:flex;gap:6px;">
              <textarea class="input tg-variant" rows="2"
                style="flex:1;font-size:12px;resize:vertical;">${escHtml(v)}</textarea>
              <button class="btn btn-danger btn-xs tg-del-variant" data-vi="${vi}"
                style="align-self:flex-start;">✕</button>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-secondary btn-xs tg-add-variant" style="margin-top:6px;">+ Вариант</button>`
      }
    </div>`;
  }).join('');

  container.querySelectorAll('[data-sentence-idx]').forEach(el => {
    const si = parseInt(el.dataset.sentenceIdx);
    const s  = textGenConfig.sentences[si];

    el.querySelector('.tg-label').addEventListener('input', e => { s.label = e.target.value; });
    el.querySelector('.tg-source-field').addEventListener('change', e => {
      s.sourceField = e.target.value;
      delete s.isColor; // убираем старый формат
      s.prefix = undefined;
      renderTextGenSentences();
    });
    el.querySelector('.tg-prefix')?.addEventListener('input', e => { s.prefix = e.target.value; });
    el.querySelector('.tg-del-sentence').addEventListener('click', () => {
      textGenConfig.sentences.splice(si, 1);
      renderTextGenSentences();
    });

    // Пресеты тегов — toggle
    el.querySelectorAll('.tg-preset-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        const idx = s.tags.indexOf(tag);
        if (idx === -1) s.tags.push(tag); else s.tags.splice(idx, 1);
        renderTextGenSentences();
      });
    });

    // Кастомный тег
    const customInput = el.querySelector('.tg-custom-tag');
    el.querySelector('.tg-add-custom-tag').addEventListener('click', () => {
      const val = customInput.value.trim().replace(/[<>/]/g, '');
      if (val && !s.tags.includes(val)) { s.tags.push(val); renderTextGenSentences(); }
    });
    customInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') el.querySelector('.tg-add-custom-tag').click();
    });

    // Очистить все теги
    el.querySelector('.tg-clear-tags').addEventListener('click', () => {
      s.tags = [];
      renderTextGenSentences();
    });

    // Удалить конкретный тег
    el.querySelectorAll('.tg-remove-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        s.tags.splice(parseInt(btn.dataset.ti), 1);
        renderTextGenSentences();
      });
    });

    // Варианты
    el.querySelectorAll('.tg-variant').forEach((ta, vi) => {
      ta.addEventListener('input', e => { s.variants[vi] = e.target.value; });
    });
    el.querySelectorAll('.tg-del-variant').forEach(btn => {
      btn.addEventListener('click', () => {
        s.variants.splice(parseInt(btn.dataset.vi), 1);
        renderTextGenSentences();
      });
    });
    el.querySelector('.tg-add-variant')?.addEventListener('click', () => {
      s.variants.push('');
      renderTextGenSentences();
    });
  });
}

// ============================================================================
// Photo Replace Section
// ============================================================================

const prState = {
  page: 1,
  limit: 50,
  total: 0,
  rows: [],
  currentRow: null,       // выбранная карточка VSE4
  selectedCandidateId: null,
  algorithms: [],
};

function initPhotoReplace() {
  document.getElementById('pr-load-btn')?.addEventListener('click', () => loadPrList(1));
  document.getElementById('pr-back-btn')?.addEventListener('click', hidePrDetail);
  document.getElementById('pr-confirm-btn')?.addEventListener('click', confirmBind);
  document.getElementById('pr-cancel-candidate-btn')?.addEventListener('click', () => {
    prState.selectedCandidateId = null;
    document.getElementById('pr-candidate-photos-block').style.display = 'none';
  });

  let prSearchTimer;
  document.getElementById('pr-search')?.addEventListener('input', () => {
    clearTimeout(prSearchTimer);
    prSearchTimer = setTimeout(() => loadPrList(1), 400);
  });
  document.getElementById('pr-filter-linked')?.addEventListener('change', () => loadPrList(1));
}

async function loadPrList(page = 1) {
  prState.page = page;
  const search  = document.getElementById('pr-search')?.value || '';
  const linked  = document.getElementById('pr-filter-linked')?.value || '';
  const params  = new URLSearchParams({ search, page, limit: prState.limit });
  if (linked) params.set('linked', linked);

  showStatus('pr-status', 'Загрузка...', 'loading');
  try {
    const data = await apiRequest(`/catalog/vse4-list?${params}`);
    prState.rows  = data.rows;
    prState.total = data.total;
    renderPrList();
    showStatus('pr-status', `Показано ${data.rows.length} из ${data.total}`, 'success');
  } catch (e) {
    showStatus('pr-status', `Ошибка: ${e.message}`, 'error');
  }
}

function renderPrList() {
  const tbody = document.getElementById('pr-tbody');
  if (!prState.rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-2)">Ничего не найдено</td></tr>';
    return;
  }

  tbody.innerHTML = prState.rows.map(row => {
    const linked = row.catalog_disc_id
      ? `<span style="color:#4caf50;font-weight:600;">✓ Привязан</span>`
      : `<span style="color:var(--text-2);">— нет</span>`;
    return `<tr>
      <td><code>${escapeHtml(row.ID)}</code></td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(row.name||'')}">${escapeHtml(row.name||'')}</td>
      <td>${escapeHtml(row.maker||'')} ${escapeHtml(row.model||'')}</td>
      <td>${row.count_otv||''}</td>
      <td>${escapeHtml(row.color||'')}${row.color_code ? ` <code style="font-size:11px;">${row.color_code}</code>` : ''}</td>
      <td>${linked}</td>
      <td><button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="openPrDetail('${escapeHtml(row.ID)}')">Открыть</button></td>
    </tr>`;
  }).join('');

  // Пагинация
  const pages = Math.ceil(prState.total / prState.limit);
  renderPagination('pr-pagination', prState.total, prState.page, p => loadPrList(p));
}

async function openPrDetail(vseId) {
  const row = prState.rows.find(r => r.ID === vseId);
  if (!row) return;
  prState.currentRow = row;
  prState.selectedCandidateId = null;

  document.getElementById('pr-detail-title').textContent = `${row.ID} — ${row.name || ''}`;
  document.getElementById('pr-candidate-photos-block').style.display = 'none';

  // Характеристики
  const specs = document.getElementById('pr-disc-specs');
  specs.innerHTML = [
    ['ID', row.ID], ['Марка', row.maker], ['Модель', row.model],
    ['Отверстий', row.count_otv], ['Цвет', row.color],
    ['Код цвета', row.color_code || '—'], ['Каталог', row.catalog_disc_id || '—'],
  ].map(([k,v]) => `<div><span style="color:var(--text-2);font-size:11px;">${k}</span><br><b>${escapeHtml(String(v||'—'))}</b></div>`).join('');

  document.getElementById('pr-detail').style.display = 'block';
  document.getElementById('pr-table').closest('.card').style.display = 'none';
  document.getElementById('pr-pagination').style.display = 'none';

  // Загрузить алгоритмы
  if (!prState.algorithms.length) {
    try {
      prState.algorithms = await apiRequest('/catalog/algorithms');
    } catch {}
  }
  const sel = document.getElementById('pr-algo-select');
  sel.innerHTML = prState.algorithms.map(a =>
    `<option value="${a.id}">${a.name}</option>`
  ).join('');

  // Поиск кандидатов
  document.getElementById('pr-candidates').innerHTML = '<p style="color:var(--text-2);font-size:13px;">Поиск в каталоге...</p>';
  document.getElementById('pr-candidates-count').textContent = '';

  const params = new URLSearchParams();
  if (row.maker)      params.set('maker', row.maker);
  if (row.model)      params.set('model', row.model);
  if (row.count_otv)  params.set('holes', row.count_otv);
  if (row.color_code) params.set('color_code', row.color_code);

  try {
    const candidates = await apiRequest(`/catalog/search?${params}`);
    renderPrCandidates(candidates);
  } catch (e) {
    document.getElementById('pr-candidates').innerHTML = `<p style="color:#f44;font-size:13px;">Ошибка поиска: ${escapeHtml(e.message)}</p>`;
  }
}

function renderPrCandidates(candidates) {
  const el = document.getElementById('pr-candidates');
  const cnt = document.getElementById('pr-candidates-count');
  cnt.textContent = `Найдено: ${candidates.length}`;

  if (!candidates.length) {
    el.innerHTML = '<p style="color:var(--text-2);font-size:13px;">Совпадений не найдено. Попробуйте выполнить поиск вручную или уточнить данные.</p>';
    return;
  }

  el.innerHTML = candidates.map(c => `
    <div class="pr-candidate-card" data-id="${c.id}" onclick="selectPrCandidate('${c.id}')"
      style="border:2px solid var(--border);border-radius:8px;padding:10px;cursor:pointer;width:160px;transition:border-color .15s;">
      <div style="width:140px;height:110px;background:var(--bg-1);border-radius:4px;margin-bottom:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;">
        ${c.previewUrl
          ? `<img src="${c.previewUrl}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">`
          : `<span style="font-size:11px;color:var(--text-2)">нет фото</span>`}
      </div>
      <div style="font-size:11px;color:var(--text-2);">${escapeHtml(c.article||'')}</div>
      <div style="font-size:12px;font-weight:600;">${escapeHtml(c.manufacturer||'')} ${escapeHtml(c.model||'')}</div>
      <div style="font-size:11px;color:var(--text-2);">${c.holes} отв. · <code>${escapeHtml(c.color||'')}</code></div>
    </div>
  `).join('');
}

async function selectPrCandidate(discId) {
  prState.selectedCandidateId = discId;

  // Подсветить выбранный
  document.querySelectorAll('.pr-candidate-card').forEach(el => {
    el.style.borderColor = el.dataset.id === discId ? 'var(--accent)' : 'var(--border)';
  });

  const block = document.getElementById('pr-candidate-photos-block');
  block.style.display = 'block';
  document.getElementById('pr-photos-grid').innerHTML = '<p style="color:var(--text-2);">Загрузка фото...</p>';
  document.getElementById('pr-bind-status').textContent = '';

  try {
    const disc = await apiRequest(`/catalog/disc/${discId}`);
    document.getElementById('pr-selected-candidate-name').textContent =
      `${disc.manufacturer} ${disc.model} · ${disc.color}`;
    renderPrPhotosGrid(disc.photos);
  } catch (e) {
    document.getElementById('pr-photos-grid').innerHTML =
      `<p style="color:#f44;">Ошибка: ${escapeHtml(e.message)}</p>`;
  }
}

const PHOTO_CATEGORY_LABELS = {
  AVITO_MAIN:       'Avito Главное',
  AVITO_EXTRA_MAIN: 'Avito Доп. главное',
  AVITO_EXTRA:      'Avito Дополнительные',
  SITE:             'Сайт',
  RENOVATION:       'Ремонт',
};

function renderPrPhotosGrid(photos) {
  const grid = document.getElementById('pr-photos-grid');
  if (!photos.length) {
    grid.innerHTML = '<p style="color:var(--text-2);">Нет фотографий в каталоге</p>';
    return;
  }

  const byCategory = {};
  photos.forEach(p => {
    (byCategory[p.category] = byCategory[p.category] || []).push(p);
  });

  grid.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
    <div>
      <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;">
        ${PHOTO_CATEGORY_LABELS[cat] || cat} (${items.length})
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${items.map(p => `
          <div style="position:relative;width:100px;height:80px;border-radius:4px;overflow:hidden;background:var(--bg-1);">
            <img src="${p.url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">
            ${p.subcategory ? `<span style="position:absolute;bottom:2px;left:2px;background:rgba(0,0,0,.6);color:#fff;font-size:9px;padding:1px 4px;border-radius:2px;">${p.subcategory}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

async function confirmBind() {
  const row = prState.currentRow;
  const discId = prState.selectedCandidateId;
  const algoId = document.getElementById('pr-algo-select')?.value;

  if (!row || !discId || !algoId) return;

  const btn = document.getElementById('pr-confirm-btn');
  const statusEl = document.getElementById('pr-bind-status');
  btn.disabled = true;
  btn.textContent = '⏳ Загрузка фото в R2...';
  statusEl.textContent = '';
  statusEl.style.color = '';

  try {
    const result = await apiRequest('/catalog/bind', {
      method: 'POST',
      body: JSON.stringify({ vseId: row.ID, catalogDiscId: discId, algoId }),
    });
    btn.textContent = '✅ Привязка подтверждена';
    statusEl.textContent = `Загружено ${result.photos} фото. ImageUrls обновлены.`;
    statusEl.style.color = '#4caf50';

    // Обновить строку в списке
    const listRow = prState.rows.find(r => r.ID === row.ID);
    if (listRow) listRow.catalog_disc_id = discId;
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '✅ Подтвердить привязку и загрузить фото';
    statusEl.textContent = `Ошибка: ${e.message}`;
    statusEl.style.color = '#f44336';
  }
}

function hidePrDetail() {
  document.getElementById('pr-detail').style.display = 'none';
  document.getElementById('pr-table').closest('.card').style.display = '';
  document.getElementById('pr-pagination').style.display = '';
  prState.currentRow = null;
  renderPrList();
}
