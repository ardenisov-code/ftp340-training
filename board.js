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
    const watts = Number(current?.reported_watts ?? current?.confirmed_watts);
    return Number.isInteger(watts) && watts >= 100 && watts <= 600 ? watts : null;
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
    return hours ? `${hours} ч${rest ? ` ${rest} мин` : ''}` : `${rest} мин`;
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

  const SERVICE = 'https://tricoach-garmin.onrender.com';
  const timeoutOptions = milliseconds => typeof AbortSignal.timeout === 'function'
    ? {signal: AbortSignal.timeout(milliseconds)}
    : {};
  const MYWHOOSH_BUILDER = 'https://workout.mywhoosh.com/';
  const MYWHOOSH_GUIDE = 'https://www.mywhoosh.com/everything-you-need-to-know-about-the-new-mywhoosh-workout-builder/';
  let calendarVersion;

  const exportWorkout = async (session, ftp, format, button, status) => {
    const endpoint = new URL(`${SERVICE}/api/workouts/${session.date}.${format}`);
    endpoint.searchParams.set('ftp', ftp);
    if (calendarVersion) endpoint.searchParams.set('version', calendarVersion);
    button.disabled = true;
    status.textContent = `Готовлю ${format.toUpperCase()}…`;
    status.classList.remove('export-error');
    try {
      const response = await fetch(endpoint, timeoutOptions(20000));
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const message = response.status === 422
          ? error.detail || 'Для этого занятия в плане недостаточно точных интервалов.'
          : 'Экспорт временно недоступен. Попробуй ещё раз.';
        throw new Error(message);
      }
      const file = URL.createObjectURL(await response.blob());
      const link = make('a');
      link.href = file;
      link.download = `TriCoach_${session.date}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(file), 30000);
      status.textContent = `Скачивание ${format.toUpperCase()} началось.`;
    } catch (err) {
      status.classList.add('export-error');
      status.textContent = err.name === 'TimeoutError' || err instanceof TypeError
        ? 'Сервис экспорта не ответил. Попробуй ещё раз.'
        : `Не удалось скачать ${format.toUpperCase()}. ${err.message}`;
    } finally {
      button.disabled = false;
    }
  };

  const renderExportActions = (session, ftp) => {
    const sessionReference = Number(session.source_reference_ftp_watts);
    const exportFtp = Number.isInteger(sessionReference) && sessionReference >= 100 && sessionReference <= 600 ? sessionReference : ftp;
    const group = make('div', 'workout-downloads');
    const row = make('div', 'workout-download-actions');
    const status = make('p', 'workout-download-status');
    status.setAttribute('role', 'status');
    for (const [format, label] of [['zwo', 'ZWO · MyWhoosh'], ['fit', 'FIT · Garmin']]) {
      const button = make('button', `btn workout-download workout-download-${format}`, label);
      button.type = 'button';
      button.disabled = !calendarVersion || !exportFtp;
      button.onclick = () => exportWorkout(session, exportFtp, format, button, status);
      row.append(button);
    }
    if (!calendarVersion || !exportFtp) status.textContent = 'Экспорт для этой версии недоступен.';
    group.append(row, status);
    return group;
  };

  const showMyWhooshGuideModal = () => {
    const existing = document.getElementById('mywhoosh-guide-modal');
    if (existing) { existing.showModal(); return; }

    const dialog = make('dialog', 'workout-import-dialog');
    dialog.id = 'mywhoosh-guide-modal';
    dialog.setAttribute('aria-labelledby', 'mywhoosh-guide-title');
    const title = make('h2', '', 'Импорт в MyWhoosh');
    title.id = 'mywhoosh-guide-title';
    const close = make('button', 'workout-import-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть инструкцию');
    close.onclick = () => dialog.close();
    const steps = make('ol');
    [
      'Скачай ZWO. На телефоне найди его в приложении «Файлы», в папке «Загрузки» (Downloads).',
      'Открой Workout Builder и войди в свой аккаунт MyWhoosh.',
      'Нажми Import и выбери скачанный файл. Затем нажми Export to MyWhoosh.',
      'Открой MyWhoosh → Workout → MyWorkout. Повтори импорт для остальных файлов.',
    ].forEach(step => steps.append(make('li', '', step)));
    const open = make('a', 'btn workout-download workout-download-zwo', 'Открыть Workout Builder');
    open.href = MYWHOOSH_BUILDER;
    open.target = '_blank';
    open.rel = 'noopener';
    const guide = make('a', 'workout-link', 'Инструкция MyWhoosh');
    guide.href = MYWHOOSH_GUIDE;
    guide.target = '_blank';
    guide.rel = 'noopener';
    const nav = make('div', 'workout-import-actions');
    nav.append(open, guide);
    dialog.append(title, close, steps, nav);
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    document.body.append(dialog);
    dialog.showModal();
  };

  const renderMyWhooshHelp = () => {
    const guide = make('button', 'workout-link', 'Как импортировать ZWO в MyWhoosh с телефона');
    guide.type = 'button';
    guide.onclick = showMyWhooshGuideModal;
    return guide;
  };

  // ── Calculator & ZTab ────────────────────────────────────────────────────────

  const renderCalculator = manifest => {
    const input = document.getElementById('ftp-reference');
    const body = document.querySelector('.ztab tbody');
    if (!input || !body) return;
    const stored = Number(localStorage.getItem('ftp340_public_calc') || 0);
    const source = manifest.profile?.workingFtp ?? getWorkingFtp(manifest);
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

  // Some public descriptions omit pulse targets for privacy. Structured export
  // steps contain the planned targets; never infer them from athlete telemetry.
  const plannedHrIntervals = session => {
    const groups = new Map();
    for (const step of session.export_steps || []) {
      const {duration_sec: seconds, heart_rate_low_bpm: low, heart_rate_high_bpm: high} = step;
      if (step.type !== 'interval' || !Number.isFinite(seconds) || seconds <= 0 ||
          !Number.isFinite(low) || !Number.isFinite(high) || low > high) continue;
      const key = `${seconds}|${low}|${high}`;
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    return [...groups].map(([key, count]) => {
      const [seconds, low, high] = key.split('|').map(Number);
      const duration = seconds % 60 === 0 ? `${seconds / 60} мин` : `${seconds} с`;
      return `${count > 1 ? `${count} × ` : ''}${duration} · ЧСС ${low}–${high} уд/мин`;
    }).join('; ');
  };
  const weekPresentation = week => {
    const statuses = new Set((week.days || []).map(day => day.source_ftp_status).filter(Boolean));
    return statuses.has('confirmed_ftp_baseline') && statuses.has('athlete_reported')
      ? {block: 'Переходная неделя', rationale: 'История и новая программа: ориентируйтесь на занятия по дням.'}
      : {block: week.block || 'План', rationale: week.block_rationale || 'Утверждённый микроцикл программы.'};
  };
  const renderSessionPhases = session => {
    const phases = make('dl', 'workout-phases');
    for (const [key, label] of [['warmup', 'Разминка'], ['main_set', 'Основная часть'], ['cooldown', 'Заминка']]) {
      if (!session[key]) continue;
      const row = make('div', 'workout-phase');
      row.append(make('dt', '', label), make('dd', '', session[key]));
      phases.append(row);
    }
    const targets = plannedHrIntervals(session);
    if (targets) {
      const row = make('div', 'workout-phase');
      row.append(make('dt', '', 'Плановые интервалы'), make('dd', '', targets));
      phases.append(row);
    }
    return phases;
  };

  // ── Calendar Week & Day Rendering ───────────────────────────────────────────

  const renderWeek = (week, ftp) => {
    const display = weekPresentation(week);
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
      make('span', 'tag load', display.block),
      make('span', 'wf', display.rationale),
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
      if (session.completed) content.append(make('span', 'tag done', 'Отмечено в плане'));
      if (session.duration_min) content.append(make('p', 'session-duration', formatDuration(session.duration_min)));
      if (session.goal) content.append(make('p', 'goal', session.goal));
      const phases = renderSessionPhases(session);
      if (phases.childElementCount) content.append(phases);
      if (session.cadence) content.append(make('p', 'session-cadence', session.cadence));
      if (session.key_numbers) content.append(make('p', 'session-key-numbers', session.key_numbers));
      if (session.discipline === 'bike') content.append(renderExportActions(session, ftp));

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
    panel.id = 'next-bike-exports';
    panel.append(
      make('h3', '', 'Ближайшие 3 велотренировки'),
      make('p', 'next-bike-export-copy', 'Тренировки из опубликованного календаря. Каждый ZWO загружается в MyWhoosh отдельно.'),
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
        row.append(details, renderExportActions(session, ftp));
        list.append(row);
      });
      panel.append(list);
      panel.append(renderMyWhooshHelp());
    }
    mount.append(panel);
  };

  const renderPlan = manifest => {
    const mount = document.getElementById('approved-plan-calendar');
    if (!mount) return;
    mount.replaceChildren();
    if (manifest.status === 'awaiting_approved_sync' || !Array.isArray(manifest.weeks) || !manifest.weeks.length) {
      mount.append(make('div', 'card plan-loading', 'Утверждённая версия программы ещё не синхронизирована из TriCoach.'));
      return;
    }
    const ftp = getWorkingFtp(manifest);
    const tools = make('div', 'plan-tools');
    const intro = make('div');
    intro.append(make('h2', '', 'План по неделям'), make('p', '', `Версия ${manifest.version_number} · база экспорта ${ftp ? `${ftp} Вт` : 'не указана'}`));
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
      const label = weekPresentation(week).block;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(week);
    });
    groups.forEach((blockWeeks, label) => {
      const first = blockWeeks.flatMap(week => week.days || []).map(day => day.date).filter(Boolean).sort()[0];
      const last = blockWeeks.flatMap(week => week.days || []).map(day => day.date).filter(Boolean).sort().slice(-1)[0];
      const card = make('article', 'card');
      card.append(make('h3', '', label));
      card.append(make('p', '', `${first ? formatDate(first) : ''}${last ? ` – ${formatDate(last)}` : ''} · ${blockWeeks.length} недель`));
      if (blockWeeks[0]) card.append(make('p', '', weekPresentation(blockWeeks[0]).rationale));
      mount.append(card);
    });
  };

  const SERVICE_LABELS = {
    garmin: 'Garmin', openai: 'Omni', render_api: 'Сервис', telegram: 'Telegram',
    pages: 'Сайт', database: 'Хранилище',
  };
  let missionStatus;
  const loadMissionStatus = () => {
    missionStatus ||= fetch(`${SERVICE}/api/mission-control/status`, {cache: 'no-store', ...timeoutOptions(5000)})
      .then(response => response.ok ? response.json() : null)
      .catch(() => null);
    return missionStatus;
  };

  const profileFor = (manifest, live) => {
    const positiveNumber = (number, fallback) => Number.isFinite(number) && number > 0 ? number : fallback;
    const target = live?.target_date && /^\d{4}-\d{2}-\d{2}$/.test(live.target_date) ? live.target_date : manifest.target?.date;
    const liveFtp = positiveNumber(live?.current_reported_ftp, null);
    const publishedFtp = getWorkingFtp(manifest);
    const confirmedFtp = liveFtp ? live.confirmed_ftp_watts : manifest.current_ftp?.confirmed_watts;
    const workingFtp = liveFtp ?? publishedFtp;
    return {
      workingFtp,
      isConfirmed: Boolean(workingFtp && confirmedFtp === workingFtp),
      targetFtp: positiveNumber(live?.ftp_watts, manifest.target?.ftp_watts),
      targetDate: target,
      targetWeight: positiveNumber(live?.target_weight_kg, manifest.target?.target_weight_kg),
      fromManifest: !liveFtp,
    };
  };

  const updateLiveSystemStatus = async container => {
    const data = await loadMissionStatus();
    const statuses = {OK: ['ok', 'Работает'], STALE: ['stale', 'Данные устарели'], CACHED: ['stale', 'Из кеша'], FAILED: ['failed', 'Сбой']};
    const pills = Object.entries(SERVICE_LABELS).map(([key, label]) => {
      const info = data?.services?.[key];
      const [state, value] = statuses[info?.status] || ['unknown', 'Нет статуса'];
      const pill = make('div', `status-pill ${state}`);
      pill.append(make('span', 'status-dot'), make('span', 'status-name', label), make('b', 'status-val', value));
      return pill;
    });
    container.replaceChildren(...pills);

    const gateBadge = document.getElementById('safety-gate-status-badge');
    if (gateBadge && data?.safety_gates) {
      const {status, pending_proposals_count: pending} = data.safety_gates;
      gateBadge.className = status === 'CLEAR' ? 'safe-badge' : 'safe-badge pending';
      gateBadge.textContent = pending > 0 ? 'Есть черновик для согласования в Telegram.'
        : status === 'CLEAR' ? 'Согласование пройдено.' : 'Статус согласования не подтверждён.';
    } else if (gateBadge) {
      gateBadge.textContent = 'Статус согласования недоступен.';
    }
  };

  const updateLivePlanBanner = async (container, publishedVersion) => {
    const data = await loadMissionStatus();
    const gates = data?.safety_gates || {};
    const version = gates.active_version;
    const note = container.querySelector('.banner-sub');
    if (!note) return;
    if (!publishedVersion) {
      note.textContent = version ? `В TriCoach утверждена версия ${version}. Страница её ещё не загрузила.` : 'Версия плана недоступна.';
    } else if (version && version !== publishedVersion) {
      note.textContent = `В TriCoach утверждена версия ${version}. На сайте пока версия ${publishedVersion}.`;
    } else {
      note.textContent = version ? 'Версия сайта совпадает с TriCoach.' : 'Статус в TriCoach временно недоступен.';
    }
  };

  const MONDAY_TO_SUNDAY = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const getWeekDates = value => {
    const start = new Date(`${value}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    return MONDAY_TO_SUNDAY.map((_, index) => {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + index);
      return day.toISOString().slice(0, 10);
    });
  };

  const sessionDisplayTitle = (title, label) => {
    const clean = (title || '').replace(new RegExp(`^${label}\\s+(?:[·•—–-]\\s*)?`, 'iu'), '').trim();
    return clean ? clean[0].toLocaleUpperCase('ru-RU') + clean.slice(1) : 'Тренировка';
  };

  const renderWeekAtAGlance = manifest => {
    const today = localMoscowDate();
    const sessions = (manifest.weeks || []).flatMap(week => week.days || []);
    const byDate = new Map(sessions.map(session => [session.date, session]));
    const currentWeek = getWeekDates(today);
    const hasCurrentWeek = currentWeek.some(date => byDate.has(date));
    const nextDate = sessions.map(session => session.date).filter(date => date > today).sort()[0];
    const dates = !hasCurrentWeek && nextDate ? getWeekDates(nextDate) : currentWeek;

    const header = make('header', 'training-week-heading');
    const title = make('h1', '', hasCurrentWeek || !nextDate ? 'На этой неделе' : 'Ближайшая неделя');
    const trainingCount = dates.filter(date => byDate.has(date) && byDate.get(date).discipline !== 'rest').length;
    const dateRange = `${formatDate(dates[0])} – ${formatDate(dates.at(-1))}`;
    const context = make('p', '', [
      dateRange,
      trainingCount ? `занятий: ${trainingCount}` : '',
      manifest.version_number ? `версия ${manifest.version_number}` : '',
    ].filter(Boolean).join(' · '));
    header.append(title, context);

    const days = make('div', 'training-week-days');
    days.setAttribute('role', 'group');
    days.setAttribute('aria-label', 'Дни недели по московскому времени');
    const card = make('article', 'training-day-card');
    card.setAttribute('aria-live', 'polite');
    const buttons = dates.map((date, index) => {
      const session = byDate.get(date);
      const label = {bike: 'Вело', strength: 'Сила', rest: 'Отдых', recovery: 'Восст.'}[session?.discipline] || '—';
      const button = make('button', 'training-week-day');
      button.type = 'button';
      button.append(
        make('span', 'training-day-name', MONDAY_TO_SUNDAY[index]),
        make('b', 'training-day-date', String(parseDate(date).getDate())),
        make('span', 'training-day-discipline', label),
      );
      if (date === today) button.setAttribute('aria-current', 'date');
      button.setAttribute('aria-label', `${MONDAY_TO_SUNDAY[index]}, ${formatDate(date)}. ${session?.title || 'Занятие не опубликовано'}`);
      button.onclick = () => selectDay(date);
      days.append(button);
      return button;
    });

    function selectDay(date) {
      const session = byDate.get(date);
      buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(dates[index] === date)));
      card.replaceChildren();
      const dateLabel = make('div', 'training-selected-date', `${date === today ? 'Сегодня · ' : ''}${formatDate(date)}`);
      card.append(dateLabel);
      if (!session) {
        card.append(make('h2', '', 'Занятие не опубликовано'));
        card.append(make('p', '', 'На эту дату в опубликованном плане нет записи.'));
        return;
      }
      const heading = make('div', 'training-session-heading');
      const [tag, label] = sessionKind(session.discipline);
      const title = sessionDisplayTitle(session.title, label);
      heading.append(make('span', `tag ${tag}`, label), make('h2', '', title));
      const duration = formatDuration(session.duration_min);
      if (duration) heading.append(make('span', 'training-duration', duration));
      card.append(heading);
      if (session.goal) card.append(make('p', 'training-session-goal', session.goal));
      const phases = renderSessionPhases(session);
      if (phases.childElementCount) card.append(phases);
      if (session.discipline === 'bike') {
        const ftp = getWorkingFtp(manifest);
        const actions = make('div', 'training-session-actions');
        actions.append(renderExportActions(session, ftp), renderMyWhooshHelp());
        card.append(actions);
      }
    }

    selectDay(dates.includes(today) ? today : nextDate || dates[0]);
    const actions = make('div', 'training-week-links');
    const next = make('button', 'workout-link', 'Ближайшие 3 велотренировки');
    next.type = 'button';
    next.onclick = () => {
      document.querySelector('[data-tab="plan"]')?.click();
      document.getElementById('next-bike-exports')?.scrollIntoView({block: 'start'});
    };
    if (sessions.length) actions.append(next);
    const week = make('section', 'training-week');
    week.append(header, days, card, actions);
    return week;
  };

  const renderProfileMetrics = manifest => {
    const {workingFtp, isConfirmed, targetFtp, targetDate, targetWeight, fromManifest} = manifest.profile;
    const metrics = make('div', 'training-week-metrics');
    const metric = (label, value, note) => {
      const card = make('div', 'training-metric');
      card.append(make('span', '', label), make('strong', '', value));
      if (note) card.append(make('small', '', note));
      return card;
    };
    const exportFtp = getWorkingFtp(manifest);
    const metricNotice = isConfirmed ? 'Подтверждён тестом' : (!fromManifest || manifest.current_ftp?.status === 'athlete_reported') ? 'Заявлен спортсменом' : 'По опубликованному плану';
    metrics.append(
      metric('Рабочий FTP', workingFtp ? `${workingFtp} Вт` : '—', metricNotice),
      metric('Цель FTP', targetFtp ? `${targetFtp} Вт` : '—', targetDate ? `к ${formatDate(targetDate)} ${parseDate(targetDate).getFullYear()}` : ''),
      metric('Целевой вес', targetWeight ? `${targetWeight} кг` : '—', exportFtp && exportFtp !== workingFtp ? `База экспорта ${exportFtp} Вт` : ''),
    );

    const current = Number(workingFtp);
    const target = Number(targetFtp);
    if (Number.isFinite(current) && current > 0 && Number.isFinite(target) && target > 0) {
      const ratio = Math.round(current / target * 100);
      const progress = make('section', 'ftp-target-visual');
      progress.setAttribute('aria-label', `Рабочий FTP ${current} Вт, цель ${target} Вт. Доля от цели ${ratio} процентов. ${metricNotice}.`);
      const heading = make('div', 'ftp-target-heading');
      const labels = make('div', 'ftp-target-labels');
      labels.append(make('span', '', 'ОРИЕНТИР'), make('strong', '', 'Путь к цели'));
      const value = make('div', 'ftp-target-value');
      value.append(make('b', '', `${current}`), make('span', '', ` / ${target} Вт`));
      heading.append(labels, value);
      const rail = make('div', 'ftp-target-rail');
      rail.setAttribute('aria-hidden', 'true');
      const fill = make('span', 'ftp-target-fill');
      fill.style.width = `${Math.max(0, Math.min(100, ratio))}%`;
      rail.append(fill);
      const details = make('div', 'ftp-target-details');
      details.append(make('span', '', `${metricNotice} · ${ratio}% от цели`), make('span', '', 'Цель 100%'));
      progress.append(heading, rail, details);
      metrics.append(progress);
    }
    return metrics;
  };

  const renderDashboard = manifest => {
    const dashboard = document.querySelector('[data-pane="now"]');
    if (!dashboard) return;
    dashboard.replaceChildren();

    const planBanner = make('div', 'active-plan-banner');
    planBanner.append(
      make('div', 'banner-pill', manifest.version_number ? `Календарь · версия ${manifest.version_number}` : 'Календарь не загружен'),
      make('p', 'banner-sub', 'Сверяю версию с TriCoach…'),
    );
    updateLivePlanBanner(planBanner, manifest.version_number);

    const insightCard = make('details', 'card training-service-status');
    const statusBar = make('div', 'mission-status-bar');
    const badge = make('p', 'safe-badge pending', 'Сверяю статус согласования…');
    badge.id = 'safety-gate-status-badge';
    insightCard.append(make('summary', '', 'Статус сервисов и согласования'), badge, statusBar);

    dashboard.append(renderWeekAtAGlance(manifest), renderProfileMetrics(manifest), planBanner, insightCard);
    updateLiveSystemStatus(statusBar);
  };

  // ── Mission Control Section 2: FTP 340 (Digital Twin) ────────────────────────

  const renderDigitalTwinPane = (pane, manifest) => {
    pane.replaceChildren();
    const {workingFtp, isConfirmed, targetFtp, targetDate, targetWeight} = manifest.profile;
    const targetWkg = targetFtp && targetWeight ? (targetFtp / targetWeight).toFixed(2) : null;
    const gap = workingFtp && targetFtp ? targetFtp - workingFtp : null;
    const workingFtpText = workingFtp ? `${workingFtp} Вт` : 'Нет данных';
    const targetFtpText = targetFtp ? `${targetFtp} Вт` : 'Нет данных';
    const targetDateText = targetDate ? formatDate(targetDate) : 'не указана';
    const goalNotes = [
      gap === null ? '' : `До цели ${Math.max(0, gap)} Вт`,
      targetWeight ? `Целевой вес ${targetWeight} кг` : '',
      targetWkg ? `${targetWkg} Вт/кг` : '',
    ].filter(Boolean).join(' · ');

    const header = make('div', 'dt-header');
    header.append(
      make('h2', '', 'FTP и профиль мощности'),
      make('p', 'sub', 'Контрольные тесты из календаря и персональные измерения Garmin.'),
    );

    // KPI Cards - No fictitious sports data
    const kpiGrid = make('div', 'metrics dt-kpis');
    kpiGrid.append(
      (() => {
        const c = make('article', 'metric');
        c.innerHTML = `<span>Текущий рабочий FTP</span><b>${workingFtpText}</b><small>${workingFtp ? (isConfirmed ? 'Подтверждён тестом' : 'Заявлен спортсменом') : 'Статус неизвестен'}</small>`;
        return c;
      })(),
      (() => {
        const c = make('article', 'metric');
        c.innerHTML = `<span>Цель · ${targetDateText}</span><b class="lime">${targetFtpText}</b><small>${goalNotes}</small>`;
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

    const trajectoryCard = make('article', 'card dt-chart-card');
    trajectoryCard.append(
      make('h3', '', 'Прогноз FTP'),
      make('p', 'dt-uncalibrated-notice', 'Недостаточно данных для прогноза. Для оценки адаптации нужна серия сопоставимых тестов.'),
    );

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
        <div class="mmp-item"><span class="mmp-dur">Рабочий FTP</span><b class="mmp-w" style="font-size:14px;color:var(--dim);">${workingFtpText}</b><span class="mmp-wkg">—</span></div>
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
    testsCard.append(make('h3', '', 'Контрольные тесты по календарю'));
    const tests = (manifest.weeks || []).flatMap(week => week.days || [])
      .filter(session => session.date >= localMoscowDate() && /^ТЕСТ(?:\s|$)/u.test(session.title || ''));
    if (tests.length) {
      const list = make('ul', 'test-milestones-list');
      for (const session of tests) {
        list.append(make('li', '', `${formatDate(session.date)} · ${session.title}`));
      }
      testsCard.append(list);
    } else {
      testsCard.append(make('p', '', 'В опубликованном календаре нет предстоящих контрольных тестов.'));
    }

    // Privacy-Protected Telemetry Box - Secure Authorization (No query token)
    const privacyBox = make('article', 'card telemetry-privacy-box');
    privacyBox.innerHTML = `
      <div class="privacy-header">
        <span class="lock-pill">🔒 Защищённый контур биометрии Garmin</span>
        <p>Конфиденциальные медицинские данные и восстановление доступны только владельцу. Получите временный PIN командой <b>/telemetry_pin</b> в Telegram; срок действия — 15 минут.</p>
      </div>
      <div class="privacy-inputs">
        <input type="password" id="telemetry-pin-input" aria-label="PIN из Telegram" placeholder="PIN из Telegram" class="ftpin" style="width:180px;padding:8px 12px;" />
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
    const {targetFtp, targetDate} = manifest.profile;
    const card = make('article', 'card coach-architecture-card');
    card.innerHTML = `
      <h2>Тренер Omni</h2>
      <div class="coach-principles">
        <div class="cp-item">
          <b>Разбор тренировки</b>
          <p>Пришли отчёт или попроси разобрать велотренировку из Garmin. Omni объяснит, что делать на следующей сессии.</p>
        </div>
        <div class="cp-item">
          <b>Адаптация программы</b>
          <p>Расскажи, как изменилось расписание. Omni подготовит черновик. Календарь обновится после твоего подтверждения в Telegram.</p>
        </div>
        <div class="cp-item">
          <b>Цель подготовки</b>
          <p>${targetFtp ? `FTP ${targetFtp} Вт` : 'Задаётся в TriCoach'}${targetDate ? ` к ${formatDate(targetDate)}` : ''}.</p>
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
    const brandName = make('span', 'brand-name', 'ВелоМощь');
    brandLeft.append(make('span', 'bolt', 'V'), brandName);
    const brandRight = make('div', 'brand-meta');
    const targetChip = make('span', 'date-chip');
    brandRight.append(targetChip);
    brand.append(brandLeft, brandRight);
    const tabs = make('nav', 'tabbar');
    tabs.setAttribute('aria-label', 'Разделы ВелоМощи');

    // 4 Key Mission Control tabs + guide
    const TAB_DEFS = [
      ['now', 'Неделя'],
      ['plan', 'Календарь'],
      ['ftp340', 'FTP'],
      ['coach', 'Omni'],
      ['guide', 'База знаний'],
    ];

    TAB_DEFS.forEach(([key, label], index) => {
      const button = make('button', 'tab', label);
      button.type = 'button';
      button.dataset.tab = key;
      if (index === 0) button.setAttribute('aria-current', 'page');
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

    const controlPane = make('div', 'training-reference');
    GROUPS.control.forEach(id => sections[id] && controlPane.append(sections[id]));

    const guidePane = make('div', 'pane');
    guidePane.dataset.pane = 'guide';
    GROUPS.guide.forEach(id => sections[id] && guidePane.append(sections[id]));

    const panes = {
      now: dashboard,
      ftp340: ftp340Pane,
      plan: planPane,
      coach: coachPane,
      guide: guidePane,
    };

    shell.after(dashboard, ftp340Pane, planPane, coachPane, guidePane);

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
      tabs.querySelectorAll('.tab').forEach(item => {
        if (item === tab) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
      if (tab.dataset.tab === 'plan') window.scrollTo({top: 0});
      else window.scrollTo({top: 0, behavior: 'smooth'});
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

    const liveStatus = loadMissionStatus();
    let manifest;
    try {
      const response = await fetch(`adaptive-plan.json?cache=${Date.now()}`, {cache: 'no-store', ...timeoutOptions(10000)});
      if (!response.ok) throw new Error('plan_unavailable');
      manifest = await response.json();
      if (!Array.isArray(manifest.weeks)) throw new Error('plan_invalid');
      calendarVersion = manifest.version_number;
    } catch (_error) {
      manifest = {weeks: [], version_number: null};
    }

    function drawProfile(status) {
      manifest.profile = profileFor(manifest, status?.target);
      const {targetFtp, targetDate} = manifest.profile;
      targetChip.textContent = targetFtp ? `FTP ${targetFtp} Вт${targetDate ? ` · ${formatDate(targetDate)}` : ''}` : '';
      targetChip.hidden = !targetFtp;
      renderDigitalTwinPane(ftp340Pane, manifest);
      ftp340Pane.append(controlPane);
      renderCoachPane(coachPane, manifest);
    }

    drawProfile(null);
    renderDashboard(manifest);
    renderPlan(manifest);
    renderMacro(manifest);
    const status = await liveStatus;
    if (status?.target) {
      drawProfile(status);
      dashboard.querySelector('.training-week-metrics').replaceWith(renderProfileMetrics(manifest));
    }
    renderCalculator(manifest);
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
