/* Public FTP340 board. Approved sessions are loaded only from adaptive-plan.json. */
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

  const sessionWattText = (text, ftp) => String(text || '').replace(
    /(\d{1,3})(?:\s*[–—-]\s*(\d{1,3}))?\s*%\s*(?:от\s*)?(?:FTP)?/gi,
    (_match, low, high) => {
      const start = Math.round(ftp * Number(low) / 100);
      const end = high ? Math.round(ftp * Number(high) / 100) : null;
      return `${low}${high ? `–${high}` : ''}% FTP (${start}${end ? `–${end}` : ''} Вт)`;
    },
  );

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
      if (session.main_set) content.append(make('p', 'session-main-set', sessionWattText(session.main_set, ftp)));
      if (session.key_numbers) content.append(make('p', 'session-key-numbers', sessionWattText(session.key_numbers, ftp)));
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

  const renderDashboard = manifest => {
    const dashboard = document.querySelector('[data-pane="now"]');
    if (!dashboard) return;
    dashboard.replaceChildren();
    const target = manifest.target || {ftp_watts: 340, date: '2027-06-06'};
    const ftp = manifest.current_ftp?.confirmed_watts || manifest.current_ftp?.reported_watts;
    const today = localMoscowDate();
    const next = (manifest.weeks || []).flatMap(week => week.days || [])
      .filter(day => day.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
    const hero = make('div', 'hero');
    const left = make('div');
    left.append(make('p', 'eyebrow', 'World-Class Cycling Coach'), make('h1', '', 'Набираем мощность без лишнего шума.'), make('p', 'hero-copy', `Цель программы: FTP ${target.ftp_watts} Вт к ${target.date}.`));
    const card = make('article', 'next-card');
    card.append(make('small', '', 'Следующая сессия из утверждённого плана'));
    if (next) {
      card.append(make('h2', '', next.title || 'Тренировка'));
      card.append(make('div', 'watts', formatDuration(next.duration_min)));
      card.append(make('p', '', `${formatDate(next.date)}${next.main_set ? ` · ${sessionWattText(next.main_set, Number(ftp || 0))}` : ''}`));
    } else {
      card.append(make('h2', '', 'План пока не синхронизирован'));
      card.append(make('p', '', 'Текущие тренировки появятся после получения утверждённой версии из TriCoach.'));
    }
    hero.append(left, card);
    const metrics = make('div', 'metrics');
    metrics.append(
      make('article', 'metric', `FTP ${ftp || '—'} Вт`),
      make('article', 'metric', `Версия ${manifest.version_number || '—'}`),
      make('article', 'metric', `${(manifest.weeks || []).length} недель`),
      make('article', 'metric', `Цель ${target.ftp_watts} Вт · ${target.date}`),
    );
    dashboard.append(hero, metrics);
  };

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
    [['now', 'Сейчас'], ['plan', 'План'], ['control', 'Контроль'], ['guide', 'База знаний']].forEach(([key, label], index) => {
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
    const panes = {now: dashboard};
    Object.entries(GROUPS).forEach(([key, ids]) => {
      const pane = make('div', 'pane');
      pane.dataset.pane = key;
      ids.forEach(id => sections[id] && pane.append(sections[id]));
      panes[key] = pane;
    });
    shell.after(dashboard, panes.plan, panes.control, panes.guide);

    const guideSections = [...panes.guide.querySelectorAll('section')];
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
      panes.guide.prepend(switcher);
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
          panes.guide.querySelectorAll('section').forEach(item => item.classList.toggle('show-guide', item === section));
          panes.guide.querySelectorAll('.guide-switch button').forEach((button, index) => {
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
    const week = [...document.querySelectorAll('details.week')].find(item => item.dataset.s <= today && today <= item.dataset.e);
    if (week) {
      document.querySelectorAll('details.week').forEach(item => item.classList.toggle('selected-week', item === week));
      week.open = true;
      week.scrollIntoView({behavior: 'smooth'});
    }
  };
  document.addEventListener('DOMContentLoaded', init);
})();
