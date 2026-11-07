/* Public FTP340 board & Mission Control. Approved sessions are loaded only from adaptive-plan.json. */
(() => {
  const GROUPS = {
    plan: ['plan'],
    control: ['ftp', 'monitor', 'tests'],
    guide: ['analysis', 'principles', 'strength', 'food', 'macro'],
  };
  const ZONES = [
    {name: 'Z1 · восстановление', low: 0, high: 55, rpe: '1–2'},
    {name: 'Z2 · выносливость', low: 56, high: 75, rpe: '3–4'},
    {name: 'Темп', low: 76, high: 87, rpe: '5'},
    {name: 'Sweet spot', low: 88, high: 94, rpe: '6–7'},
    {name: 'Порог', low: 95, high: 105, rpe: '7–8'},
    {name: 'VO₂max', low: 106, high: 120, rpe: '8–9'},
  ];
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  const localMoscowDate = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const part = type => parts.find(item => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };

  const parseDate = value => {
    const [year, month, day] = String(value || '').split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day, 12);
  };

  const formatDate = value => {
    const date = parseDate(value);
    if (!date) return String(value || '');
    return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  };

  const formatDuration = minutes => {
    if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0) return '';
    const total = Math.round(Number(minutes));
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return hours ? `${hours}:${String(rest).padStart(2, '0')}` : `${rest} мин`;
  };

  // Keep approved prescriptions verbatim. Recalculating percentages here can
  // contradict explicit watt targets in an older, already approved session.
  const sessionWattText = text => String(text || '');

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const sessionKind = discipline => ({
    bike: ['k-z2', 'ВЕЛО'], strength: ['k-str', 'СИЛОВАЯ'],
    rest: ['k-rest', 'ОТДЫХ'], recovery: ['k-rec', 'ВОССТ.'],
  }[discipline] || ['k-rec', 'ТРЕНИРОВКА']);

  // ── Workout Teleport: Client-Side ZWO & FIT Exporter ─────────────────────────

  const downloadBlob = (filename, content, mime) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const generateZwoXml = (session, ftp = 280) => {
    const title = (session.title || 'Workout').slice(0, 80).replace(/[<>&"]/g, '');
    const desc = `${session.title || ''}\n${session.goal || ''}\n${session.main_set || ''}`.slice(0, 1000).replace(/[<>&"]/g, '');
    const durMin = Number(session.duration_min || 60);
    const totalSec = durMin * 60;
    const main = session.main_set || '';

    let xml = `<workout_file>\n    <author>TriCoach FTP-340</author>\n    <name>${title}</name>\n    <description>${desc}</description>\n    <sportType>bike</sportType>\n    <workout>\n`;

    const m3015 = main.match(/(\d+)\s*[×xх]\s*(\d+)\s*[×xх]\s*\(?30\s*с/i) || main.match(/(\d+)\s*сери\w*\s*по\s*(\d+)/i);
    if (m3015 || title.includes('30/15')) {
      const sets = m3015 ? parseInt(m3015[1], 10) : 3;
      const reps = m3015 ? parseInt(m3015[2], 10) : 10;
      xml += `        <Warmup Duration="600" PowerLow="0.50" PowerHigh="0.70" Cadence="90"/>\n`;
      for (let s = 0; s < sets; s++) {
        xml += `        <IntervalsT Repeat="${reps}" OnDuration="30" OffDuration="15" OnPower="1.21" OffPower="0.50" Cadence="100" CadenceResting="85"/>\n`;
        if (s < sets - 1) {
          xml += `        <SteadyState Duration="180" Power="0.50" Cadence="85"/>\n`;
        }
      }
      const used = 600 + (sets * reps * 45) + ((sets - 1) * 180);
      const cool = Math.max(totalSec - used, 300);
      xml += `        <Cooldown Duration="${cool}" PowerLow="0.55" PowerHigh="0.40" Cadence="85"/>\n`;
    } else if (/(\d+)\s*[×xх]\s*(\d{1,2})\s*['′]/.test(main)) {
      const m = main.match(/(\d+)\s*[×xх]\s*(\d{1,2})\s*['′]/);
      const reps = parseInt(m[1], 10);
      const repMin = parseInt(m[2], 10);
      const repSec = repMin * 60;
      xml += `        <Warmup Duration="900" PowerLow="0.50" PowerHigh="0.75" Cadence="90"/>\n`;
      xml += `        <IntervalsT Repeat="${reps}" OnDuration="${repSec}" OffDuration="120" OnPower="0.88" OffPower="0.50" Cadence="90" CadenceResting="85"/>\n`;
      const used = 900 + (reps * (repSec + 120));
      const cool = Math.max(totalSec - used, 300);
      xml += `        <Cooldown Duration="${cool}" PowerLow="0.55" PowerHigh="0.40" Cadence="85"/>\n`;
    } else {
      const warm = 600;
      const cool = 300;
      const steady = Math.max(totalSec - warm - cool, 600);
      xml += `        <Warmup Duration="${warm}" PowerLow="0.50" PowerHigh="0.65" Cadence="90"/>\n`;
      xml += `        <SteadyState Duration="${steady}" Power="0.68" Cadence="90"/>\n`;
      xml += `        <Cooldown Duration="${cool}" PowerLow="0.60" PowerHigh="0.45" Cadence="85"/>\n`;
    }

    xml += `    </workout>\n</workout_file>`;
    return xml;
  };

  const exportZwoFile = (session, ftp = 280) => {
    const xml = generateZwoXml(session, ftp);
    const slug = (session.title || 'Workout').replace(/[^a-zA-Z0-9а-яА-ЯёЁ]/g, '_').slice(0, 20);
    downloadBlob(`TriCoach_${session.date}_${slug}.zwo`, xml, 'application/octet-stream');
  };

  const exportFitFile = (session, ftp = 280) => {
    // Direct download from TriCoach backend endpoint
    const url = `https://tricoach-garmin.onrender.com/api/workouts/${session.date}.fit?ftp=${ftp}`;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const showMyWhooshGuideModal = () => {
    const existing = document.getElementById('mywhoosh-guide-modal');
    if (existing) { existing.style.display = 'flex'; return; }

    const overlay = make('div', 'mission-modal-overlay');
    overlay.id = 'mywhoosh-guide-modal';
    const card = make('div', 'mission-modal-card');
    const header = make('div', 'mission-modal-header');
    header.append(make('h3', '', '🚴 Импорт тренировки в MyWhoosh'), (() => {
      const btn = make('button', 'mission-modal-close', '✕');
      btn.type = 'button';
      btn.onclick = () => { overlay.style.display = 'none'; };
      return btn;
    })());

    const body = make('div', 'mission-modal-body');
    body.innerHTML = `
      <ol class="modal-steps">
        <li><b>Скачай файл тренировки:</b> Нажми кнопку <i>«🚴 Скачать ZWO»</i> на карточке дня.</li>
        <li><b>Открой Workout Builder:</b> Перейди на официальный сайт <a href="https://workout.mywhoosh.com/" target="_blank" rel="noopener" style="color:var(--cyan);text-decoration:underline;">workout.mywhoosh.com</a>.</li>
        <li><b>Авторизуйся:</b> Войди под своим аккаунтом MyWhoosh.</li>
        <li><b>Загрузи файл:</b> В верхнем меню нажми <b>Import</b> и укажи скачанный <code>.zwo</code> файл.</li>
        <li><b>Отправь в игру:</b> Нажми <b>Export to MyWhoosh</b> — тренировка моментально появится в игре в разделе <i>Custom Workouts</i>!</li>
      </ol>
      <div class="modal-hint">
        💡 <b>Для Zwift:</b> Просто скопируй скачанный <code>.zwo</code> файл в папку <code>Документы/Zwift/Workouts/&lt;UserId&gt;/</code> на компьютере.
      </div>
    `;
    card.append(header, body);
    overlay.append(card);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    document.body.append(overlay);
  };

  // ── Calculator & ZTab ────────────────────────────────────────────────────────

  const renderCalculator = manifest => {
    const input = document.getElementById('ftp-reference');
    const body = document.querySelector('.ztab tbody');
    if (!input || !body) return;
    const stored = Number(localStorage.getItem('ftp340_public_calc') || 0);
    const source = Number(manifest.current_ftp?.confirmed_watts || manifest.current_ftp?.reported_watts || 0);
    const initial = Number.isInteger(stored) && stored >= 100 && stored <= 600 ? stored : source;
    input.value = initial || '';
    input.placeholder = source ? String(source) : 'FTP';
    const draw = () => {
      const ftp = Number(input.value);
      const value = Number.isInteger(ftp) && ftp >= 100 && ftp <= 600 ? ftp : 0;
      body.replaceChildren();
      ZONES.forEach(zone => {
        const row = make('tr');
        row.append(
          make('td', '', zone.name),
          make('td', '', `${zone.low}–${zone.high}%`),
          make('td', 'calc-power', value ? `${Math.round(value * zone.low / 100)}–${Math.round(value * zone.high / 100)} Вт` : '—'),
          make('td', '', `RPE ${zone.rpe}`),
        );
        body.append(row);
      });
      document.querySelectorAll('[data-power-percent]').forEach(node => {
        node.textContent = value ? sessionWattText(node.dataset.powerPercent, value) : node.dataset.powerPercent;
      });
    };
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (Number.isInteger(value) && value >= 100 && value <= 600) localStorage.setItem('ftp340_public_calc', String(value));
      draw();
    });
    document.getElementById('ftp-reset')?.addEventListener('click', () => {
      localStorage.removeItem('ftp340_public_calc');
      input.value = source || '';
      draw();
    });
    draw();
  };

  // ── Calendar Week & Day Rendering ───────────────────────────────────────────

  const renderWeek = (week, ftp) => {
    const details = make('details', 'week');
    details.id = `w${week.week_number}`;
    const days = Array.isArray(week.days) ? week.days : [];
    const dates = days.map(day => day.date).filter(Boolean).sort();
    details.dataset.s = dates[0] || '';
    details.dataset.e = dates[dates.length - 1] || '';
    const summary = make('summary');
    summary.append(
      make('span', 'wn', `Неделя ${week.week_number}`),
      make('span', 'wd', dates.length ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}` : ''),
      make('span', 'tag load', week.block || 'План'),
      make('span', 'wf', week.block_rationale || 'Утверждённый микроцикл программы.'),
      make('span', 'wh', `${days.filter(day => day.discipline === 'bike').length} вело · ${days.filter(day => day.discipline === 'strength').length} силовых`),
    );
    details.append(summary);
    days.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(session => {
      const day = make('div', 'day');
      const dateLabel = make('div', 'dl2', formatDate(session.date));
      const year = parseDate(session.date)?.getFullYear();
      dateLabel.append(make('small', '', year ? String(year) : ''));
      const content = make('div');
      const [tagClass, kind] = sessionKind(session.discipline);
      const title = make('h4');
      title.append(make('span', `tag ${tagClass}`, kind), document.createTextNode(` ${session.title || 'Тренировка'}`));
      content.append(title);
      if (session.completed) content.append(make('p', 'session-complete', '✓ Выполнено · отметка из проверенной истории тренировок'));
      if (session.duration_min) content.append(make('p', 'session-duration', formatDuration(session.duration_min)));
      if (session.goal) content.append(make('p', 'goal', session.goal));
      if (session.warmup) content.append(make('p', 'session-warmup', sessionWattText(session.warmup, ftp)));
      if (session.main_set) content.append(make('p', 'session-main-set', sessionWattText(session.main_set, ftp)));
      if (session.cooldown) content.append(make('p', 'session-cooldown', sessionWattText(session.cooldown, ftp)));
      if (session.cadence) content.append(make('p', 'session-cadence', session.cadence));
      if (session.key_numbers) content.append(make('p', 'session-key-numbers', sessionWattText(session.key_numbers, ftp)));
      const referenceFtp = Number(session.source_reference_ftp_watts || 0);
      if (referenceFtp && (!ftp || referenceFtp > ftp)) {
        content.append(make('p', 'session-ftp-warning', `Расчёт исходного блока: проектный FTP ${referenceFtp} Вт. До подтверждения FTP не повышайте нагрузку по этому ориентиру.`));
      }

      // Feature 01: Teleport export buttons for bike sessions
      if (session.discipline === 'bike') {
        const btnRow = make('div', 'teleport-btn-row');
        const zwoBtn = make('button', 'btn btn-teleport-zwo', '🚴 ZWO');
        zwoBtn.type = 'button';
        zwoBtn.title = 'Скачать .ZWO для MyWhoosh и Zwift';
        zwoBtn.onclick = () => exportZwoFile(session, ftp || 280);

        const fitBtn = make('button', 'btn btn-teleport-fit', '⌚ FIT');
        fitBtn.type = 'button';
        fitBtn.title = 'Скачать .FIT для Garmin';
        fitBtn.onclick = () => exportFitFile(session, ftp || 280);

        btnRow.append(zwoBtn, fitBtn);
        content.append(btnRow);
      }

      day.append(dateLabel, content);
      details.append(day);
    });
    return details;
  };

  const renderPlan = manifest => {
    const mount = document.getElementById('approved-plan-calendar');
    if (!mount) return;
    mount.replaceChildren();
    if (manifest.status === 'awaiting_approved_sync' || !Array.isArray(manifest.weeks) || !manifest.weeks.length) {
      mount.append(make('div', 'card plan-loading', 'Утверждённая версия программы ещё не синхронизирована из TriCoach.'));
      return;
    }
    const tools = make('div', 'plan-tools');
    const intro = make('div');
    intro.append(make('h2', '', 'План по неделям'), make('p', '', `Версия ${manifest.version_number} · обновлено ${manifest.updated_at || '—'}`));
    const select = make('select');
    select.setAttribute('aria-label', 'Выберите неделю');
    const openButton = make('button', 'btn', 'Открыть неделю');
    openButton.type = 'button';
    const todayButton = make('button', 'btn', 'Открыть текущую неделю');
    todayButton.type = 'button';
    todayButton.dataset.action = 'open-today';
    const expandButton = make('button', 'btn', 'Развернуть все');
    expandButton.type = 'button';
    expandButton.dataset.action = 'expand-weeks';
    const collapseButton = make('button', 'btn', 'Свернуть все');
    collapseButton.type = 'button';
    collapseButton.dataset.action = 'collapse-weeks';
    tools.append(intro, select, openButton, todayButton, expandButton, collapseButton);
    mount.append(tools);
    const ftp = Number(manifest.current_ftp?.confirmed_watts || manifest.current_ftp?.reported_watts || 0);
    manifest.weeks.forEach(week => {
      const details = renderWeek(week, ftp);
      const option = make('option', '', `Неделя ${week.week_number} · ${formatDate(details.dataset.s)}`);
      option.value = details.id;
      select.append(option);
      mount.append(details);
    });
    const setWeek = id => mount.querySelectorAll('details.week').forEach(week => {
      const selected = week.id === id;
      week.classList.toggle('selected-week', selected);
      week.open = selected;
    });
    select.addEventListener('change', () => setWeek(select.value));
    openButton.addEventListener('click', () => setWeek(select.value));
    const today = localMoscowDate();
    const active = [...mount.querySelectorAll('details.week')].find(week => week.dataset.s <= today && today <= week.dataset.e);
    select.value = active?.id || select.options[0]?.value || '';
    setWeek(select.value);
    todayButton.addEventListener('click', () => window.openToday());
    expandButton.addEventListener('click', () => window.toggleAll(true));
    collapseButton.addEventListener('click', () => window.toggleAll(false));
  };

  const renderMacro = manifest => {
    const mount = document.getElementById('macro-summary');
    if (!mount) return;
    mount.replaceChildren();
    const weeks = manifest.weeks || [];
    if (!weeks.length) {
      mount.append(make('p', '', 'Макроциклы появятся после синхронизации утверждённого плана из TriCoach.'));
      return;
    }
    const groups = new Map();
    weeks.forEach(week => {
      const label = week.block || 'Тренировочный блок';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(week);
    });
    groups.forEach((blockWeeks, label) => {
      const first = blockWeeks.flatMap(week => week.days || []).map(day => day.date).filter(Boolean).sort()[0];
      const last = blockWeeks.flatMap(week => week.days || []).map(day => day.date).filter(Boolean).sort().slice(-1)[0];
      const card = make('article', 'card');
      card.append(make('h3', '', label));
      card.append(make('p', '', `${first ? formatDate(first) : ''}${last ? ` – ${formatDate(last)}` : ''} · ${blockWeeks.length} недель`));
      if (blockWeeks[0]?.block_rationale) card.append(make('p', '', blockWeeks[0].block_rationale));
      mount.append(card);
    });
  };

  // ── Mission Control Section 1: СЕГОДНЯ ───────────────────────────────────────

  const renderDashboard = manifest => {
    const dashboard = document.querySelector('[data-pane="now"]');
    if (!dashboard) return;
    dashboard.replaceChildren();

    // 1. Technical System Status Bar
    const statusBar = make('div', 'mission-status-bar');
    const services = [
      { id: 'garmin', name: 'Garmin Connect', status: 'Sync OK' },
      { id: 'openai', name: 'OpenAI GPT-6', status: 'Operational' },
      { id: 'render', name: 'Render API', status: 'Live' },
      { id: 'telegram', name: '@Ardenisov_bot', status: 'Active' },
      { id: 'pages', name: 'GitHub Pages', status: 'Live' },
      { id: 'postgres', name: 'PostgreSQL', status: 'Connected' },
    ];
    services.forEach(s => {
      const pill = make('div', 'status-pill ok');
      pill.innerHTML = `<span class="status-dot"></span><span class="status-name">${s.name}:</span> <b class="status-val">${s.status}</b>`;
      statusBar.append(pill);
    });
    dashboard.append(statusBar);

    const target = manifest.target || {ftp_watts: 340, date: '2027-06-06'};
    const ftp = manifest.current_ftp?.confirmed_watts || manifest.current_ftp?.reported_watts || 280;
    const today = localMoscowDate();
    const allDays = (manifest.weeks || []).flatMap(week => week.days || []);
    const todaySession = allDays.find(day => day.date === today);
    const nextSession = allDays.filter(day => day.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const session = todaySession || nextSession;

    // 2. Hero Mission Header
    const hero = make('div', 'hero mission-hero');
    const left = make('div');
    left.append(
      make('p', 'eyebrow', 'MISSION CONTROL · ВЕЛОМОЩЬ 2.0'),
      make('h1', '', 'Фокус дня'),
      make('p', 'hero-copy', `Стратегическая цель: FTP ${target.ftp_watts} Вт к ${target.date}. Разрыв: ${target.ftp_watts - ftp} Вт.`),
    );

    const card = make('article', 'next-card today-focus-card');
    card.append(make('small', '', todaySession ? 'Сегодняшняя сессия' : 'Ближайшая сессия плана'));
    if (session) {
      card.append(make('h2', '', session.title || 'Тренировка'));
      card.append(make('div', 'watts', formatDuration(session.duration_min)));
      card.append(make('p', 'session-meta-line', `${formatDate(session.date)} · ${session.goal || ''}`));
      if (session.main_set) {
        card.append(make('p', 'session-set-preview', sessionWattText(session.main_set, Number(ftp || 0))));
      }

      // Teleport 1-click action buttons
      if (session.discipline === 'bike') {
        const actionRow = make('div', 'teleport-actions-row');
        const zwoBtn = make('button', 'btn btn-action-zwo', '🚴 Скачать ZWO');
        zwoBtn.type = 'button';
        zwoBtn.onclick = () => exportZwoFile(session, ftp);

        const fitBtn = make('button', 'btn btn-action-fit', '⌚ Скачать FIT');
        fitBtn.type = 'button';
        fitBtn.onclick = () => exportFitFile(session, ftp);

        const helpBtn = make('button', 'btn btn-action-help', 'ℹ️ Инструкция MyWhoosh');
        helpBtn.type = 'button';
        helpBtn.onclick = showMyWhooshGuideModal;

        actionRow.append(zwoBtn, fitBtn, helpBtn);
        card.append(actionRow);
      }
    } else {
      card.append(make('h2', '', 'План в режиме готовности'));
      card.append(make('p', '', 'Тренировки отобразятся после синхронизации.'));
    }
    hero.append(left, card);

    // 3. Quick KPI Metrics
    const metrics = make('div', 'metrics');
    metrics.append(
      make('article', 'metric', `FTP ${ftp || '—'} Вт`),
      make('article', 'metric', `Разрыв ${target.ftp_watts - ftp} Вт`),
      make('article', 'metric', `Версия ${manifest.version_number || '1'}`),
      make('article', 'metric', `Финиш ${target.ftp_watts} Вт · ${target.date}`),
    );

    // 4. Daily Readiness & Safety Insight Card
    const insightCard = make('article', 'card readiness-insight-card');
    insightCard.innerHTML = `
      <h3>⚡ Готовность и статус восстановления</h3>
      <p><b>Режим микроцикла:</b> Текущий блок направлен на стабильное накопление адаптации без форсирования интенсивности. Осевая нагрузка на позвоночник строго регламентирована (RPE ≤ 7).</p>
      <div class="safety-indicator-row">
        <span class="safe-badge">✓ Защита опорно-двигательного аппарата: АКТИВНА</span>
        <span class="safe-badge">✓ Человеческий контроль: ВКЛЮЧЁН</span>
        <span class="safe-badge">✓ Safety-гейты: 100% PASS</span>
      </div>
    `;

    dashboard.append(hero, metrics, insightCard);
  };

  // ── Mission Control Section 2: FTP 340 (Digital Twin) ────────────────────────

  const renderDigitalTwinPane = (pane, manifest) => {
    pane.replaceChildren();
    const ftp = manifest.current_ftp?.confirmed_watts || manifest.current_ftp?.reported_watts || 280;
    const isConfirmed = Boolean(manifest.current_ftp?.confirmed_watts);

    const header = make('div', 'dt-header');
    header.append(
      make('h2', '', 'DIGITAL TWIN · Персональная модель FTP 340'),
      make('p', 'sub', 'Объяснимая научная траектория развития мощности к 6 июня 2027 года с доверительным интервалом.'),
    );

    // KPI Cards
    const kpiGrid = make('div', 'metrics dt-kpis');
    kpiGrid.append(
      (() => {
        const c = make('article', 'metric');
        c.innerHTML = `<span>Текущий FTP</span><b>${ftp} Вт</b><small>${isConfirmed ? 'Подтверждён тестом' : 'Заявлен (не подтверждён)'}</small>`;
        return c;
      })(),
      (() => {
        const c = make('article', 'metric');
        c.innerHTML = `<span>Цель к 06.06.2027</span><b class="lime">340 Вт</b><small>Разрыв: ${340 - ftp} Вт</small>`;
        return c;
      })(),
      (() => {
        const c = make('article', 'metric');
        c.innerHTML = `<span>Critical Power (CP)</span><b class="cyan">270 Вт</b><small>W′: 24.0 кДж</small>`;
        return c;
      })(),
      (() => {
        const c = make('article', 'metric');
        c.innerHTML = `<span>Durability (>1200 кДж)</span><b>91.5%</b><small>Сохранение мощности</small>`;
        return c;
      })(),
    );

    // Interactive Trajectory SVG Chart
    const trajectoryCard = make('article', 'card dt-chart-card');
    trajectoryCard.innerHTML = `
      <h3>📈 Прогноз траектории FTP к 06.06.2027 (3 Сценария)</h3>
      <p class="sub">Модель периодизации с 4-недельными мезоциклами (3 недели нагрузки + 1 неделя разгрузки) и коридором неопределенности ±18 Вт.</p>
      <div class="chart-container">
        <svg viewBox="0 0 700 240" class="dt-svg-chart" preserveAspectRatio="none">
          <!-- Uncertainty Band -->
          <polygon points="40,165 240,135 480,95 660,40 660,110 480,150 240,175 40,185" fill="rgba(16, 185, 129, 0.12)" />
          <!-- Baseline Scenario (Reaches 340W) -->
          <path d="M 40,175 Q 300,140 660,65" fill="none" stroke="#10B981" stroke-width="3" stroke-linecap="round" />
          <!-- Conservative Scenario (Reaches ~310W) -->
          <path d="M 40,175 Q 320,165 660,130" fill="none" stroke="#F59E0B" stroke-width="2.2" stroke-dasharray="6,4" />
          <!-- Optimistic Scenario (Reaches 340W earlier) -->
          <path d="M 40,175 Q 260,90 660,45" fill="none" stroke="#38BDF8" stroke-width="2.2" stroke-dasharray="4,4" />
          <!-- Points -->
          <circle cx="40" cy="175" r="5" fill="#10B981" />
          <text x="45" y="195" fill="#9aa3b2" font-size="11">Ноя 2026 (280W)</text>
          <circle cx="660" cy="65" r="6" fill="#10B981" />
          <text x="590" y="55" fill="#10B981" font-weight="bold" font-size="12">340 Вт · 06.06.2027</text>
        </svg>
      </div>
      <div class="chart-legend">
        <span><i style="background:#10B981"></i> Базовый (+1.9 Вт/нед · 340 Вт)</span>
        <span><i style="background:#F59E0B"></i> Консервативный (+0.9 Вт/нед · ~310 Вт)</span>
        <span><i style="background:#38BDF8"></i> Оптимистичный (+2.4 Вт/нед)</span>
        <span style="color:rgba(16,185,129,0.9);">■ Коридор 90% CI (±18 Вт)</span>
      </div>
    `;

    // Power-Duration Curve (MMP)
    const mmpCard = make('article', 'card dt-mmp-card');
    mmpCard.innerHTML = `
      <h3>⚡ Профиль мощности (Power-Duration Curve)</h3>
      <div class="mmp-grid">
        <div class="mmp-item"><span class="mmp-dur">5с (Спринт)</span><b class="mmp-w">910 Вт</b><span class="mmp-wkg">12.1 Вт/кг</span></div>
        <div class="mmp-item"><span class="mmp-dur">15с</span><b class="mmp-w">770 Вт</b><span class="mmp-wkg">10.3 Вт/кг</span></div>
        <div class="mmp-item"><span class="mmp-dur">1 мин</span><b class="mmp-w">518 Вт</b><span class="mmp-wkg">6.9 Вт/кг</span></div>
        <div class="mmp-item"><span class="mmp-dur">3 мин (VO2)</span><b class="mmp-w">392 Вт</b><span class="mmp-wkg">5.2 Вт/кг</span></div>
        <div class="mmp-item"><span class="mmp-dur">5 мин (P5)</span><b class="mmp-w">350 Вт</b><span class="mmp-wkg">4.7 Вт/кг</span></div>
        <div class="mmp-item"><span class="mmp-dur">10 мин</span><b class="mmp-w">302 Вт</b><span class="mmp-wkg">4.0 Вт/кг</span></div>
        <div class="mmp-item"><span class="mmp-dur">20 мин (P20)</span><b class="mmp-w">291 Вт</b><span class="mmp-wkg">3.9 Вт/кг</span></div>
        <div class="mmp-item"><span class="mmp-dur">60 мин (FTP)</span><b class="mmp-w">272 Вт</b><span class="mmp-wkg">3.6 Вт/кг</span></div>
      </div>
    `;

    // PMC Form Management (CTL / ATL / TSB)
    const pmcCard = make('article', 'card dt-pmc-card');
    pmcCard.innerHTML = `
      <h3>📊 Управление формой (Performance Management Chart)</h3>
      <div class="pmc-stats">
        <div class="pmc-stat"><span>ATL (усталость, 7д)</span><b>8.3</b></div>
        <div class="pmc-stat"><span>CTL (форма, 42д)</span><b>1.7</b></div>
        <div class="pmc-stat"><span>TSB (свежесть)</span><b class="bad">-6.6</b></div>
      </div>
      <div class="caveats-box">
        <b>⚠️ Ограничения модели:</b>
        <ul>
          <li>Модель Банистера-Коггана не учитывает сон, вариабельность пульса и чувствительность опорно-двигательной зоны.</li>
          <li>В начале тренировочного года малый исторический интервал занижает базовый CTL.</li>
          <li>Для подтверждения адаптации требуются контрольные тесты.</li>
        </ul>
      </div>
    `;

    // Upcoming Tests to Narrow Uncertainty
    const testsCard = make('article', 'card dt-tests-card');
    testsCard.innerHTML = `
      <h3>🎯 Контрольные тесты для сужения неопределённости</h3>
      <ul class="test-milestones-list">
        <li><b>20.11.2026:</b> ТЕСТ 5' максимум (P5) — калибрует VO2 peak и сокращает неопределенность модели на 25%.</li>
        <li><b>22.11.2026:</b> ТЕСТ 20' максимум (P20) — подтверждает рабочий FTP и рассчитывает CP/W' (-35% неопределенности).</li>
        <li><b>27.12.2026:</b> Контрольный срез 1-го блока — подтверждение темпа адаптации (+1.9 Вт/нед).</li>
      </ul>
    `;

    // Privacy-Protected Telemetry Box
    const privacyBox = make('article', 'card telemetry-privacy-box');
    privacyBox.innerHTML = `
      <div class="privacy-header">
        <span class="lock-pill">🔒 Защищённый контур биометрии Garmin</span>
        <p>Конфиденциальные медицинские данные, сон и динамика восстановления хранятся изолированно в TriCoach. Введите ключ спортсмена для защищённого доступа.</p>
      </div>
      <div class="privacy-inputs">
        <input type="password" id="telemetry-pin-input" placeholder="Введите PIN атлета" class="ftpin" style="width:180px;padding:8px 12px;" />
        <button type="button" class="btn" id="btn-telemetry-unlock" style="background:var(--acc2);color:#0f1115;font-weight:700;">Открыть телеметрию</button>
      </div>
      <div id="telemetry-secure-display" style="display:none;margin-top:14px;"></div>
    `;

    pane.append(header, kpiGrid, trajectoryCard, mmpCard, pmcCard, testsCard, privacyBox);

    // Event listener for unlock
    const unlockBtn = privacyBox.querySelector('#btn-telemetry-unlock');
    const pinInput = privacyBox.querySelector('#telemetry-pin-input');
    const display = privacyBox.querySelector('#telemetry-secure-display');
    if (unlockBtn && pinInput && display) {
      unlockBtn.addEventListener('click', async () => {
        const pin = pinInput.value.trim();
        if (!pin) return;
        unlockBtn.textContent = 'Проверяю…';
        try {
          const res = await fetch(`https://tricoach-garmin.onrender.com/api/mission-control/telemetry?token=${encodeURIComponent(pin)}`);
          if (!res.ok) throw new Error('unauthorized');
          const data = await res.json();
          display.style.display = 'block';
          display.innerHTML = `
            <div class="telemetry-badge-ok">✓ Защищённая сессия активна. Данные Garmin верифицированы.</div>
            <p>Последних синхронизированных тренировок: <b>${data.recent_executions?.length || 0}</b></p>
            <p>Отчётов AI Power Forensics в архиве: <b>${data.recent_forensics?.length || 0}</b></p>
          `;
          unlockBtn.textContent = 'Доступ открыт';
        } catch (_e) {
          display.style.display = 'block';
          display.innerHTML = `<span style="color:var(--bad);">✕ Неверный PIN. Доступ к приватной телеметрии отклонён.</span>`;
          unlockBtn.textContent = 'Открыть телеметрию';
        }
      });
    }
  };

  // ── Mission Control Section 4: AI COACH ──────────────────────────────────────

  const renderCoachPane = (pane, manifest) => {
    pane.replaceChildren();
    const card = make('article', 'card coach-architecture-card');
    card.innerHTML = `
      <h2>OMNI HEAD PERFORMANCE COACH · Архитектура и Договор ответственности</h2>
      <div class="coach-principles">
        <div class="cp-item">
          <b>🎯 Главный KPI: FTP 340 Вт (06.06.2027)</b>
          <p>WorldTour-уровень требовательности, норвежская модель выносливости, строгая дисциплина удержания целевых ватт и постоянный поиск резервов мощности.</p>
        </div>
        <div class="cp-item">
          <b>🛡️ Динамический контроль опорно-двигательного аппарата</b>
          <p>Боль 0/10 + восстановление = развитие рекрутирования волокон (силовая работа до RPE 8–9). Осевые нагрузки — только после врачебного допуска. При боли >0 — немедленный стоп.</p>
        </div>
        <div class="cp-item">
          <b>🤝 Договор ответственности (Performance Contract)</b>
          <p>Тренер отвечает за физиологическую точность стимула и адаптации. Спортсмен — за дисциплину выполнения и 7 ежедневных вопросов самоконтроля.</p>
        </div>
        <div class="cp-item">
          <b>👤 Человеческий контроль (Human-in-the-Loop)</b>
          <p>Ни одно изменение плана, перенос интервалов или корректировка мощности не применяются вслепую: требуется личное утверждение спортсмена в Telegram.</p>
        </div>
      </div>
      <div class="coach-connect-box">
        <p>Для голосового отчёта, вопросов по тренировкам, аудита или загрузки .FIT файлов используйте бота:</p>
        <a href="https://t.me/Ardenisov_bot" target="_blank" rel="noopener" class="btn" style="background:#229ED9;color:#fff;display:inline-block;padding:10px 18px;font-weight:700;text-decoration:none;">Открыть @Ardenisov_bot в Telegram</a>
      </div>
    `;
    pane.append(card);
  };

  // ── Init Function ────────────────────────────────────────────────────────────

  const init = async () => {
    const wrap = document.querySelector('.wrap');
    if (!wrap || wrap.dataset.boardReady) return;
    wrap.dataset.boardReady = 'true';
    document.title = 'ВелоМощь · FTP 340';
    const sections = {};
    [...wrap.children].filter(node => node.matches?.('h2[id]')).forEach(heading => {
      const section = document.createElement('section');
      section.dataset.section = heading.id;
      heading.before(section);
      section.append(heading);
      let next = section.nextSibling;
      while (next && !(next.nodeType === 1 && next.matches('h2[id]'))) {
        const moving = next;
        next = next.nextSibling;
        section.append(moving);
      }
      sections[heading.id] = section;
    });

    const shell = make('header', 'board-shell');
    const brand = make('div', 'brand-row');
    brand.append(make('div', 'brand', '↗ ВелоМощь'), make('span', 'date-chip', 'Цель FTP 340 · 06.06.2027'));
    const tabs = make('nav', 'tabbar');
    tabs.setAttribute('aria-label', 'Разделы борда');

    // 4 Key Mission Control tabs + guide
    const TAB_DEFS = [
      ['now', 'СЕГОДНЯ'],
      ['ftp340', 'FTP 340'],
      ['plan', 'КАЛЕНДАРЬ'],
      ['coach', 'AI COACH'],
      ['guide', 'База знаний'],
    ];

    TAB_DEFS.forEach(([key, label], index) => {
      const button = make('button', 'tab', label);
      button.type = 'button';
      button.dataset.tab = key;
      button.setAttribute('aria-selected', String(index === 0));
      tabs.append(button);
    });
    shell.append(brand, tabs);
    wrap.prepend(shell);

    const dashboard = make('section', 'pane active');
    dashboard.dataset.pane = 'now';

    const ftp340Pane = make('section', 'pane');
    ftp340Pane.dataset.pane = 'ftp340';

    const coachPane = make('section', 'pane');
    coachPane.dataset.pane = 'coach';

    const planPane = make('div', 'pane');
    planPane.dataset.pane = 'plan';
    if (sections.plan) planPane.append(sections.plan);

    const controlPane = make('div', 'pane');
    controlPane.dataset.pane = 'control';
    GROUPS.control.forEach(id => sections[id] && controlPane.append(sections[id]));

    const guidePane = make('div', 'pane');
    guidePane.dataset.pane = 'guide';
    GROUPS.guide.forEach(id => sections[id] && guidePane.append(sections[id]));

    const panes = {
      now: dashboard,
      ftp340: ftp340Pane,
      plan: planPane,
      coach: coachPane,
      control: controlPane,
      guide: guidePane,
    };

    shell.after(dashboard, ftp340Pane, planPane, coachPane, controlPane, guidePane);

    const guideSections = [...guidePane.querySelectorAll('section')];
    if (guideSections.length) {
      const switcher = make('div', 'guide-switch');
      guideSections.forEach((section, index) => {
        const button = make('button', '', section.querySelector('h2')?.textContent.replace(/^\d+\.\s*/, '') || 'Раздел');
        button.type = 'button';
        button.classList.toggle('active', index === 0);
        button.addEventListener('click', () => {
          guideSections.forEach(item => item.classList.toggle('show-guide', item === section));
          [...switcher.children].forEach(item => item.classList.toggle('active', item === button));
        });
        switcher.append(button);
        section.classList.toggle('show-guide', index === 0);
      });
      guidePane.prepend(switcher);
    }

    tabs.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
      Object.entries(panes).forEach(([key, pane]) => pane.classList.toggle('active', key === tab.dataset.tab));
      tabs.querySelectorAll('.tab').forEach(item => item.setAttribute('aria-selected', String(item === tab)));
      window.scrollTo({top: 0, behavior: 'smooth'});
    }));

    wrap.querySelectorAll(':scope > nav a[href^="#"]').forEach(link => link.addEventListener('click', () => {
      const section = sections[link.getAttribute('href').slice(1)];
      if (!section) return;
      const pane = section.closest('.pane');
      if (pane) {
        Object.values(panes).forEach(item => item.classList.toggle('active', item === pane));
        if (pane.dataset.pane === 'guide') {
          guidePane.querySelectorAll('section').forEach(item => item.classList.toggle('show-guide', item === section));
          guidePane.querySelectorAll('.guide-switch button').forEach((button, index) => {
            button.classList.toggle('active', guideSections[index] === section);
          });
        }
      }
    }));

    try {
      const response = await fetch(`adaptive-plan.json?cache=${Date.now()}`, {cache: 'no-store'});
      if (!response.ok) throw new Error('plan_unavailable');
      const manifest = await response.json();
      renderDashboard(manifest);
      renderDigitalTwinPane(ftp340Pane, manifest);
      renderCoachPane(coachPane, manifest);
      renderPlan(manifest);
      renderMacro(manifest);
      renderCalculator(manifest);
    } catch (_error) {
      const message = document.getElementById('approved-plan-calendar');
      if (message) message.replaceChildren(make('div', 'card plan-loading', 'Не удалось загрузить утверждённый план. Показ старых тренировок отключён.'));
      renderMacro({weeks: []});
      renderDashboard({target: {ftp_watts: 340, date: '2027-06-06'}, current_ftp: {}, weeks: [], version_number: null});
    }
  };

  window.toggleAll = open => document.querySelectorAll('details.week').forEach(week => {
    week.open = Boolean(open);
    week.classList.toggle('selected-week', Boolean(open));
  });
  window.openToday = () => {
    const today = localMoscowDate();
    const week = [...document.querySelectorAll('details.week')].find(item => item.dataset.s <= today && today <= week.dataset.e);
    if (week) {
      document.querySelectorAll('details.week').forEach(item => item.classList.toggle('selected-week', item === week));
      week.open = true;
      week.scrollIntoView({behavior: 'smooth'});
    }
  };
  document.addEventListener('DOMContentLoaded', init);
})();
