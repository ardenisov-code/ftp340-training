(() => {
  const MONTHS = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const ZONES = [
    {n:'Z1 · восстановление', lo:0, hi:55, tone:'#94A3B8', rpe:'1–2'},
    {n:'Z2 · выносливость', lo:56, hi:75, tone:'#3E7BFA', rpe:'3–4'},
    {n:'Темп (Z3)', lo:76, hi:87, tone:'#2BA8A0', rpe:'5'},
    {n:'Sweet spot', lo:88, hi:94, tone:'#8B6CF7', rpe:'6–7'},
    {n:'Порог (Z4)', lo:95, hi:105, tone:'#FF6A4D', rpe:'7–8'},
    {n:'VO₂max (Z5)', lo:106, hi:120, tone:'#E4A11B', rpe:'8–9'},
    {n:'Анаэробная (Z6)', lo:121, hi:150, tone:'#D946A6', rpe:'9–10'},
    {n:'Нейромышечная (Z7)', lo:151, hi:200, tone:'#111820', rpe:'10'},
  ];
  const ICON = {
    bike:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17 9 8h4l3 9M9 8h6"/></svg>',
    strength:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12"/></svg>',
    rest:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M20 14.5A8 8 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
    test:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/><path d="M7.5 15h9"/></svg>',
  };
  const pick = (arr, seed) => arr[seed % arr.length];
  const parseDate = value => {
    const [y,m,d] = String(value || '').split('-').map(Number);
    return y && m && d ? new Date(y, m-1, d, 12) : null;
  };
  const fmtDate = value => { const d = parseDate(value); return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : ''; };
  const fmtFull = value => { const d = parseDate(value); return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : ''; };
  const daysBetween = (a,b) => Math.max(0, Math.round((b-a)/86400000));
  const moscowToday = () => {
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get = t => parts.find(p=>p.type===t)?.value;
    return new Date(`${get('year')}-${get('month')}-${get('day')}T12:00:00`);
  };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const num = n => new Intl.NumberFormat('ru-RU').format(Math.round(Number(n)||0));

  const state = { manifest:null, weeks:[], currentWeek:1, today:iso(moscowToday()) };
  const getWorkingFtp = () => {
    const value = Number(state.manifest?.current_ftp?.reported_watts ?? state.manifest?.current_ftp?.confirmed_watts);
    return Number.isInteger(value) && value >= 100 && value <= 600 ? value : 280;
  };

  const blockName = raw => {
    let s = String(raw || '');
    const colon = s.indexOf(':');
    if (colon >= 0) s = s.slice(colon + 1);
    s = s.replace(/^\s*Неделя\s*\d+\s*[:\-–]?\s*/i, '');
    s = s.replace(/^Блок\s*\d+\s*·?\s*/i, '');
    s = s.replace(/\s*\(Разгрузка\)\s*/i, '').trim();
    return s || 'Блок';
  };

  const cleanTitle = value => String(value || '')
    .replace(/^(ВЕЛО|Вело|СИЛА|Сила|ОТДЫХ|Отдых|ВОССТ\.|Восст\.)\s*(?:[·:—–-]\s*)?/i, '')
    .trim();
  const displayTitle = value => {
    const title = cleanTitle(value);
    return title ? title.charAt(0).toUpperCase() + title.slice(1) : title;
  };

  const plural = (n, forms) => {
    const abs = Math.abs(Number(n) || 0) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (last === 1) return forms[0];
    if (last >= 2 && last <= 4) return forms[1];
    return forms[2];
  };

  const kindOf = day => {
    const d = String(day?.discipline || '').toLowerCase();
    if (d === 'bike') return {k:'bike', label:'Вело', icon:ICON.bike};
    if (d === 'strength') return {k:'strength', label:'Силовая', icon:ICON.strength};
    if (d === 'rest') return {k:'rest', label:'Отдых', icon:ICON.rest};
    return {k:'rest', label:'Восстановление', icon:ICON.rest};
  };
  const isTest = day => /ТЕСТ|TTE|P40|3′|3'/.test(`${day?.title||''} ${day?.goal||''}`);

  function renderHero(m) {
    const now = Number(m.current_ftp?.reported_watts ?? m.current_ftp?.confirmed_watts) || 0;
    const target = Number(m.target?.ftp_watts) || 0;
    const targetDate = parseDate(m.target?.date);
    const start = Number(m.weeks?.find(w=>w.week_number>0)?.days?.find(d=>Number(d.source_reference_ftp_watts))?.source_reference_ftp_watts) || now;
    const pct = target ? Math.min(100, Math.round(now / target * 100)) : 0;
    const circumference = 2 * Math.PI * 104;
    document.getElementById('version').textContent = m.version_number ?? '—';
    document.getElementById('target-date').textContent = targetDate ? `Цель · ${fmtFull(m.target.date)}` : 'Цель —';
    document.getElementById('target-wkg').textContent = m.target?.target_w_kg ? `${m.target.target_w_kg} Вт/кг` : '—';
    document.getElementById('weeks-count').textContent = `${m.weeks.length} недель`;
    document.getElementById('goal-date-short').textContent = targetDate ? `дедлайн ${fmtDate(m.target.date)} ${targetDate.getFullYear()}` : '';
    document.getElementById('ftp-now').textContent = num(now);
    document.getElementById('ftp-start').textContent = `${num(start)} Вт`;
    document.getElementById('ftp-target').textContent = `${num(target)} Вт`;
    document.getElementById('progress-pct').textContent = `${pct}%`;
    const daysLeft = targetDate ? daysBetween(moscowToday(), targetDate) : 0;
    document.getElementById('days-left').textContent = targetDate ? num(daysLeft) : '—';
    document.getElementById('days-left-word').textContent = targetDate ? plural(daysLeft, ['день','дня','дней']) : '';
    document.getElementById('gain').textContent = num(Math.max(0, target-now));
    const weeksLeft = Math.max(1, (m.weeks || []).filter(w => w.week_number >= state.currentWeek).length);
    document.getElementById('per-week').textContent = ((target-now)/weeksLeft).toFixed(1).replace('.', ',');
    const ring = document.getElementById('ring');
    ring.style.strokeDasharray = String(circumference);
    ring.style.strokeDashoffset = String(circumference);
    requestAnimationFrame(() => { ring.style.strokeDashoffset = String(circumference * (1 - pct/100)); });
    document.getElementById('kpi-ftp').textContent = num(now);
    document.getElementById('kpi-ftp-sub').textContent = m.current_ftp?.confirmed_watts ? 'Подтверждён тестом' : 'Заявлен спортсменом';
    document.getElementById('kpi-target').textContent = num(target);
    document.getElementById('kpi-target-sub').textContent = m.target?.target_w_kg ? `${m.target.target_w_kg} Вт/кг при ${m.target.target_weight_kg} кг` : '—';
    document.getElementById('kpi-days').textContent = targetDate ? num(daysBetween(moscowToday(), targetDate)) : '—';
    document.getElementById('kpi-days-word').textContent = targetDate ? plural(daysBetween(moscowToday(), targetDate), ['день','дня','дней']) : '';
    document.getElementById('kpi-days-sub').textContent = targetDate ? `до ${fmtFull(m.target.date)}` : '—';
    const done = new Set(m.completed_session_dates || []);
    const total = (m.weeks||[]).reduce((a,w)=>a+(w.days||[]).filter(d=>d.discipline!=='rest').length,0);
    document.getElementById('kpi-done').textContent = num(done.size);
    document.getElementById('kpi-total').textContent = num(total);
    document.getElementById('kpi-done-sub').textContent = total ? `${Math.round(done.size/total*100)}% плана отмечено` : '—';
  }

  function findTodayWeek() {
    for (const w of state.weeks) {
      if ((w.days||[]).some(d => d.date === state.today)) return w.week_number;
    }
    const future = state.weeks.find(w => (w.days||[]).some(d => d.date >= state.today));
    return future?.week_number ?? state.weeks[0]?.week_number ?? 0;
  }

  function renderToday() {
    const week = state.weeks.find(w=>w.week_number===state.currentWeek) || state.weeks[0];
    const days = week?.days || [];
    const day = days.find(d=>d.date===state.today) || days.find(d=>d.date>=state.today) || days[0];
    if (!day) return;
    const kind = kindOf(day);
    const d = parseDate(day.date);
    document.getElementById('today-dd').textContent = d ? d.getDate() : '—';
    document.getElementById('today-mm').textContent = d ? MONTHS[d.getMonth()] : '';
    document.getElementById('today-kind').textContent = `${kind.label}${isTest(day)?' · тест':''}`;
    document.getElementById('today-title').textContent = displayTitle(day.title) || 'Сессия';
    document.getElementById('today-meta').innerHTML = [
      `<span class="chip">${kind.icon}${kind.label}</span>`,
      day.duration_min ? `<span class="chip">${day.duration_min} мин</span>` : '',
      day.key_numbers ? `<span class="chip">${esc(day.key_numbers.length>46?day.key_numbers.slice(0,46)+'…':day.key_numbers)}</span>` : '',
      isTest(day) ? `<span class="chip" style="color:#B5361E;background:rgba(255,106,77,.12)">контрольный</span>` : '',
    ].join('');
    document.getElementById('today-lead').textContent = day.goal || day.main_set || 'Детали — в карточке сессии.';
    const steps = day.export_steps || [];
    const bars = [];
    if (steps.length) {
      const max = Math.max(...steps.map(s=>s.duration_sec||0),1);
      steps.forEach(s => bars.push(`<i style="height:${Math.max(14, Math.round((s.duration_sec||0)/max*46))}px" title="${esc(s.name||'')}"></i>`));
    } else {
      const firstMin = text => {
        const match = String(text || '').match(/(\d+)\s*(?:['′]|мин)/);
        return match ? Number(match[1]) : 0;
      };
      const segments = [
        {minutes: firstMin(day.warmup), opacity: .42, label: 'Разминка'},
        {minutes: firstMin(day.main_set), opacity: 1, label: 'Основная работа'},
        {minutes: firstMin(day.cooldown), opacity: .42, label: 'Заминка'},
      ].filter(segment => segment.minutes > 0);
      if (segments.length) {
        bars.push(...segments.map(segment =>
          `<i style="flex:${segment.minutes};height:46px;opacity:${segment.opacity}" title="${segment.label} · ${segment.minutes} мин"></i>`
        ));
      } else {
        bars.push(`<i style="height:46px;opacity:.55" title="${esc(day.duration_min ? `${day.duration_min} мин` : 'Сессия')}"></i>`);
      }
    }
    document.getElementById('today-bars').innerHTML = bars.join('');
    const rhythm = days.map(x=>{
      const k = kindOf(x);
      return `<span class="${k.k}" title="${esc(x.title||'')}">${DAYS[(parseDate(x.date)?.getDay()+6)%7]||''}</span>`;
    }).join('');
    document.getElementById('today-rhythm').innerHTML = rhythm;
    const volume = days.reduce((a,x)=>a+(Number(x.duration_min)||0),0);
    document.getElementById('week-volume').textContent = volume ? `${Math.floor(volume/60)} ч ${volume%60} мин` : '—';
    const keys = days.filter(x=>isTest(x) || /порог|vo2|vo₂|sweet|30\/15|сила/i.test(x.title||'')).length;
    document.getElementById('week-key').textContent = keys || '—';
    const idx = days.findIndex(x=>x.date===state.today);
    document.getElementById('week-left').textContent = idx>=0 ? `${days.length-idx-1} дн.` : '—';
    document.getElementById('today-open').onclick = () => openDay(day);
    document.getElementById('today-week').onclick = () => { setWeek(week.week_number); document.getElementById('plan').scrollIntoView({behavior:'smooth'}); };
  }

  const blockGroup = week => {
    const match = String(week?.block || '').match(/Блок\s*(\d+)/i);
    return match ? `block-${match[1]}` : 'start';
  };
  const blockTitle = week => {
    let title = blockName(week?.block);
    title = title.replace(/\s*\(−45%\)\s*/g, '').trim();
    if (/тейпер/i.test(title)) return 'Тейпер и финал';
    if (/вводн/i.test(title)) return 'Старт и вкатка';
    return title;
  };

  function renderRoadmap() {
    const groups = [];
    for (const week of state.weeks) {
      const key = blockGroup(week);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.weeks.push(week);
      else groups.push({key, weeks:[week], title: blockTitle(week)});
    }
    const totalWeeks = state.weeks.length || 1;
    const colors = ['#111820','#3E7BFA','#8B6CF7','#2BA8A0','#FF6A4D','#E4A11B','#69951D'];
    const grid = document.getElementById('roadmap-grid');
    grid.innerHTML = groups.map((group, index) => {
      const start = group.weeks[0].week_number;
      const end = group.weeks[group.weeks.length - 1].week_number;
      const isCurrent = state.currentWeek >= start && state.currentWeek <= end;
      const tests = group.weeks.reduce((sum, week) => sum + (week.days || []).filter(isTest).length, 0);
      const deloads = group.weeks.filter(week => /разгруз/i.test(week.block || '')).length;
      const load = group.weeks.reduce((sum, week) => sum + (week.days || []).reduce((acc, day) => acc + (Number(day.duration_min) || 0), 0), 0);
      const meta = [`${group.weeks.length} нед.`, `${Math.max(1, Math.round(load / 60))} ч`];
      if (tests) meta.push(`${tests} тест${tests === 1 ? '' : tests < 5 ? 'а' : 'ов'}`);
      if (deloads) meta.push(`${deloads} разгр.`);
      return `<article class="phase ${isCurrent ? 'is-current' : ''}" data-week="${start}" style="--c:${pick(colors, index)}" role="button" tabindex="0">
        <div class="wk">${start === end ? `неделя ${start}` : `недели ${start}–${end}`}</div>
        <h4>${esc(group.title)}</h4>
        <div class="meta">${meta.join(' · ')}</div>
        <div class="bar"><i style="width:${Math.round(group.weeks.length / totalWeeks * 100)}%;background:${pick(colors, index)}"></i></div>
      </article>`;
    }).join('');
    grid.querySelectorAll('.phase').forEach(card => {
      const go = () => {
        setWeek(Number(card.dataset.week));
        document.getElementById('plan').scrollIntoView({behavior:'smooth'});
      };
      card.onclick = go;
      card.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } };
    });
  }

  function renderWeekRail() {
    const rail = document.getElementById('week-rail');
    const done = new Set(state.manifest?.completed_session_dates || []);
    const tests = new Set();
    state.weeks.forEach(w => (w.days||[]).forEach(d=>{ if(isTest(d)) tests.add(w.week_number); }));
    rail.innerHTML = state.weeks.map(w=>{
      const cls = [w.week_number===state.currentWeek?'active':'', (w.days||[]).some(d=>done.has(d.date))?'done':'', tests.has(w.week_number)?'test':''].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-week="${w.week_number}" aria-label="Неделя ${w.week_number}">${w.week_number}</button>`;
    }).join('');
    rail.querySelectorAll('button').forEach(b=>b.onclick=()=>setWeek(Number(b.dataset.week)));
  }

  function renderWeek() {
    const week = state.weeks.find(w=>w.week_number===state.currentWeek) || state.weeks[0];
    document.getElementById('week-num').textContent = `Неделя ${week.week_number}`;
    document.getElementById('week-block').textContent = blockName(week.block);
    const days = week.days || [];
    const counts = {bike:0,strength:0,rest:0};
    days.forEach(d=>counts[kindOf(d).k]++);
    const volume = days.reduce((a,d)=>a+(Number(d.duration_min)||0),0);
    document.getElementById('week-summary').innerHTML = [
      `<span class="chip">${counts.bike} вело</span>`,
      `<span class="chip">${counts.strength} силовые</span>`,
      `<span class="chip">${counts.rest} отдых</span>`,
      `<span class="chip">${volume?`${Math.floor(volume/60)} ч ${volume%60} мин`:'—'}</span>`,
      `<span class="chip">${esc(week.block_rationale||'')}</span>`,
    ].join('');
    document.getElementById('day-grid').innerHTML = days.map(d=>{
      const k = kindOf(d);
      const date = parseDate(d.date);
      const dow = date ? DAYS[(date.getDay()+6)%7] : '';
      const done = (state.manifest?.completed_session_dates||[]).includes(d.date);
      const cls = [k.k, isTest(d)?'test':'', done?'completed':'', d.date===state.today?'today':''].filter(Boolean).join(' ');
      return `<button type="button" class="day ${cls}" data-date="${d.date}">
        <div class="dow"><span>${dow}</span><span class="dd">${date?date.getDate():''}</span></div>
        <div class="dico">${k.icon}</div>
        <div class="dtitle">${esc(displayTitle(d.title) || 'Сессия')}</div>
        <div class="ddur">${d.duration_min?`${d.duration_min} мин`:'—'}</div>
      </button>`;
    }).join('');
    document.getElementById('day-grid').querySelectorAll('.day').forEach(el=>{
      const day = days.find(d=>d.date===el.dataset.date);
      el.onclick = () => openDay(day);
    });
  }

  async function exportWorkout(day, format, button, status) {
    const ftp = Number(day.source_reference_ftp_watts) || getWorkingFtp();
    const endpoint = new URL(`https://tricoach-garmin.onrender.com/api/workouts/${day.date}.${format}`);
    endpoint.searchParams.set('ftp', ftp);
    if (state.manifest?.version_number) endpoint.searchParams.set('version', state.manifest.version_number);
    button.disabled = true;
    status.textContent = `Готовлю ${format.toUpperCase()}…`;
    status.classList.remove('bad');
    try {
      const response = await fetch(endpoint, {signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined});
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(response.status === 422 ? (error.detail || 'Недостаточно точных интервалов для экспорта.') : 'Экспорт временно недоступен.');
      }
      const file = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = file;
      link.download = `TriCoach_${day.date}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(file), 30000);
      status.textContent = `Скачивание ${format.toUpperCase()} началось.`;
    } catch (err) {
      status.classList.add('bad');
      status.textContent = `Не удалось скачать ${format.toUpperCase()}. ${err.message || ''}`.trim();
    } finally {
      button.disabled = false;
    }
  }

  function openDay(day) {
    if (!day) return;
    const k = kindOf(day);
    const d = parseDate(day.date);
    const dow = d ? DAYS[(d.getDay()+6)%7] : '';
    document.getElementById('modal-title').textContent = displayTitle(day.title) || 'Сессия';
    document.getElementById('modal-sub').textContent = `${dow}, ${fmtFull(day.date)} · ${k.label}${day.duration_min?` · ${day.duration_min} мин`:''}`;
    const blocks = [];
    if (day.goal) blocks.push(`<div class="modal-block"><div class="k">Цель</div><p>${esc(day.goal)}</p></div>`);
    if (day.warmup) blocks.push(`<div class="modal-block"><div class="k">Разминка</div><p>${esc(day.warmup)}</p></div>`);
    if (day.main_set) blocks.push(`<div class="modal-block"><div class="k">Основная работа</div><p>${esc(day.main_set)}</p></div>`);
    if (day.cooldown) blocks.push(`<div class="modal-block"><div class="k">Заминка</div><p>${esc(day.cooldown)}</p></div>`);
    if (day.key_numbers) blocks.push(`<div class="modal-block"><div class="k">Ключевые цифры</div><p>${esc(day.key_numbers)}</p></div>`);
    if (day.cadence) blocks.push(`<div class="modal-block"><div class="k">Каденс</div><p>${esc(day.cadence)}</p></div>`);
    if (day.quality_criteria) blocks.push(`<div class="modal-block"><div class="k">Критерий качества</div><p>${esc(day.quality_criteria)}</p></div>`);
    if (day.discipline === 'bike') {
      blocks.push(`<div class="modal-export">
        <div class="k">Экспорт тренировки</div>
        <div class="modal-export-actions">
          <button class="btn btn-dark" type="button" data-format="zwo">ZWO · MyWhoosh</button>
          <button class="btn btn-ghost" type="button" data-format="fit">FIT · Garmin</button>
        </div>
        <div class="modal-export-status" role="status"></div>
      </div>`);
    }
    document.getElementById('modal-body').innerHTML = blocks.join('');
    const exportStatus = document.querySelector('.modal-export-status');
    document.querySelectorAll('.modal-export [data-format]').forEach(button => {
      button.onclick = () => exportWorkout(day, button.dataset.format, button, exportStatus);
    });
    document.getElementById('day-modal').showModal();
  }

  function renderAnalytics() {
    const all = state.weeks.flatMap(w=>w.days||[]);
    const counts = {bike:0,strength:0,rest:0};
    all.forEach(d=>counts[kindOf(d).k]++);
    const total = all.length || 1;
    const bikeDeg = counts.bike/total*100;
    const strDeg = bikeDeg + counts.strength/total*100;
    const donut = document.getElementById('donut');
    donut.style.setProperty('--bike-deg', `${bikeDeg}%`);
    donut.style.setProperty('--strength-deg', `${strDeg}%`);
    document.getElementById('donut-total').textContent = all.length;
    document.getElementById('legend').innerHTML = [
      ['#3E7BFA','Вело',counts.bike],['#8B6CF7','Силовая',counts.strength],['rgba(17,24,32,.18)','Отдых',counts.rest]
    ].map(([c,n,v])=>`<div><i style="background:${c}"></i>${n}<span class="n">${v}</span></div>`).join('');
    const maxLoad = Math.max(...state.weeks.map(w=>w.days.reduce((a,d)=>a+(Number(d.duration_min)||0),0)),1);
    document.getElementById('load-bars').innerHTML = state.weeks.map(w=>{
      const load = w.days.reduce((a,d)=>a+(Number(d.duration_min)||0),0);
      const dl = /разгруз/i.test(w.block);
      const test = w.days.some(isTest);
      return `<i class="${dl?'deload':test?'test':''}" style="height:${Math.max(5,Math.round(load/maxLoad*150))}px" title="Неделя ${w.week_number}: ${load} мин"></i>`;
    }).join('');
    document.getElementById('bar-axis-mid').textContent = `нед. ${Math.round(state.weeks.length/2)}`;
    document.getElementById('bar-axis-end').textContent = `нед. ${state.weeks[state.weeks.length-1].week_number}`;
    const done = new Set(state.manifest?.completed_session_dates||[]);
    document.getElementById('heat').innerHTML = state.weeks.map(w=>w.days.map(d=>{
      const k = kindOf(d).k;
      const t = isTest(d)?'test':'';
      const dn = done.has(d.date)?'done':'';
      return `<i class="${k} ${t} ${dn}" title="${fmtDate(d.date)} · ${esc(d.title||'')}"></i>`;
    }).join('')).join('');
  }

  function renderTests() {
    const tests = [];
    state.weeks.forEach(w=>(w.days||[]).forEach(d=>{
      if (/ТЕСТ|Контроль/i.test(d.title||'') && d.date >= state.today) tests.push(d);
    }));
    const weekOf = day => state.weeks.find(w => (w.days || []).includes(day))?.week_number;
    const whenOf = day => day ? `${fmtDate(day.date)} · неделя ${weekOf(day)}` : 'в плане';
    const grid = document.getElementById('test-grid');
    const card = (cls, tag, title, desc, formula, when) => `<article class="test-card ${cls}">
      <div class="tag">${tag}</div><h3>${title}</h3><p>${desc}</p>
      <div class="formula">${formula}</div><div class="when">${when}</div></article>`;
    const hasT312 = tests.some(d => /3′|3'/.test(d.title || ''));
    const p20 = tests.filter(d => /P20/i.test(d.title || ''));

    if (hasT312 && grid) {
      const t312 = tests.find(d => /3′|3'/.test(d.title || ''));
      const p40 = tests.find(d => /P40/.test(d.title || ''));
      const tte = tests.find(d => /TTE/.test(d.title || ''));
      grid.innerHTML = [
        card('t312', 'Главный тест', '3′ + 12′ в один день',
          'Короткий all-out на CP и 12 минут на FTP. Один день, два показателя, минимум усталости.',
          'FTP = 0.90 × P12<br>CP = (P12×12 − P3×3) / 9', whenOf(t312)),
        card('p40', 'Выносливость', 'P40 · 40 минут',
          'Пороговая выносливость: способность держать мощность, когда заканчивается свежесть.',
          'Средняя за 40′ · сравнение с FTP', whenOf(p40)),
        card('tte', 'Точка отказа', 'TTE · до отказа',
          'Непрерывное удержание ~95% FTP. Показывает реальную длительность пороговой работы.',
          'Время до падения мощности &lt; 95%', whenOf(tte)),
      ].join('');
    } else if (!hasT312 && p20.length && grid) {
      const picks = [p20[0], p20[Math.floor((p20.length - 1) / 2)], p20[p20.length - 1]]
        .filter((day, index, list) => day && list.indexOf(day) === index);
      const roles = ['Промежуточный контроль', 'Контроль формы', 'Финальный контроль'];
      grid.innerHTML = picks.map((day, index) => card(
        index === picks.length - 1 ? 'tte' : 'p40',
        roles[index] || 'Контроль',
        'P20 · 20 минут',
        index === picks.length - 1
          ? 'Финальная проверка: удержание мощности в ровном темпе перед целевой датой.'
          : 'Пороговый тест в контролируемых условиях: показывает, какую мощность держишь сейчас.',
        'FTP = 0.95 × P20',
        whenOf(day),
      )).join('');
    }

    const next = tests[0];
    const nextLabel = next
      ? (/3′|3'/.test(next.title || '') ? '3′+12′'
        : /P20/i.test(next.title || '') ? 'P20'
        : /P40/.test(next.title || '') ? 'P40'
        : /TTE/.test(next.title || '') ? 'TTE'
        : cleanTitle(next.title).slice(0, 24))
      : '';
    document.getElementById('next-test').textContent = next ? `${fmtDate(next.date)} · ${nextLabel}` : '—';
  }

  function renderCalculator() {
    const input = document.getElementById('ftp-input');
    const body = document.getElementById('zone-body');
    const source = Number(state.manifest?.current_ftp?.reported_watts) || 290;
    const stored = Number(localStorage.getItem('ftp340_public_calc') || 0);
    const initial = Number.isInteger(stored) && stored >= 100 && stored <= 600 ? stored : source;
    input.value = initial;
    input.style.cssText += ';background:#fff !important;color:#111820 !important;-webkit-text-fill-color:#111820 !important;';
    const draw = ftp => {
      const v = Number.isInteger(ftp) && ftp>=100 && ftp<=600 ? ftp : source;
      body.innerHTML = ZONES.map(z=>{
        const lo = Math.round(v*z.lo/100), hi = Math.round(v*z.hi/100);
        return `<tr><td>${z.n}</td><td class="muted">${z.lo}–${z.hi}%</td><td class="power">${lo}–${hi} Вт</td><td><div class="zone-bar"><i style="width:${Math.min(100,z.hi/2)}%;background:${z.tone}"></i></div></td></tr>`;
      }).join('');
    };
    input.oninput = () => {
      const value = Number(input.value);
      if (Number.isInteger(value) && value >= 100 && value <= 600) {
        localStorage.setItem('ftp340_public_calc', String(value));
        draw(value);
      } else if (!input.value) {
        localStorage.removeItem('ftp340_public_calc');
        draw(source);
      }
    };
    document.getElementById('ftp-reset').onclick = () => {
      localStorage.removeItem('ftp340_public_calc');
      input.value = source;
      draw(source);
    };
    draw(initial);
  }

  function setWeek(n) {
    state.currentWeek = n;
    renderWeekRail();
    renderWeek();
    renderToday();
    renderTests();
    renderRoadmap();
  }

  function initReveal() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) { els.forEach(e=>e.classList.add('in')); return; }
    const io = new IntersectionObserver(entries=>{
      entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } });
    },{threshold:.08});
    els.forEach(e=>io.observe(e));
  }

  async function unlockTelemetry() {
    const input = document.getElementById('telemetry-pin');
    const button = document.getElementById('telemetry-unlock');
    const display = document.getElementById('telemetry-display');
    if (!input || !button || !display) return;
    const pin = input.value.trim();
    input.value = '';
    if (!pin) return;
    button.disabled = true;
    button.textContent = 'Проверяю…';
    display.hidden = false;
    try {
      const response = await fetch('https://tricoach-garmin.onrender.com/api/mission-control/telemetry', {
        headers: {Authorization: `Bearer ${pin}`},
      });
      if (response.status === 429) {
        display.innerHTML = '<span class="bad">✕ Слишком много неверных попыток. Доступ заблокирован на 15 минут.</span>';
        button.textContent = 'Заблокировано';
        return;
      }
      if (!response.ok) throw new Error('unauthorized');
      const data = await response.json();
      display.innerHTML = `
        <div class="ok">✓ Защищённая сессия активна</div>
        <p>Синхронизированных тренировок: <b>${data.recent_executions?.length || 0}</b></p>
        <p>Отчётов Power Forensics: <b>${data.recent_forensics?.length || 0}</b></p>`;
      button.textContent = 'Доступ открыт';
      const twin = await fetch('https://tricoach-garmin.onrender.com/api/digital-twin', {
        headers: {Authorization: `Bearer ${pin}`}, cache: 'no-store',
      }).then(response => response.ok ? response.json() : null).catch(() => null);
      const measured = (twin?.power_duration_curve || []).filter(point => point.source === 'measured');
      if (measured.length) {
        display.insertAdjacentHTML('beforeend', '<h4>Измеренные максимумы мощности</h4><ul>' +
          measured.map(point => `<li>${point.duration_sec} с · ${Math.round(point.watts)} Вт</li>`).join('') + '</ul>');
      }
    } catch (_error) {
      display.innerHTML = '<span class="bad">✕ PIN неверный или истёк. Получи новый командой /telemetry_pin.</span>';
      button.textContent = 'Открыть';
    } finally {
      button.disabled = false;
    }
  }

  async function updateLiveStatus() {
    const pill = document.getElementById('live-status');
    if (!pill) return;
    try {
      const response = await fetch('https://tricoach-garmin.onrender.com/api/mission-control/status', {cache: 'no-store'});
      const data = await response.json();
      const ok = String(data.status || '').toLowerCase() === 'operational';
      pill.className = `status-pill ${ok ? 'ok' : 'bad'}`;
      pill.innerHTML = `<i></i> ${ok ? 'система в норме' : 'требует внимания'}`;
    } catch (_error) {
      pill.className = 'status-pill';
      pill.innerHTML = '<i></i> статус недоступен';
    }
  }

  async function init() {
    const embedded = document.getElementById('embedded-plan');
    const version = new URLSearchParams(location.search).get('v');
    const url = version ? `versions/ftp340-plan-v${version}.json` : 'adaptive-plan.json';
    let m;
    try {
      m = embedded ? JSON.parse(embedded.textContent) : await (await fetch(url,{cache:'no-store'})).json();
    }
    catch (err) {
      document.getElementById('today-title').textContent = 'Не удалось загрузить план';
      document.getElementById('today-lead').textContent = 'Открой прототип через локальный сервер, чтобы браузер мог прочитать adaptive-plan.json.';
      return;
    }
    state.manifest = m;
    state.weeks = (m.weeks || []).slice();
    state.currentWeek = findTodayWeek();
    renderHero(m);
    renderWeekRail();
    renderWeek();
    renderToday();
    renderRoadmap();
    renderAnalytics();
    renderTests();
    renderCalculator();
    document.getElementById('telemetry-unlock')?.addEventListener('click', unlockTelemetry);
    document.getElementById('telemetry-pin')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') unlockTelemetry();
    });
    updateLiveStatus();
    document.getElementById('week-prev').onclick = () => {
      const idx = state.weeks.findIndex(w=>w.week_number===state.currentWeek);
      if (idx>0) setWeek(state.weeks[idx-1].week_number);
    };
    document.getElementById('week-next').onclick = () => {
      const idx = state.weeks.findIndex(w=>w.week_number===state.currentWeek);
      if (idx>=0 && idx<state.weeks.length-1) setWeek(state.weeks[idx+1].week_number);
    };
    document.getElementById('modal-close').onclick = () => document.getElementById('day-modal').close();
    document.getElementById('day-modal').addEventListener('click', e=>{ if(e.target===e.currentTarget) e.currentTarget.close(); });
    const openDate = new URLSearchParams(location.search).get('day');
    if (openDate) {
      const targetDay = state.weeks.flatMap(week => week.days || []).find(day => day.date === openDate);
      if (targetDay) openDay(targetDay);
    }
    initReveal();
    document.documentElement.style.setProperty('--loaded','1');
  }

  if (globalThis.__BOARD_UAT__) {
    globalThis.uat = {displayTitle, cleanTitle, blockName, kindOf, isTest, getWorkingFtp};
  }

  document.addEventListener('DOMContentLoaded', init);
})();
