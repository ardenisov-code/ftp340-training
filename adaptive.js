/* Public, privacy-filtered view of the currently approved TriCoach plan. */
(() => {
  const MOSCOW = 'Europe/Moscow';
  const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: MOSCOW });
  const isoToday = () => new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: MOSCOW,
  }).format(new Date());
  const esc = (value) => String(value ?? '');
  const durationText = (minutes) => {
    if (!Number.isFinite(minutes)) return '—';
    const hours = Math.floor(minutes / 60), mins = minutes % 60;
    return hours ? `${hours}:${String(mins).padStart(2, '0')}` : `${mins} мин`;
  };
  const localDate = (iso) => new Date(`${iso}T12:00:00Z`);
  const dateText = (iso) => dateFormat.format(localDate(iso)).replace(/\.$/, '');
  const rangeText = (start, end) => start === end ? dateText(start) : `${dateText(start)} – ${dateText(end)}`;
  const weekDates = (week) => week.days.map((day) => day.date).sort();
  const summaryCounts = (week) => {
    const minutes = { bike: 0, strength: 0, other: 0 }, counts = { bike: 0, strength: 0 };
    week.days.forEach((day) => {
      if (day.discipline === 'bike') { minutes.bike += day.duration_min || 0; counts.bike += 1; }
      else if (day.discipline === 'strength') { minutes.strength += day.duration_min || 0; counts.strength += 1; }
      else minutes.other += day.duration_min || 0;
    });
    const bike = Math.floor(minutes.bike / 60), rest = minutes.bike % 60;
    return `вело ${bike}:${String(rest).padStart(2, '0')} · силовых ${counts.strength}`;
  };
  const disciplinePresentation = (discipline) => ({
    bike: ['k-z2', 'ВЕЛО'], strength: ['k-str', 'СИЛОВАЯ'],
    recovery: ['k-rec', 'ВОССТ.'], rest: ['k-rest', 'ОТДЫХ'],
  }[discipline] || ['k-rec', 'ТРЕНИРОВКА']);

  function addText(parent, value) {
    parent.append(document.createTextNode(esc(value)));
  }

  function renderDay(session) {
    const day = document.createElement('div');
    day.className = 'day';
    day.dataset.sessionDate = session.date;
    if (session.completed) day.classList.add('session-completed');

    const stamp = document.createElement('div');
    stamp.className = 'dl2';
    const date = localDate(session.date);
    const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: MOSCOW }).format(date);
    const dayNumber = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', timeZone: MOSCOW }).format(date);
    stamp.append(document.createTextNode(`${weekday} ${dayNumber}`));
    const month = document.createElement('small');
    month.textContent = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: MOSCOW }).format(date).replace(/\.$/, '');
    stamp.append(month);

    const body = document.createElement('div');
    const heading = document.createElement('h4');
    const [tagClass, tagText] = disciplinePresentation(session.discipline);
    const tag = document.createElement('span');
    tag.className = `tag ${tagClass}`;
    tag.textContent = tagText;
    heading.append(tag, document.createTextNode(` ${esc(session.title)} · ${durationText(session.duration_min)}`));
    body.append(heading);

    if (session.goal) {
      const goal = document.createElement('div');
      goal.className = 'goal';
      goal.textContent = session.goal;
      body.append(goal);
    }
    const prescription = [session.main_set, session.key_numbers].filter(Boolean).join('\n');
    if (prescription) {
      const details = document.createElement('div');
      details.className = 'adaptive-main';
      details.textContent = prescription;
      body.append(details);
    }
    if (session.completed) {
      const status = document.createElement('div');
      status.className = 'adaptive-completed';
      status.textContent = 'Отмечено как выполненное';
      body.append(status);
    }
    day.append(stamp, body);
    return day;
  }

  function applyWeeks(manifest) {
    const detailsByNumber = new Map([...document.querySelectorAll('details.week')]
      .map((node) => [Number(node.id.replace(/^w/, '')), node]));
    manifest.weeks.forEach((week) => {
      const details = detailsByNumber.get(Number(week.week_number));
      if (!details || !week.days.length) return;
      const dates = weekDates(week), summary = details.querySelector('summary');
      details.dataset.s = dates[0];
      details.dataset.e = dates[dates.length - 1];
      summary?.querySelector('.wn') && (summary.querySelector('.wn').textContent = `Неделя ${week.week_number}`);
      summary?.querySelector('.wd') && (summary.querySelector('.wd').textContent = rangeText(dates[0], dates[dates.length - 1]));
      summary?.querySelector('.tag') && (summary.querySelector('.tag').textContent = week.block || 'План');
      summary?.querySelector('.wf') && (summary.querySelector('.wf').textContent = week.block_rationale || 'Утверждённая неделя программы.');
      summary?.querySelector('.wh') && (summary.querySelector('.wh').textContent = summaryCounts(week));
      details.querySelectorAll('.day').forEach((node) => node.remove());
      week.days.forEach((session) => details.append(renderDay(session)));
    });
    document.querySelectorAll('.plan-tools select option').forEach((option) => {
      const details = document.getElementById(option.value);
      const summary = details?.querySelector('summary');
      if (summary) option.textContent = `${summary.querySelector('.wn')?.textContent || ''} · ${summary.querySelector('.wd')?.textContent || ''}`;
    });
  }

  function applyDashboard(manifest) {
    const today = isoToday();
    const sessions = manifest.weeks.flatMap((week) => week.days);
    const next = sessions.find((session) => session.date === today) || sessions.find((session) => session.date > today);
    const todayTitle = document.querySelector('[data-today-title]');
    const todayDuration = document.querySelector('[data-today-duration]');
    const todayDetail = document.querySelector('[data-today-detail]');
    if (todayTitle) todayTitle.textContent = next ? next.title : 'Нет запланированной сессии';
    if (todayDuration) todayDuration.textContent = next ? durationText(next.duration_min) : '—';
    if (todayDetail) todayDetail.textContent = next
      ? [next.date === today ? 'Сегодня' : `Следующая сессия · ${dateText(next.date)}`, next.key_numbers || next.main_set].filter(Boolean).join('\n')
      : 'Программа завершена.';

    const current = manifest.current_ftp || {};
    const ftpNode = document.querySelector('[data-current-ftp]');
    if (ftpNode) {
      ftpNode.textContent = current.confirmed_watts ? `${current.confirmed_watts} Вт` :
        (current.reported_watts ? `${current.reported_watts} Вт` : 'Не подтверждён');
      const label = ftpNode.closest('.metric')?.querySelector('span');
      if (label) label.textContent = current.confirmed_watts
        ? `подтверждён · тест ${current.confirmed_test_date || 'дата не указана'}`
        : (current.reported_watts ? 'заявлен спортсменом · тест не подтверждён' : 'нужен FTP-тест');
    }
    const version = document.querySelector('[data-plan-version]');
    if (version) version.textContent = `v${manifest.version_number}`;
    const completed = manifest.completed_session_dates || [];
    const completedCount = document.querySelector('[data-completed-count]');
    if (completedCount) completedCount.textContent = String(completed.length);

    const history = document.querySelector('[data-test-history]');
    if (history) {
      history.replaceChildren();
      const tests = manifest.confirmed_ftp_tests || [];
      if (!tests.length) {
        history.textContent = 'Подтверждённых тестов пока нет. Измеренная траектория появится после внесения результатов; прогноз не подменяет FTP.';
      } else {
        const list = document.createElement('ul');
        tests.forEach((item, index) => {
          const li = document.createElement('li');
          li.textContent = `${item.test_date}: ${item.ftp_watts} Вт`;
          if (index > 0) {
            const delta = item.ftp_watts - tests[index - 1].ftp_watts;
            li.textContent += ` · ${delta > 0 ? '+' : ''}${delta} Вт к предыдущему тесту`;
          }
          list.append(li);
        });
        history.append(list);
      }
    }
    const sync = document.querySelector('[data-sync-note]');
    if (sync) sync.textContent = `Версия v${manifest.version_number} · синхронизировано ${manifest.updated_at}. Изменения опубликованы после подтверждения спортсмена.`;
    const chip = document.querySelector('.date-chip');
    if (chip) chip.textContent = `План · v${manifest.version_number} · ${manifest.updated_at}`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const response = await fetch(`adaptive-plan.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('plan unavailable');
      const manifest = await response.json();
      if (manifest.target?.ftp_watts !== 340 || manifest.target?.date !== '2027-06-06' || !Array.isArray(manifest.weeks)) {
        throw new Error('invalid plan manifest');
      }
      applyWeeks(manifest);
      applyDashboard(manifest);
    } catch (_) {
      const note = document.querySelector('[data-sync-note]');
      if (note) note.textContent = 'Не удалось загрузить актуальную версию плана. Проверьте сетевое соединение и обновите страницу.';
    }
  });
})();
