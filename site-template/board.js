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
    {name: 'Темп (Z3)', low: 76, high: 87, rpe: '5'},
    {name: 'Sweet spot', low: 88, high: 94, rpe: '6–7'},
    {name: 'Порог (Z4)', low: 95, high: 105, rpe: '7–8'},
    {name: 'VO₂max (Z5)', low: 106, high: 120, rpe: '8–9'},
    {name: 'Анаэробная (Z6)', low: 121, high: 150, rpe: '9–10'},
    {name: 'Нейромышечная (Z7)', low: 151, high: 200, rpe: '10'},
  ];
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  const getWorkingFtp = manifest => {
    const current = manifest?.current_ftp;
    const watts = Number(current?.confirmed_watts ?? current?.reported_watts);
    return Number.isInteger(watts) && watts >= 100 && watts <= 600 ? watts : 280;
  };

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

  // Recalculate watt prescriptions dynamically if targetFtp is provided.
  const sessionWattText = (text, targetFtp) => {
    const src = String(text || '');
    if (!targetFtp || typeof targetFtp !== 'number' || targetFtp <= 0) return src;

    // Pattern 1: Range percentage: "168–190 Вт (60–68% от 280 Вт)" or "168–190 Вт (60–68%)"
    let res = src.replace(/(\d+)[–-](\d+)\s*Вт\s*\(([0-9.]+)[–-]([0-9.]+)%(?:\s*от\s*\d+\s*Вт)?\)/g, (_, _w1, _w2, p1, p2) => {
      const nw1 = Math.round(targetFtp * Number(p1) / 100);
      const nw2 = Math.round(targetFtp * Number(p2) / 100);
      return `${nw1}–${nw2} Вт (${p1}–${p2}% от ${targetFtp} Вт)`;
    });

    // Pattern 2: Single percentage in brackets: "350 Вт [125% от 280 Вт]" or "140 Вт [50% от 280 Вт]"
    res = res.replace(/(\d+)\s*Вт\s*\[([0-9.]+)%(?:\s*от\s*\d+\s*Вт)?\]/g, (_, _w, p) => {
      const nw = Math.round(targetFtp * Number(p) / 100);
      return `${nw} Вт [${p}% от ${targetFtp} Вт]`;
    });

    // Pattern 3: Single percentage in parentheses: "364 Вт (130% от 280 Вт)"
    res = res.replace(/(\d+)\s*Вт\s*\(([0-9.]+)%(?:\s*от\s*\d+\s*Вт)?\)/g, (_, _w, p) => {
      const nw = Math.round(targetFtp * Number(p) / 100);
      return `${nw} Вт (${p}% от ${targetFtp} Вт)`;
    });

    // Pattern 4: Standalone "от \d+ Вт"
    res = res.replace(/от\s+\d+\s+Вт/g, `от ${targetFtp} Вт`);

    return res;
  };

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

  // ── Workout Teleport: Canonical Server-Side ZWO & FIT Exporter ───────────────

  let calendarVersion;
  const exportWorkout = async (session, ftp, format) => {
    const endpoint = new URL(`https://tricoach-garmin.onrender.com/api/workouts/${session.date}.${format}`);
    endpoint.searchParams.set('ftp', ftp);
    if (calendarVersion) endpoint.searchParams.set('version', calendarVersion);
    try {
      const response = await fetch(endpoint);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(typeof error.detail === 'string' ? error.detail : 'Сервис экспорта временно недоступен.');
      }
      const file = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = file;
      link.download = `TriCoach_${session.date}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(file), 30000);
    } catch (err) {
      alert(`Не удалось скачать ${format.toUpperCase()}. ${err.message}`);
    }
  };

  const exportZwoFile = (session, ftp = 280) => exportWorkout(session, ftp, 'zwo');
  const exportFitFile = (session, ftp = 280) => exportWorkout(session, ftp, 'fit');

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
        <li><b>Скачай ZWO:</b> Нажми <i>«ZWO · MyWhoosh»</i> у нужной велотренировки. На телефоне файл будет в «Загрузках» (iPhone: приложение «Файлы» → Downloads; Android: «Файлы» → Downloads).</li>
        <li><b>Открой Workout Builder:</b> В том же браузере перейди на официальный сайт <a href="https://workout.mywhoosh.com/" target="_blank" rel="noopener" style="color:var(--cyan);text-decoration:underline;">workout.mywhoosh.com</a>.</li>
        <li><b>Авторизуйся:</b> Войди под своим аккаунтом MyWhoosh.</li>
        <li><b>Импортируй файл:</b> Нажми <b>Import</b> и выбери этот <code>.zwo</code> в папке Downloads. Повтори для каждого файла.</li>
        <li><b>Отправь в аккаунт:</b> Нажми <b>Export to MyWhoosh</b>. Тренировка появится в приложении в разделе <i>My Workouts</i>.</li>
      </ol>
      <div class="modal-hint">
        📱 <b>Важно:</b> скачивание файла ещё не добавляет его в MyWhoosh — нужен шаг Import и Export to MyWhoosh на сайте. <br>💡 <b>Для Zwift:</b> скопируй скачанный <code>.zwo</code> в папку <code>Документы/Zwift/Workouts/&lt;UserId&gt;/</code> на компьютере.
      </div>
    `;
    card.append(header, body);
    overlay.append(card);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    document.body.append(overlay);
  };

  // ── Calculator & ZTab ────────────────────────────────────────────────────────

  let activeManifest = null;

  const renderCalculator = manifest => {
    activeManifest = manifest;
    const input = document.getElementById('ftp-reference');
    const body = document.querySelector('.ztab tbody');
    if (!input || !body) return;
    const stored = Number(localStorage.getItem('ftp340_public_calc') || 0);
    const source = getWorkingFtp(manifest);
    const initial = Number.isInteger(stored) && stored >= 100 && stored <= 600 ? stored : source;
    input.value = initial || '';
    input.placeholder = source ? String(source) : 'FTP';
    const draw = overrideFtp => {
      const ftp = overrideFtp !== undefined ? overrideFtp : Number(input.value);
      const value = Number.isInteger(ftp) && ftp >= 100 && ftp <= 600 ? ftp : source;
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
      // Dynamically re-render calendar workouts with active FTP
      if (activeManifest && activeManifest.weeks) {
        renderPlan(activeManifest, value);
      }
    };
    input.addEventListener('input', () => {
      const value = Number(input.value);
      if (Number.isInteger(value) && value >= 100 && value <= 600) {
        localStorage.setItem('ftp340_public_calc', String(value));
        draw(value);
      } else if (!input.value) {
        localStorage.removeItem('ftp340_public_calc');
        draw(source);
      }
    });
    document.getElementById('ftp-reset')?.addEventListener('click', () => {
      localStorage.removeItem('ftp340_public_calc');
      input.value = source || '';
      draw(source);
    });
    draw(initial);
  };

  // ── Pure Vanilla SVG Workout Interval Visualizer ────────────────────────────

  const renderWorkoutVisualizer = (session, ftp) => {
    if (session.discipline !== 'bike') return null;
    const dur = Number(session.duration_min) || 60;
    const workingFtp = ftp || 280;

    const intervals = [];
    const warmupDur = session.warmup ? (parseInt(session.warmup, 10) || 15) : 12;
    intervals.push({ label: 'Разминка Z1/Z2', duration: warmupDur, pct: 62, zone: 'z2' });

    const mainText = (session.main_set || '').toLowerCase();
    const remainDur = Math.max(dur - warmupDur - 8, 20);

    if (mainText.includes('30/15') || mainText.includes('vo₂') || mainText.includes('vo2')) {
      const sets = mainText.includes('3×') ? 3 : 2;
      const setDur = Math.floor(remainDur / sets);
      for (let s = 0; s < sets; s++) {
        intervals.push({ label: 'Серия 30/15 @ 125%', duration: Math.floor(setDur * 0.7), pct: 125, zone: 'z6' });
        if (s < sets - 1) {
          intervals.push({ label: 'Отдых Z1', duration: Math.floor(setDur * 0.3), pct: 50, zone: 'z1' });
        }
      }
    } else if (mainText.includes('порог') || mainText.includes('threshold') || mainText.includes('sweet spot') || mainText.includes('t20') || mainText.includes('t5')) {
      const reps = mainText.includes('4×') ? 4 : (mainText.includes('3×') ? 3 : 2);
      const repDur = Math.floor(remainDur / (reps * 1.35));
      const restDur = Math.floor(repDur * 0.35);
      for (let r = 0; r < reps; r++) {
        intervals.push({ label: 'Порог Z4 @ 95–100%', duration: repDur, pct: 98, zone: 'z4' });
        if (r < reps - 1) intervals.push({ label: 'Отдых Z1', duration: restDur, pct: 50, zone: 'z1' });
      }
    } else if (mainText.includes('темп') || mainText.includes('tempo')) {
      intervals.push({ label: 'Темп Z3 @ 80–88%', duration: remainDur, pct: 85, zone: 'z3' });
    } else {
      intervals.push({ label: 'База Z2 @ 65–72%', duration: remainDur, pct: 68, zone: 'z2' });
    }

    const cooldownDur = Math.max(dur - intervals.reduce((acc, i) => acc + i.duration, 0), 5);
    intervals.push({ label: 'Заминка Z1', duration: cooldownDur, pct: 50, zone: 'z1' });

    const svgWidth = 360;
    const svgHeight = 38;
    const totalMin = intervals.reduce((acc, i) => acc + i.duration, 0);
    const zoneColors = {
      z1: '#64748B',
      z2: '#10B981',
      z3: '#06B6D4',
      z4: '#F59E0B',
      z5: '#EF4444',
      z6: '#A855F7',
    };

    const container = make('div', 'workout-viz-container');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
    svg.setAttribute('class', 'workout-viz-svg');
    svg.setAttribute('role', 'img');

    const lineY = Math.round(svgHeight - (100 / 140) * (svgHeight - 6));
    const ftpLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ftpLine.setAttribute('x1', '0');
    ftpLine.setAttribute('x2', String(svgWidth));
    ftpLine.setAttribute('y1', String(lineY));
    ftpLine.setAttribute('y2', String(lineY));
    ftpLine.setAttribute('stroke', 'rgba(245, 158, 11, 0.75)');
    ftpLine.setAttribute('stroke-dasharray', '4,3');
    ftpLine.setAttribute('stroke-width', '1.2');
    const ftpTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    ftpTitle.textContent = `100% FTP (${workingFtp} Вт)`;
    ftpLine.append(ftpTitle);

    let currentX = 0;
    intervals.forEach(inv => {
      const blockWidth = Math.max((inv.duration / totalMin) * svgWidth, 2);
      const blockHeight = Math.min(Math.round((inv.pct / 140) * (svgHeight - 6)), svgHeight - 4);
      const rectY = svgHeight - blockHeight;

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', currentX.toFixed(1));
      rect.setAttribute('y', String(rectY));
      rect.setAttribute('width', Math.max(blockWidth - 1, 1).toFixed(1));
      rect.setAttribute('height', String(blockHeight));
      rect.setAttribute('rx', '2');
      rect.setAttribute('fill', zoneColors[inv.zone] || '#06B6D4');

      const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      const w = Math.round(workingFtp * (inv.pct / 100));
      titleEl.textContent = `${inv.label}: ~${w} Вт (${inv.pct}%) · ${inv.duration} мин`;
      rect.appendChild(titleEl);

      svg.appendChild(rect);
      currentX += blockWidth;
    });

    svg.appendChild(ftpLine);
    container.append(svg);
    return container;
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
      if (session.completed) {
        const factBox = make('div', 'session-fact-box');
        factBox.append(make('span', 'tag done', '✓ Выполнено по факту'));
        const metricsRow = make('div', 'fact-metrics-grid');
        const dur = session.actual_duration_min || session.duration_min;
        const durDelta = (session.actual_duration_min && session.duration_min && session.actual_duration_min !== session.duration_min)
          ? (session.actual_duration_min - session.duration_min) : null;
        const np = session.actual_np || session.normalized_power_watts;
        const avgP = session.actual_avg_power || session.average_power_watts;
        const ifVal = np && ftp ? (np / ftp).toFixed(2) : null;
        if (dur) {
          const deltaStr = durDelta !== null ? ` (${durDelta > 0 ? '+' : ''}${durDelta}м)` : '';
          metricsRow.append(make('span', 'fact-metric', `⏱️ ${dur} мин${deltaStr}`));
        }
        if (np) metricsRow.append(make('span', 'fact-metric', `⚡ NP ${np} Вт`));
        else if (avgP) metricsRow.append(make('span', 'fact-metric', `⚡ Ср ${avgP} Вт`));
        if (ifVal) metricsRow.append(make('span', 'fact-metric', `🎯 IF ${ifVal}`));
        factBox.append(metricsRow);
        content.append(factBox);
      }
      if (session.duration_min) content.append(make('p', 'session-duration', formatDuration(session.duration_min)));
      if (session.goal) content.append(make('p', 'goal', session.goal));
      if (session.warmup) content.append(make('p', 'session-warmup', sessionWattText(session.warmup, ftp)));
      if (session.main_set) content.append(make('p', 'session-main-set', sessionWattText(session.main_set, ftp)));
      if (session.cooldown) content.append(make('p', 'session-cooldown', sessionWattText(session.cooldown, ftp)));
      if (session.cadence) content.append(make('p', 'session-cadence', session.cadence));
      if (session.key_numbers) content.append(make('p', 'session-key-numbers', sessionWattText(session.key_numbers, ftp)));
      if (session.discipline === 'bike') {
        const viz = renderWorkoutVisualizer(session, ftp);
        if (viz) content.append(viz);
      }
      const referenceFtp = Number(session.source_reference_ftp_watts || 0);
      if (referenceFtp && ftp && referenceFtp !== ftp) {
        content.append(make('p', 'session-ftp-warning', `Исходные проценты этого блока рассчитаны при FTP ${referenceFtp} Вт; текущий рабочий FTP — ${ftp} Вт. Экспорт сохраняет явно заданные в плане ватты, а проценты без ватт считает от текущего FTP.`));
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

  const renderNextBikeExports = (manifest, ftp) => {
    const mount = document.getElementById('approved-plan-calendar');
    const sessions = (manifest.weeks || []).flatMap(week => week.days || [])
      .filter(session => session.discipline === 'bike' && session.date >= localMoscowDate() && !session.completed)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3);
    const panel = make('section', 'card next-bike-export-panel');
    panel.append(
      make('h3', '', '🚴 Ближайшие 3 велотренировки'),
      make('p', 'next-bike-export-copy', 'Скачай ZWO для MyWhoosh или FIT для Garmin. В MyWhoosh файл нужно один раз импортировать через веб-конструктор.'),
    );
    if (!sessions.length) {
      panel.append(make('p', 'next-bike-export-empty', 'В календаре нет будущих велотренировок для экспорта.'));
    } else {
      const list = make('div', 'next-bike-export-list');
      sessions.forEach(session => {
        const row = make('div', 'next-bike-export-row');
        const details = make('div', 'next-bike-export-details');
        details.append(
          make('strong', '', `${formatDate(session.date)} · ${session.title || 'Велотренировка'}`),
          make('span', '', `${formatDuration(session.duration_min)}${session.goal ? ` · ${session.goal}` : ''}`),
        );
        const actions = make('div', 'teleport-btn-row');
        const zwo = make('button', 'btn btn-teleport-zwo', 'ZWO · MyWhoosh');
        zwo.type = 'button';
        zwo.onclick = () => exportZwoFile(session, ftp);
        const fit = make('button', 'btn btn-teleport-fit', 'FIT · Garmin');
        fit.type = 'button';
        fit.onclick = () => exportFitFile(session, ftp);
        actions.append(zwo, fit);
        row.append(details, actions);
        list.append(row);
      });
      panel.append(list);
      const guide = make('button', 'btn btn-action-help', 'Как импортировать ZWO в MyWhoosh с телефона');
      guide.type = 'button';
      guide.onclick = showMyWhooshGuideModal;
      panel.append(guide);
    }
    mount.append(panel);
  };

  const renderPlan = (manifest, customFtp) => {
    const mount = document.getElementById('approved-plan-calendar');
    if (!mount) return;
    mount.replaceChildren();
    if (manifest.status === 'awaiting_approved_sync' || !Array.isArray(manifest.weeks) || !manifest.weeks.length) {
      mount.append(make('div', 'card plan-loading', 'Утверждённая версия программы ещё не синхронизирована из TriCoach.'));
      return;
    }
    const baseFtp = getWorkingFtp(manifest);
    const ftp = Number.isInteger(customFtp) && customFtp >= 100 && customFtp <= 600 ? customFtp : baseFtp;
    const tools = make('div', 'plan-tools');
    const intro = make('div');
    const calcNotice = ftp !== baseFtp ? ` · калькулятор: ${ftp} Вт (базовый ${baseFtp} Вт)` : '';
    intro.append(make('h2', '', 'План по неделям'), make('p', '', `Версия ${manifest.version_number} · обновлено ${manifest.updated_at || '—'}${calcNotice}`));
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
    renderNextBikeExports(manifest, ftp);
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

  const updateLiveSystemStatus = async container => {
    try {
      const res = await fetch('https://tricoach-garmin.onrender.com/api/mission-control/status', { cache: 'no-store' });
      if (!res.ok) throw new Error('status_unavailable');
      const data = await res.json();
      container.replaceChildren();
      const serviceDefs = [
        { key: 'garmin', name: 'Garmin Connect' },
        { key: 'openai', name: 'AI Coach Omni' },
        { key: 'render_api', name: 'Render API' },
        { key: 'telegram', name: '@Ardenisov_bot' },
        { key: 'pages', name: 'GitHub Pages' },
        { key: 'database', name: 'PostgreSQL' },
      ];
      serviceDefs.forEach(s => {
        const info = data.services?.[s.key] || { status: 'UNKNOWN', detail: '' };
        const rawStatus = String(info.status || 'UNKNOWN').toUpperCase();
        let cls = 'unknown';
        if (rawStatus === 'OK') cls = 'ok';
        else if (rawStatus === 'STALE' || rawStatus === 'CACHED') cls = 'stale';
        else if (rawStatus === 'FAILED') cls = 'failed';

        const pill = make('div', `status-pill ${cls}`);
        pill.title = info.detail || '';
        pill.innerHTML = `<span class="status-dot"></span><span class="status-name">${s.name}:</span> <b class="status-val">${rawStatus === 'CACHED' ? 'ИСТОРИЯ В БАЗЕ' : rawStatus}</b>`;
        container.append(pill);
      });

      const gateBadge = document.getElementById('safety-gate-status-badge');
      if (gateBadge && data.safety_gates) {
        const rawGate = String(data.safety_gates.status || 'PENDING').toUpperCase();
        const gateCls = rawGate === 'CLEAR' ? 'safe-badge' : 'safe-badge pending';
        gateBadge.className = gateCls;
        gateBadge.textContent = data.safety_gates.detail || 'Статус согласования неизвестен.';
      }
    } catch (_err) {
      container.replaceChildren();
      ['Garmin Connect', 'AI Coach Omni', 'Render API', '@Ardenisov_bot', 'GitHub Pages', 'PostgreSQL'].forEach(name => {
        const pill = make('div', 'status-pill failed');
        pill.title = 'Бэкенд недоступен или сетевая ошибка';
        pill.innerHTML = `<span class="status-dot"></span><span class="status-name">${name}:</span> <b class="status-val">FAILED</b>`;
        container.append(pill);
      });
    }
  };

  const updateLivePlanBanner = async (container, publishedVersion) => {
    try {
      const res = await fetch('https://tricoach-garmin.onrender.com/api/mission-control/status', { cache: 'no-store' });
      if (!res.ok) throw new Error('status_unavailable');
      const data = await res.json();
      const gates = data.safety_gates || {};
      const version = gates.active_version;
      const title = make('div', 'banner-pill', version ? `📋 Действующая программа: Версия ${version}` : '📋 Версия программы не подтверждена');
      const message = version && publishedVersion && version !== publishedVersion
        ? `На сайте версия ${publishedVersion}. В TriCoach утверждена версия ${version}. Ожидается публикация.`
        : gates.detail || 'Статус согласования временно не подтверждён.';
      const detail = make('p', 'banner-sub', message);
      container.replaceChildren(title, detail);
    } catch (_err) {
      const title = make('div', 'banner-pill', '📋 Статус утверждённой программы недоступен');
      const detail = make('p', 'banner-sub', 'Повторите проверку позже; версия берётся из живого состояния TriCoach.');
      container.replaceChildren(title, detail);
    }
  };

  const renderDashboard = manifest => {
    const dashboard = document.querySelector('[data-pane="now"]');
    if (!dashboard) return;
    dashboard.replaceChildren();

    // 1. Technical System Status Bar (Live health checks)
    const statusBar = make('div', 'mission-status-bar');
    ['Garmin Connect', 'AI Coach Omni', 'Render API', '@Ardenisov_bot', 'GitHub Pages', 'PostgreSQL'].forEach(name => {
      const pill = make('div', 'status-pill unknown');
      pill.innerHTML = `<span class="status-dot"></span><span class="status-name">${name}:</span> <b class="status-val">SYNC...</b>`;
      statusBar.append(pill);
    });
    dashboard.append(statusBar);
    updateLiveSystemStatus(statusBar);

    // 1b. Active plan version notice
    const planBanner = make('div', 'active-plan-banner');
    planBanner.append(
      make('div', 'banner-pill', `📋 Действующая программа: Версия ${manifest.version_number || '—'}`),
      make('p', 'banner-sub', 'Проверяю актуальный статус в TriCoach…'),
    );
    dashboard.append(planBanner);
    updateLivePlanBanner(planBanner, manifest.version_number);

    const workingFtp = getWorkingFtp(manifest);
    const target = manifest.target || {ftp_watts: 340, date: '2027-07-11', target_weight_kg: 80.0, target_w_kg: 4.25};
    const targetFtp = Number(target.ftp_watts) || 340;
    const targetDate = target.date || '2027-07-11';
    const targetWeight = Number(target.target_weight_kg) || 80.0;
    const targetWkg = Number(target.target_w_kg) || Number((targetFtp / targetWeight).toFixed(2));
    const gap = targetFtp - workingFtp;
    const totalWeeks = Array.isArray(manifest.weeks) && manifest.weeks.length > 0 ? (manifest.weeks.length - 1) : 34;
    const isConfirmed = Boolean(manifest.current_ftp?.confirmed_watts);
    const today = localMoscowDate();
    const allDays = (manifest.weeks || []).flatMap(week => week.days || []);
    const todaySession = allDays.find(day => day.date === today);
    const nextSession = allDays.filter(day => day.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const session = todaySession || nextSession;

    // 2. Hero Mission Header
    const hero = make('div', 'hero mission-hero');
    const left = make('div', 'hero-content');
    left.innerHTML = `
      <div class="hero-live-badge"><span class="pulse-dot"></span> MISSION CONTROL · ВЕЛОМОЩЬ 2.0</div>
      <h1>Фокус дня <em>· ${todaySession ? 'Сегодня' : 'Ближайший старт'}</em></h1>
      <p class="hero-copy">Стратегическая цель: <b>FTP ${targetFtp} Вт</b> к <b>${formatDate(targetDate)}</b> (${targetDate}). Разрыв: <b>${gap} Вт</b>. Рабочий FTP: <b>${workingFtp} Вт</b> (${isConfirmed ? 'подтверждён' : 'заявлен'}).</p>
    `;

    const card = make('article', 'next-card today-focus-card');
    card.append(make('small', '', todaySession ? '🔴 Сегодняшняя сессия' : '⚡ Ближайшая сессия плана'));
    if (session) {
      const [tagClass, kind] = sessionKind(session.discipline);
      const titleRow = make('div', 'hero-session-header');
      titleRow.innerHTML = `<span class="tag ${tagClass}">${kind}</span> <h2 class="hero-session-title">${session.title || 'Тренировка'}</h2>`;
      card.append(titleRow);
      card.append(make('div', 'watts', formatDuration(session.duration_min)));
      card.append(make('p', 'session-meta-line', `${formatDate(session.date)} · ${session.goal || ''}`));
      if (session.main_set) {
        card.append(make('p', 'session-set-preview', sessionWattText(session.main_set, workingFtp)));
      }

      // Teleport 1-click action buttons
      if (session.discipline === 'bike') {
        const actionRow = make('div', 'teleport-actions-row');
        const zwoBtn = make('button', 'btn btn-action-zwo', '🚴 Скачать ZWO');
        zwoBtn.type = 'button';
        zwoBtn.onclick = () => exportZwoFile(session, workingFtp);

        const fitBtn = make('button', 'btn btn-action-fit', '⌚ Скачать FIT');
        fitBtn.type = 'button';
        fitBtn.onclick = () => exportFitFile(session, workingFtp);

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

    // 3. Quick KPI Metrics (Unified athlete profile)
    const metrics = make('div', 'metrics');
    const metric1 = make('article', 'metric');
    metric1.innerHTML = `<span class="metric-label">Рабочий FTP</span><b class="metric-val cyan">${workingFtp} Вт</b><small class="metric-sub">${isConfirmed ? '✓ Подтверждён тестом' : '⚡ Заявлен спортсменом'}</small>`;
    const metric2 = make('article', 'metric');
    metric2.innerHTML = `<span class="metric-label">Разрыв до цели</span><b class="metric-val amber">+${gap} Вт</b><small class="metric-sub">Цель ${targetFtp} Вт к ${formatDate(targetDate)}</small>`;
    const metric3 = make('article', 'metric');
    metric3.innerHTML = `<span class="metric-label">Удельная мощность</span><b class="metric-val lime">${targetWkg} Вт/кг</b><small class="metric-sub">Целевой вес ${targetWeight} кг</small>`;
    const metric4 = make('article', 'metric');
    metric4.innerHTML = `<span class="metric-label">План подготовки</span><b class="metric-val emerald">${manifest.version_number ? `Версия ${manifest.version_number}` : 'План загружен'}</b><small class="metric-sub">~${totalWeeks} нед. микроциклов</small>`;
    metrics.append(metric1, metric2, metric3, metric4);

    // 4. Daily Readiness & Safety Insight Card
    const insightCard = make('article', 'card readiness-insight-card');
    insightCard.innerHTML = `
      <h3>Согласование плана</h3>
      <div class="safety-indicator-row">
        <span class="safe-badge pending" id="safety-gate-status-badge">Проверяю статус согласования…</span>
      </div>
    `;

    dashboard.append(hero, metrics, insightCard);
  };

  // ── Mission Control Section 2: FTP 340 (Digital Twin) ────────────────────────

  const renderDigitalTwinPane = (pane, manifest) => {
    pane.replaceChildren();
    const workingFtp = getWorkingFtp(manifest);
    const target = manifest.target || {ftp_watts: 340, date: '2027-07-11', target_weight_kg: 80.0, target_w_kg: 4.25};
    const targetFtp = Number(target.ftp_watts) || 340;
    const targetDate = target.date || '2027-07-11';
    const targetWeight = Number(target.target_weight_kg) || 80.0;
    const targetWkg = Number(target.target_w_kg) || Number((targetFtp / targetWeight).toFixed(2));
    const gap = targetFtp - workingFtp;
    const isConfirmed = Boolean(manifest.current_ftp?.confirmed_watts);
    const totalWeeks = Array.isArray(manifest.weeks) && manifest.weeks.length > 0 ? (manifest.weeks.length - 1) : 34;

    const header = make('div', 'dt-header');
    header.append(
      make('h2', '', 'DIGITAL TWIN · Персональная модель FTP 340'),
      make('p', 'sub', `Объяснимая научная траектория развития мощности к ${formatDate(targetDate)} (${targetDate}) на основе доказательной физиологии.`),
    );

    // KPI Cards - No fictitious sports data
    const kpiGrid = make('div', 'metrics dt-kpis');
    kpiGrid.append(
      (() => {
        const c = make('article', 'metric');
        c.innerHTML = `<span>Текущий рабочий FTP</span><b>${workingFtp} Вт</b><small>${isConfirmed ? 'Подтверждён тестом' : 'Заявлен спортсменом (не подтверждён тестом)'}</small>`;
        return c;
      })(),
      (() => {
        const c = make('article', 'metric');
        c.innerHTML = `<span>Цель к ${targetDate}</span><b class="lime">${targetFtp} Вт</b><small>Разрыв: ${gap} Вт · Вес: ${targetWeight} кг (${targetWkg} Вт/кг)</small>`;
        return c;
      })(),
      (() => {
        const c = make('article', 'metric');
        c.innerHTML = `<span>Critical Power (CP)</span><b class="cyan" style="font-size:16px;">Недостаточно данных</b><small>Для расчёта CP и W′ нужны результаты P3 и P12</small>`;
        return c;
      })(),
      (() => {
        const c = make('article', 'metric');
        c.innerHTML = `<span>Durability (>1200 кДж)</span><b style="font-size:16px;">Недостаточно данных</b><small>Требуются длительные тренировки с мощемером</small>`;
        return c;
      })(),
    );

    // Honest Trajectory Notice Card - No fictitious trajectory or CI corridor
    const trajectoryCard = make('article', 'card dt-chart-card');
    trajectoryCard.innerHTML = `
      <h3>📈 Модель траектории FTP к ${formatDate(targetDate)}</h3>
      <div class="dt-uncalibrated-notice">
        <p><b>Статус калибровки:</b> Недостаточно данных для построения математического коридора.</p>
        <p>Текущий рабочий FTP <b>${workingFtp} Вт</b> ${isConfirmed ? 'подтверждён тестом' : 'зафиксирован со слов спортсмена и пока не верифицирован контрольным тестом'}. Целевой ориентир — <b>${targetFtp} Вт к ${targetDate}</b> (+${gap} Вт за ~${totalWeeks} недели, средний темп ~${(gap / totalWeeks).toFixed(1)} Вт/неделя).</p>
        <p class="data-note">Темп до цели показывает требуемый прирост. Для оценки индивидуальной адаптации нужна серия сопоставимых тестов.</p>
      </div>
    `;

    // Power-Duration Curve (MMP) - No fictitious numbers
    const mmpCard = make('article', 'card dt-mmp-card');
    mmpCard.innerHTML = `
      <h3>⚡ Профиль мощности (Power-Duration Curve)</h3>
      <p class="sub" style="margin-bottom:12px;">Недостаточно данных (требуется калибровка тестами и синхронизация Garmin мощности)</p>
      <div class="mmp-grid">
        <div class="mmp-item"><span class="mmp-dur">5с (Спринт)</span><b class="mmp-w" style="font-size:14px;color:var(--dim);">Не откалиброван</b><span class="mmp-wkg">—</span></div>
        <div class="mmp-item"><span class="mmp-dur">15с</span><b class="mmp-w" style="font-size:14px;color:var(--dim);">Не откалиброван</b><span class="mmp-wkg">—</span></div>
        <div class="mmp-item"><span class="mmp-dur">1 мин</span><b class="mmp-w" style="font-size:14px;color:var(--dim);">Не откалиброван</b><span class="mmp-wkg">—</span></div>
        <div class="mmp-item"><span class="mmp-dur">3 мин (VO2)</span><b class="mmp-w" style="font-size:14px;color:var(--dim);">Не откалиброван</b><span class="mmp-wkg">—</span></div>
        <div class="mmp-item"><span class="mmp-dur">5 мин (P5)</span><b class="mmp-w" style="font-size:14px;color:var(--dim);">Не откалиброван</b><span class="mmp-wkg">—</span></div>
        <div class="mmp-item"><span class="mmp-dur">10 мин</span><b class="mmp-w" style="font-size:14px;color:var(--dim);">Не откалиброван</b><span class="mmp-wkg">—</span></div>
        <div class="mmp-item"><span class="mmp-dur">20 мин (P20)</span><b class="mmp-w" style="font-size:14px;color:var(--dim);">Не откалиброван</b><span class="mmp-wkg">—</span></div>
        <div class="mmp-item"><span class="mmp-dur">Рабочий FTP</span><b class="mmp-w" style="font-size:14px;color:var(--dim);">${workingFtp} Вт (${isConfirmed ? 'подтверждён' : 'заявлен'})</b><span class="mmp-wkg">—</span></div>
      </div>
    `;

    // PMC Form Management (CTL / ATL / TSB) - Honest uncalibrated state
    const pmcCard = make('article', 'card dt-pmc-card');
    pmcCard.innerHTML = `
      <h3>📊 Управление формой (Performance Management Chart)</h3>
      <div class="pmc-stats">
        <div class="pmc-stat"><span>ATL (усталость, 7д)</span><b style="color:var(--dim);">Недостаточно данных</b></div>
        <div class="pmc-stat"><span>CTL (форма, 42д)</span><b style="color:var(--dim);">Недостаточно данных</b></div>
        <div class="pmc-stat"><span>TSB (баланс формы)</span><b style="color:var(--dim);">Недостаточно данных</b></div>
      </div>
      <div class="caveats-box">
        <b>⚠️ Статус калибровки:</b>
        <ul>
          <li>Требуется накопление истории тренировочных файлов (.FIT) с измерителем мощности для расчёта импульса ТСС.</li>
        </ul>
      </div>
    `;

    const testsCard = make('article', 'card dt-tests-card');
    testsCard.innerHTML = `
      <h3>🎯 Контрольные тесты и вехи Плана v5 (P5 + P20 + P40)</h3>
      <div class="dt-roadmap">
        <div class="dt-milestone-card active-target">
          <small>Неделя 1–2 (Ноябрь 2026)</small>
          <b>280 Вт (Баслайн)</b>
          <span>T5 · T20 · P40 срезы</span>
          <span class="badge-status current">ТЕКУЩИЙ</span>
        </div>
        <div class="dt-milestone-card">
          <small>Неделя 10 (Январь 2027)</small>
          <b>≥ 295 Вт (Чекпоинт 1)</b>
          <span>T5 + T20 срезы</span>
          <span class="badge-status upcoming">В ПЛАНЕ</span>
        </div>
        <div class="dt-milestone-card">
          <small>Неделя 17–18 (Март 2027)</small>
          <b>≥ 310 Вт (Чекпоинт 2)</b>
          <span>TTE-тест + P40</span>
          <span class="badge-status upcoming">В ПЛАНЕ</span>
        </div>
        <div class="dt-milestone-card">
          <small>Неделя 26 (Май 2027)</small>
          <b>≥ 325 Вт (Чекпоинт 3)</b>
          <span>T5 + T20 срезы</span>
          <span class="badge-status upcoming">В ПЛАНЕ</span>
        </div>
        <div class="dt-milestone-card">
          <small>Неделя 34 (Июль 2027)</small>
          <b class="lime">340 Вт (ФИНАЛ)</b>
          <span>4.25 Вт/кг @ 80 кг</span>
          <span class="badge-status final">ФИНАЛ</span>
        </div>
      </div>
    `;
    const testList = make('ul', 'test-milestones-list');
    testList.style.marginTop = '14px';
    const tests = (manifest.weeks || []).flatMap(week => week.days || [])
      .filter(session => session.date >= localMoscowDate() && /^ТЕСТ(?:\s|$)/u.test(session.title || ''));
    if (tests.length) {
      for (const session of tests) {
        testList.append(make('li', '', `${formatDate(session.date)} · ${session.title}`));
      }
    } else {
      [
        '22.11.2026 (Неделя 1): ТЕСТ T5 (5\' all-out) — калибровка пиковой аэробной мощности (MAP).',
        '26.11.2026 (Неделя 2): ТЕСТ T20 (20\' all-out) — подтверждение рабочего FTP (0.95 × P20).',
        '29.11.2026 (Неделя 2): ТЕСТ P40 (40\' best effort) — базовый срез пороговой выносливости.',
        'Январь 2027 (Неделя 10): Контрольный срез Блока 2 (T5 + T20) → проверка темпа роста FTP.',
        'Март 2027 (Неделя 17–18): TTE-тест (95% continuous) + срезы T5 / T20 / P40.',
        'Июль 2027 (Неделя 34): Финальный вердикт: цель 336–340 Вт (T5, T20, P40).',
      ].forEach(text => testList.append(make('li', '', text)));
    }
    testsCard.append(testList);

    // Privacy-Protected Telemetry Box - Secure Authorization (No query token)
    const privacyBox = make('article', 'card telemetry-privacy-box');
    privacyBox.innerHTML = `
      <div class="privacy-header">
        <span class="lock-pill">🔒 Защищённый контур биометрии Garmin</span>
        <p>Конфиденциальные медицинские данные и восстановление доступны только владельцу. Получите временный PIN командой <b>/telemetry_pin</b> в Telegram; срок действия — 15 минут.</p>
      </div>
      <div class="privacy-inputs">
        <input type="password" id="telemetry-pin-input" placeholder="PIN из Telegram" class="ftpin" style="width:180px;padding:8px 12px;" />
        <button type="button" class="btn" id="btn-telemetry-unlock" style="background:var(--acc2);color:#0f1115;font-weight:700;">Открыть телеметрию</button>
      </div>
      <div id="telemetry-secure-display" style="display:none;margin-top:14px;"></div>
    `;

    pane.append(header, kpiGrid, trajectoryCard, mmpCard, pmcCard, testsCard, privacyBox);

    // Event listener for unlock - Bearer token, rate limit handling, input wipe
    const unlockBtn = privacyBox.querySelector('#btn-telemetry-unlock');
    const pinInput = privacyBox.querySelector('#telemetry-pin-input');
    const display = privacyBox.querySelector('#telemetry-secure-display');
    if (unlockBtn && pinInput && display) {
      unlockBtn.addEventListener('click', async () => {
        const pin = pinInput.value.trim();
        pinInput.value = '';
        if (!pin) return;
        unlockBtn.textContent = 'Проверяю…';
        try {
          const res = await fetch('https://tricoach-garmin.onrender.com/api/mission-control/telemetry', {
            headers: {
              'Authorization': `Bearer ${pin}`,
            },
          });
          if (res.status === 429) {
            display.style.display = 'block';
            display.innerHTML = `<span style="color:var(--bad);">✕ Слишком много неверных попыток. Доступ временно заблокирован на 15 минут (защита от перебора).</span>`;
            unlockBtn.textContent = 'Заблокировано';
            return;
          }
          if (!res.ok) throw new Error('unauthorized');
          const data = await res.json();
          display.style.display = 'block';
          display.innerHTML = `
            <div class="telemetry-badge-ok">✓ Защищённая сессия активна</div>
            <p>Последних синхронизированных тренировок: <b>${data.recent_executions?.length || 0}</b></p>
            <p>Отчётов AI Power Forensics в архиве: <b>${data.recent_forensics?.length || 0}</b></p>
          `;
          unlockBtn.textContent = 'Доступ открыт';
          const twin = await fetch('https://tricoach-garmin.onrender.com/api/digital-twin', {
            headers: { Authorization: `Bearer ${pin}` }, cache: 'no-store',
          }).then(response => response.ok ? response.json() : null).catch(() => null);
          if (twin) {
            const measured = (twin.power_duration_curve || []).filter(point => point.source === 'measured');
            const list = make('ul', '');
            for (const point of measured) {
              list.append(make('li', '', `${point.duration_sec} с · ${Math.round(point.watts)} Вт`));
            }
            if (measured.length) display.append(make('h4', '', 'Измеренные максимумы мощности'), list);
          }
        } catch (_e) {
          display.style.display = 'block';
          display.innerHTML = `<span style="color:var(--bad);">✕ PIN неверный или истёк. Получите новый командой /telemetry_pin.</span>`;
          unlockBtn.textContent = 'Открыть телеметрию';
        }
      });
    }
  };

  // ── Mission Control Section 4: AI COACH ──────────────────────────────────────

  const renderCoachPane = (pane, manifest) => {
    pane.replaceChildren();
    const target = manifest?.target || {ftp_watts: 340, date: '2027-07-11'};
    const card = make('article', 'card coach-architecture-card');
    card.innerHTML = `
      <h2>OMNI HEAD PERFORMANCE COACH · Архитектура и Договор ответственности</h2>
      <div class="coach-principles">
        <div class="cp-item">
          <b>🎯 Главный KPI: FTP ${target.ftp_watts || 340} Вт (${formatDate(target.date || '2027-07-11')})</b>
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
    const brandLeft = make('div', 'brand');
    brandLeft.innerHTML = `
      <div class="bolt">⚡</div>
      <div class="brand-text">
        <span class="brand-name">ВЕЛОМОЩЬ <span class="brand-badge">PRO</span></span>
        <span class="brand-sub">FTP 340 · ROAD TO 4.25 W/KG</span>
      </div>
    `;
    const targetDateStr = '2027-07-11';
    const daysUntilTarget = Math.max(0, Math.ceil((new Date(targetDateStr + 'T12:00:00') - new Date()) / 86400000));
    const brandRight = make('div', 'brand-meta');
    brandRight.innerHTML = `
      <span class="date-chip">🎯 Цель: <b>11 июля 2027</b></span>
      <span class="countdown-chip">⏳ <b>${daysUntilTarget} дн.</b></span>
    `;
    brand.append(brandLeft, brandRight);
    const tabs = make('nav', 'tabbar');
    tabs.setAttribute('aria-label', 'Разделы борда');

    // 4 Key Mission Control tabs + guide
    const TAB_DEFS = [
      ['now', '⚡ СЕГОДНЯ'],
      ['ftp340', '📈 FTP 340'],
      ['plan', '📅 КАЛЕНДАРЬ'],
      ['coach', '🤖 AI COACH'],
      ['guide', '📚 БАЗА ЗНАНИЙ'],
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
      calendarVersion = manifest.version_number;

      // Live Hybrid Rendering: Overlay verified completion & power telemetry from API
      try {
        const liveRes = await fetch('https://tricoach-garmin.onrender.com/api/plan/live-status', {
          headers: { 'Accept': 'application/json' },
        });
        if (liveRes.ok) {
          const liveData = await liveRes.json();
          if (liveData) {
            if (liveData.date_overrides) {
              (manifest.weeks || []).forEach(w => {
                (w.days || []).forEach(d => {
                  if (liveData.date_overrides[d.date]) {
                    Object.assign(d, liveData.date_overrides[d.date]);
                  }
                });
              });
            }
            if (liveData.completed_sessions) {
              (manifest.weeks || []).forEach(w => {
                (w.days || []).forEach(d => {
                  if (liveData.completed_sessions[d.date]) {
                    d.completed = true;
                    Object.assign(d, liveData.completed_sessions[d.date]);
                  }
                });
              });
            }
          }
        }
      } catch (_e) {
        // Standalone / offline fallback
      }
      const chip = document.querySelector('.date-chip');
      if (chip && manifest.target) {
        chip.textContent = `Цель FTP ${manifest.target.ftp_watts || 340} · ${formatDate(manifest.target.date || '2027-07-11')}`;
      }
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
      renderDashboard({target: {ftp_watts: 340, date: '2027-07-11', target_weight_kg: 80.0, target_w_kg: 4.25}, current_ftp: {reported_watts: 280}, weeks: [], version_number: null});
    }
  };

  window.toggleAll = open => document.querySelectorAll('details.week').forEach(week => {
    week.open = Boolean(open);
    week.classList.toggle('selected-week', Boolean(open));
  });
  window.openToday = () => {
    const today = localMoscowDate();
    const week = [...document.querySelectorAll('details.week')].find(item => item.dataset.s <= today && today <= item.dataset.e);
    if (week) {
      document.querySelectorAll('details.week').forEach(item => item.classList.toggle('selected-week', item === week));
      week.open = true;
      week.scrollIntoView({behavior: 'smooth'});
    }
  };
  document.addEventListener('DOMContentLoaded', init);
})();
