/* ВелоМощь: интерфейс поверх исходного плана. Расчёт FTP остаётся в index.html. */
document.addEventListener('DOMContentLoaded', () => {
  document.title='ВелоМощь · FTP 340';
  const wrap = document.querySelector('.wrap');
  if (!wrap || wrap.dataset.boardReady) return;
  wrap.dataset.boardReady = 'true';
  const groups = {plan:['plan'],control:['ftp','monitor','tests'],guide:['analysis','principles','strength','food','macro']};
  const sections = {};
  [...wrap.children].filter(el => el.matches && el.matches('h2[id]')).forEach(h2 => {
    const section = document.createElement('section'); section.dataset.section = h2.id; h2.before(section); section.append(h2);
    let next = section.nextSibling;
    while (next && !(next.nodeType === 1 && next.matches('h2[id]'))) { const moving=next; next=next.nextSibling; section.append(moving); }
    sections[h2.id]=section;
  });
  if(typeof recalc==='function') recalc();
  const shell = document.createElement('header'); shell.className='board-shell';
  shell.innerHTML=`<div class="brand-row"><div class="brand"><span class="bolt">↗</span>ВелоМощь <span class="date-chip">План · актуальная версия</span></div><span class="date-chip">Цель: FTP 340 к 06.06.2027</span></div><nav class="tabbar" aria-label="Разделы борда"><button class="tab" data-tab="now" aria-selected="true">Сейчас</button><button class="tab" data-tab="plan" aria-selected="false">План</button><button class="tab" data-tab="control" aria-selected="false">Контроль</button><button class="tab" data-tab="guide" aria-selected="false">База знаний</button></nav>`;
  wrap.prepend(shell);
  const dash = document.createElement('section'); dash.className='pane active'; dash.dataset.pane='now';
  dash.innerHTML=`<div class="hero"><div><p class="eyebrow">FTP 340 · шоссейный велосипед</p><h1>Адаптивный<br><em>план тренировок</em></h1><p class="hero-copy">Текущий утверждённый план, цель и дата последней синхронизации.</p></div><article class="next-card"><small>План на сегодня</small><h2 data-today-title>Загрузка…</h2><div class="watts" data-today-duration>—</div><p data-today-detail>Данные загружаются из опубликованной версии программы.</p></article></div><div class="metrics"><article class="metric"><b class="lime" data-current-ftp>—</b><span>текущий подтверждённый FTP</span></article><article class="metric"><b class="cyan" data-plan-version>—</b><span>версия плана</span></article><article class="metric"><b data-completed-count>0</b><span>отмеченных выполненных сессий</span></article><article class="metric"><b>340 Вт</b><span>цель · 06 июня 2027</span></article></div><article class="review-card" data-trajectory><h2>Траектория к FTP 340</h2><p>Оценка будет опираться на подтверждённые тесты. Прогноз не заменяет измеренный FTP.</p><div data-test-history></div></article><p class="data-note" data-sync-note>Публичная страница показывает только утверждённый календарь, подтверждённые тесты и даты выполненных тренировок.</p>`;
  const panes={now:dash};
  Object.entries(groups).forEach(([key,ids])=>{const pane=document.createElement('div');pane.className='pane';pane.dataset.pane=key;ids.forEach(id=>sections[id]&&pane.append(sections[id]));panes[key]=pane;});
  shell.after(dash,panes.plan,panes.control,panes.guide);
  const introDate=sections.ftp?.querySelector('table tr:nth-child(2) td:nth-child(3)');
  if(introDate) introDate.textContent='5 ноя – 8 ноя';
  const planSection=sections.plan;
  if(planSection){const weeks=[...planSection.querySelectorAll('details.week')];const tools=document.createElement('div');tools.className='plan-tools';tools.innerHTML=`<div><h2>План по неделям</h2><p>Открыта только выбранная неделя. Подробности остаются в исходном плане, но больше не образуют бесконечную ленту.</p></div><label><span class="sr-only">Выберите неделю</span><select aria-label="Выберите неделю"></select></label><button type="button">Открыть выбранную</button>`;const select=tools.querySelector('select');weeks.forEach((week,i)=>{const option=document.createElement('option');option.value=week.id;option.textContent=`${week.querySelector('.wn')?.textContent} · ${week.querySelector('.wd')?.textContent}`;option.selected=i===0;select.append(option);});const setWeek=id=>weeks.forEach(week=>{const open=week.id===id;week.classList.toggle('selected-week',open);if(open)week.open=true;});select.addEventListener('change',()=>setWeek(select.value));tools.querySelector('button').addEventListener('click',()=>setWeek(select.value));planSection.querySelector('h2').after(tools);setWeek('w0');}
  const guideSections=[...panes.guide.querySelectorAll('section')];if(guideSections.length){const sw=document.createElement('div');sw.className='guide-switch';guideSections.forEach((section,i)=>{const btn=document.createElement('button');btn.type='button';btn.textContent=section.querySelector('h2')?.textContent.replace(/^\d+\.\s*/,'')||'Раздел';btn.classList.toggle('active',i===0);btn.addEventListener('click',()=>{guideSections.forEach(x=>x.classList.toggle('show-guide',x===section));[...sw.children].forEach(x=>x.classList.toggle('active',x===btn));});sw.append(btn);section.classList.toggle('show-guide',i===0);});panes.guide.prepend(sw);}
  document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{const target=tab.dataset.tab;Object.entries(panes).forEach(([key,pane])=>pane.classList.toggle('active',key===target));document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected',String(x===tab)));window.scrollTo({top:0,behavior:'smooth'});}));
});
