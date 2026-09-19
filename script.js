/* ==========================================================
   Aurea — lógica da plataforma
   JavaScript puro · localStorage · sem dependências
   ========================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------
     1. CONFIGURAÇÃO
     ------------------------------------------------------ */
  const CONFIG = {
    STORAGE_KEY: 'aurea_state_v1',
    START_BALANCE: 200,
    TASK_REWARD: 500,
    TASKS_PER_CYCLE: 10,
    CYCLE_MS: 24 * 60 * 60 * 1000,
    SUPER_CYCLE_MS: 16 * 60 * 60 * 1000,
    SUPER_REWARDS: [1000, 1200, 1500],
    MIN_WITHDRAW: 50000,
    HISTORY_LIMIT: 300,
    TOAST_MS: 2600,
    SHOW_DEMO_BADGE: false, // mude para true para mostrar a etiqueta "Demo" no topo
    SOCIAL_BAR_SRC: 'https://pl31421515.profitableratecpmnetwork.com/93/e2/9a/93e29a2a3974f7f5d0227afc0f03147f.js'
  };

  const TASK_PLAN = [
    { type: 'quiz',      title: 'Pergunta rápida',      desc: 'Escolha a resposta correcta.' },
    { type: 'sequence',  title: 'Sequência numérica',   desc: 'Descubra o próximo número.' },
    { type: 'memory',    title: 'Teste de memória',     desc: 'Memorize o código apresentado.' },
    { type: 'target',    title: 'Teste de atenção',     desc: 'Encontre o símbolo diferente.' },
    { type: 'math',      title: 'Desafio de lógica',    desc: 'Resolva o cálculo.' },
    { type: 'countdown', title: 'Contagem regressiva',  desc: 'Toque no momento certo.' },
    { type: 'quiz',      title: 'Pergunta rápida',      desc: 'Escolha a resposta correcta.' },
    { type: 'sequence',  title: 'Sequência numérica',   desc: 'Descubra o próximo número.' },
    { type: 'target',    title: 'Teste de atenção',     desc: 'Encontre o símbolo diferente.' },
    { type: 'math',      title: 'Desafio de lógica',    desc: 'Resolva o cálculo.' }
  ];

  const SUPER_TYPES = ['memory', 'sequence', 'target', 'math'];

  const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

  /* ------------------------------------------------------
     2. UTILITÁRIOS
     ------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const pick = (arr) => arr[rand(0, arr.length - 1)];
  const pad2 = (n) => String(n).padStart(2, '0');

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(id, extra) {
    return `<svg class="ico${extra ? ' ' + extra : ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  }

  function fmtNumber(n) {
    return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function fmtKz(n) {
    return (n < 0 ? '-' : '') + fmtNumber(n) + ' Kz';
  }
  function fmtSigned(n) {
    return (n >= 0 ? '+' : '−') + fmtNumber(n) + ' Kz';
  }
  function moneyHTML(n) {
    return `<span class="num">${fmtNumber(n)}</span><span class="cur">Kz</span>`;
  }
  function fmtDuration(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return `${pad2(h)}h ${pad2(m)}min ${pad2(s)}s`;
  }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }
  function dayLabel(ts) {
    const now = Date.now();
    if (dayKey(ts) === dayKey(now)) return 'Hoje';
    if (dayKey(ts) === dayKey(now - 86400000)) return 'Ontem';
    const d = new Date(ts);
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  function timeLabel(ts) {
    const d = new Date(ts);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function parseAmount(value) {
    const digits = String(value).replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  }

  function maskIban(iban) {
    return `${iban.slice(0, 4)} **** **** **** ${iban.slice(-4)}`;
  }

  /* ------------------------------------------------------
     3. ESTADO E LOCALSTORAGE
     ------------------------------------------------------ */
  let state = null;

  function newSuperTask() {
    return {
      available: true,
      next: null,
      reward: pick(CONFIG.SUPER_REWARDS),
      type: pick(SUPER_TYPES)
    };
  }

  function createInitialState(now) {
    return {
      v: 1,
      name: 'Utilizador',
      balance: CONFIG.START_BALANCE,
      totalEarned: CONFIG.START_BALANCE,
      totalWithdrawn: 0,
      totalTasks: 0,
      totalSuper: 0,
      cycle: { number: 1, start: now, end: now + CONFIG.CYCLE_MS, done: [] },
      super: newSuperTask(),
      history: [
        {
          id: `${now}-b`,
          type: 'bonus',
          title: 'Bónus de boas-vindas',
          amount: CONFIG.START_BALANCE,
          ts: now
        }
      ],
      withdrawals: []
    };
  }

  function normalizeState(raw, now) {
    const base = createInitialState(now);
    if (!raw || typeof raw !== 'object') return base;

    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const s = { ...base };

    s.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 24) : base.name;
    s.balance = Math.max(0, num(raw.balance, base.balance));
    s.totalEarned = Math.max(0, num(raw.totalEarned, base.totalEarned));
    s.totalWithdrawn = Math.max(0, num(raw.totalWithdrawn, 0));
    s.totalTasks = Math.max(0, Math.floor(num(raw.totalTasks, 0)));
    s.totalSuper = Math.max(0, Math.floor(num(raw.totalSuper, 0)));

    const c = raw.cycle || {};
    const start = num(c.start, now);
    const end = num(c.end, start + CONFIG.CYCLE_MS);
    if (end > start) {
      const done = Array.isArray(c.done)
        ? Array.from(new Set(c.done.filter((i) => Number.isInteger(i) && i >= 0 && i < CONFIG.TASKS_PER_CYCLE)))
        : [];
      s.cycle = { number: Math.max(1, Math.floor(num(c.number, 1))), start, end, done };
    }

    const sp = raw.super || {};
    const superState = {
      available: sp.available === true,
      next: num(sp.next, null),
      reward: CONFIG.SUPER_REWARDS.includes(sp.reward) ? sp.reward : pick(CONFIG.SUPER_REWARDS),
      type: SUPER_TYPES.includes(sp.type) ? sp.type : pick(SUPER_TYPES)
    };
    if (!superState.available && superState.next === null) superState.available = true;
    s.super = superState;

    s.history = Array.isArray(raw.history)
      ? raw.history
          .filter((h) => h && typeof h === 'object' && typeof h.title === 'string' && Number.isFinite(h.ts) && Number.isFinite(h.amount))
          .slice(0, CONFIG.HISTORY_LIMIT)
      : base.history;

    s.withdrawals = Array.isArray(raw.withdrawals)
      ? raw.withdrawals.filter((w) => w && Number.isFinite(w.amount) && typeof w.iban === 'string' && Number.isFinite(w.ts))
      : [];

    return s;
  }

  const Store = {
    load() {
      try {
        const raw = window.localStorage.getItem(CONFIG.STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    save() {
      try {
        window.localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        /* armazenamento indisponível: a sessão continua em memória */
      }
    }
  };

  /* ------------------------------------------------------
     4. SALDO E HISTÓRICO
     ------------------------------------------------------ */
  function addHistory(entry) {
    const ts = Date.now();
    state.history.unshift({ id: `${ts}-${rand(100, 999)}`, ts, ...entry });
    if (state.history.length > CONFIG.HISTORY_LIMIT) state.history.length = CONFIG.HISTORY_LIMIT;
  }

  function creditBalance(amount) {
    state.balance += amount;
    state.totalEarned += amount;
  }

  function debitBalance(amount) {
    state.balance -= amount;
    state.totalWithdrawn += amount;
  }

  /* ------------------------------------------------------
     5. TEMPORIZADORES (ciclo de 24h e Super Tarefa de 16h)
     ------------------------------------------------------ */
  function syncTimers(now) {
    let changed = false;

    if (now >= state.cycle.end) {
      const elapsed = Math.max(1, Math.floor((now - state.cycle.start) / CONFIG.CYCLE_MS));
      state.cycle.start += elapsed * CONFIG.CYCLE_MS;
      state.cycle.end = state.cycle.start + CONFIG.CYCLE_MS;
      state.cycle.number += elapsed;
      state.cycle.done = [];
      changed = true;
    }

    if (!state.super.available && now >= state.super.next) {
      state.super = newSuperTask();
      changed = true;
    }

    return changed;
  }

  function updateTimers() {
    const now = Date.now();
    const cycleText = fmtDuration(state.cycle.end - now);
    $$('.js-cycle-timer').forEach((n) => { n.textContent = cycleText; });

    if (!state.super.available) {
      const superText = fmtDuration(state.super.next - now);
      $$('.js-super-timer').forEach((n) => { n.textContent = superText; });
    }
  }

  function tick() {
    if (syncTimers(Date.now())) {
      Store.save();
      renderAll();
    }
    updateTimers();
  }

  /* ------------------------------------------------------
     6. GESTÃO DE TAREFAS
     ------------------------------------------------------ */
  function tasksDoneCount() {
    return state.cycle.done.length;
  }

  function startTask(index) {
    syncTimers(Date.now());
    if (state.cycle.done.includes(index)) return;
    if (tasksDoneCount() >= CONFIG.TASKS_PER_CYCLE) return;

    const plan = TASK_PLAN[index];
    if (!plan) return;

    if (taskSocialBarMoment(index) === 'start') triggerSocialBar();

    openChallenge({
      label: `Tarefa #${pad2(index + 1)}`,
      reward: CONFIG.TASK_REWARD,
      type: plan.type,
      level: 1,
      isSuper: false,
      onSuccess: () => completeTask(index)
    });
  }

  function completeTask(index) {
    syncTimers(Date.now());
    if (state.cycle.done.includes(index)) return false;
    if (tasksDoneCount() >= CONFIG.TASKS_PER_CYCLE) return false;

    state.cycle.done.push(index);
    state.totalTasks += 1;
    creditBalance(CONFIG.TASK_REWARD);
    addHistory({ type: 'task', title: `Tarefa #${pad2(index + 1)}`, amount: CONFIG.TASK_REWARD });

    Store.save();
    renderAll();
    if (taskSocialBarMoment(index) === 'end') triggerSocialBar();
    pendingTaskAd = true;
    showRewardOverlay({
      title: 'Tarefa concluída!',
      amount: CONFIG.TASK_REWARD,
      message: `Parabéns, ${state.name}. O valor já foi adicionado ao seu saldo.`
    });
    return true;
  }

  /* ------------------------------------------------------
     7. SUPER TAREFAS
     ------------------------------------------------------ */
  function startSuper() {
    syncTimers(Date.now());
    if (!state.super.available) return;

    if (superSocialBarMoment() === 'start') triggerSocialBar();

    openChallenge({
      label: 'Super Tarefa',
      reward: state.super.reward,
      type: state.super.type,
      level: 2,
      isSuper: true,
      onSuccess: completeSuper
    });
  }

  function completeSuper() {
    syncTimers(Date.now());
    if (!state.super.available) return false;

    const reward = state.super.reward;
    const showAtEnd = superSocialBarMoment() === 'end';
    creditBalance(reward);
    state.totalSuper += 1;
    state.super = {
      available: false,
      next: Date.now() + CONFIG.SUPER_CYCLE_MS,
      reward,
      type: state.super.type
    };
    addHistory({ type: 'super', title: 'Super Tarefa', amount: reward });

    Store.save();
    renderAll();
    if (showAtEnd) triggerSocialBar();
    pendingTaskAd = true;
    showRewardOverlay({
      title: 'Super Tarefa concluída!',
      amount: reward,
      message: `Excelente, ${state.name}. O valor já foi adicionado ao seu saldo.`
    });
    return true;
  }

  /* ------------------------------------------------------
     8. DESAFIOS INTERACTIVOS
     Cada desafio devolve { mount(root, done) } e mount devolve
     uma função de limpeza. done(sucesso, mensagem?)
     ------------------------------------------------------ */
  const QUIZ_BANK = [
    ['Qual é a capital de Angola?', 'Luanda', ['Benguela', 'Huambo', 'Lubango']],
    ['Qual é a moeda de Angola?', 'Kwanza', ['Metical', 'Escudo', 'Rand']],
    ['Em que ano Angola alcançou a independência?', '1975', ['1974', '1976', '1980']],
    ['Qual é o maior oceano do mundo?', 'Pacífico', ['Atlântico', 'Índico', 'Árctico']],
    ['Que planeta é conhecido como Planeta Vermelho?', 'Marte', ['Vénus', 'Júpiter', 'Saturno']],
    ['Quantos minutos tem uma hora?', '60', ['30', '90', '100']],
    ['Qual destes animais é um mamífero?', 'Golfinho', ['Tubarão', 'Atum', 'Polvo']],
    ['Quantos lados tem um hexágono?', '6', ['5', '7', '8']],
    ['Qual é o maior animal terrestre?', 'Elefante', ['Girafa', 'Rinoceronte', 'Hipopótamo']],
    ['Qual é a capital de Portugal?', 'Lisboa', ['Porto', 'Coimbra', 'Braga']],
    ['Quantas horas tem um dia?', '24', ['12', '20', '48']],
    ['Qual destes alimentos é uma fruta?', 'Manga', ['Cenoura', 'Batata', 'Cebola']],
    ['Em que continente fica Angola?', 'África', ['Ásia', 'Europa', 'Oceânia']],
    ['Quantos dias tem uma semana?', '7', ['5', '6', '10']]
  ];

  function uniqueOptions(correct, candidates) {
    const set = new Set([correct]);
    for (const c of candidates) {
      if (set.size >= 4) break;
      if (c !== correct && c > 0 && Number.isFinite(c)) set.add(c);
    }
    let bump = 1;
    while (set.size < 4) {
      set.add(correct + bump * 3);
      bump += 1;
    }
    return shuffle(Array.from(set));
  }

  /** Mostra uma pergunta com botões de opção. */
  function renderOptions(root, cfg) {
    root.innerHTML = '';
    root.append(el('p', 'ch-question', cfg.question));
    if (cfg.hint) root.append(el('p', 'ch-hint', cfg.hint));

    const wrap = el('div', 'ch-options');
    let locked = false;

    cfg.options.forEach((opt) => {
      const btn = el('button', 'opt', String(opt));
      btn.type = 'button';
      btn.addEventListener('click', () => {
        if (locked) return;
        locked = true;
        const ok = String(opt) === String(cfg.correct);
        btn.classList.add(ok ? 'is-right' : 'is-wrong');
        setTimeout(() => cfg.done(ok), 380);
      });
      wrap.append(btn);
    });
    root.append(wrap);
  }

  const Challenges = {
    quiz() {
      return {
        mount(root, done) {
          const [question, correct, wrong] = pick(QUIZ_BANK);
          renderOptions(root, { question, correct, options: shuffle([correct, ...wrong]), done });
          return () => {};
        }
      };
    },

    sequence(level) {
      return {
        mount(root, done) {
          const kind = rand(0, level > 1 ? 4 : 2);
          let seq = [];
          if (kind === 0) {
            const a = rand(2, 20);
            const d = rand(2, 9);
            seq = Array.from({ length: 6 }, (_, i) => a + d * i);
          } else if (kind === 1) {
            const a = rand(1, 5);
            const r = rand(2, 3);
            seq = Array.from({ length: 6 }, (_, i) => a * Math.pow(r, i));
          } else if (kind === 2) {
            let v = rand(1, 9);
            const d = rand(1, 3);
            for (let i = 0; i < 6; i++) { seq.push(v); v += d + i; }
          } else if (kind === 3) {
            seq = [rand(1, 5), rand(1, 5)];
            while (seq.length < 6) seq.push(seq[seq.length - 1] + seq[seq.length - 2]);
          } else {
            const a = rand(2, 6);
            seq = Array.from({ length: 6 }, (_, i) => Math.pow(i + a, 2));
          }
          const answer = seq.pop();
          const options = uniqueOptions(answer, [
            answer + rand(1, 4), answer - rand(1, 4), answer + rand(5, 9), answer - rand(5, 9), answer + 10
          ]);
          renderOptions(root, {
            question: `${seq.join(', ')}, ?`,
            hint: 'Qual número continua a sequência?',
            correct: answer,
            options,
            done
          });
          return () => {};
        }
      };
    },

    math(level) {
      return {
        mount(root, done) {
          const a = rand(3, 12);
          const b = rand(2, 9);
          const c = rand(2, 9);
          const d = rand(2, 9);
          const variant = rand(0, level > 1 ? 2 : 1);
          let text, answer, trap;

          if (variant === 0) {
            text = `${a} + ${b} × ${c}`;
            answer = a + b * c;
            trap = (a + b) * c;
          } else if (variant === 1) {
            text = `${a} × ${b} − ${c}`;
            answer = a * b - c;
            trap = a * (b - c);
          } else {
            text = `(${a} + ${b}) × ${c} − ${d}`;
            answer = (a + b) * c - d;
            trap = a + b * c - d;
          }

          const options = uniqueOptions(answer, [trap, answer + rand(1, 5), answer - rand(1, 5), answer + 10]);
          renderOptions(root, {
            question: `Quanto é ${text}?`,
            hint: 'Respeite a ordem das operações.',
            correct: answer,
            options,
            done
          });
          return () => {};
        }
      };
    },

    memory(level) {
      return {
        mount(root, done) {
          const len = level > 1 ? 6 : 4;
          const showMs = level > 1 ? 3500 : 3000;
          const digits = Array.from({ length: len }, () => rand(0, 9));
          const code = digits.join('');

          root.innerHTML = '';
          root.append(el('p', 'ch-question', 'Memorize o código'));
          const codeEl = el('div', 'ch-code', code);
          const bar = el('div', 'ch-bar');
          const barFill = el('span');
          bar.append(barFill);
          root.append(codeEl, bar);

          requestAnimationFrame(() => requestAnimationFrame(() => {
            barFill.style.transition = `transform ${showMs}ms linear`;
            barFill.style.transform = 'scaleX(0)';
          }));

          const timer = setTimeout(() => {
            const variants = new Set([code]);
            let guard = 0;
            while (variants.size < 4 && guard < 60) {
              guard += 1;
              const arr = code.split('');
              const i = rand(0, len - 1);
              arr[i] = String((Number(arr[i]) + rand(1, 9)) % 10);
              if (guard % 3 === 0 && len > 1) {
                const j = rand(0, len - 1);
                [arr[i], arr[j]] = [arr[j], arr[i]];
              }
              variants.add(arr.join(''));
            }
            renderOptions(root, {
              question: 'Qual era o código?',
              correct: code,
              options: shuffle(Array.from(variants)),
              done
            });
          }, showMs);

          return () => clearTimeout(timer);
        }
      };
    },

    target(level) {
      return {
        mount(root, done) {
          const pairs = [['🟡', '🟠'], ['🔷', '🔹'], ['🍎', '🍒'], ['🐱', '🐶'], ['⭐', '🌟'], ['🔴', '🟣']];
          const [base, odd] = pick(pairs);
          const cols = level > 1 ? 4 : 3;
          const total = cols * cols;
          const oddIndex = rand(0, total - 1);

          root.innerHTML = '';
          root.append(el('p', 'ch-question', 'Toque no símbolo diferente'));
          const grid = el('div', 'ch-grid');
          grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
          let locked = false;

          for (let i = 0; i < total; i++) {
            const cell = el('button', 'ch-cell', i === oddIndex ? odd : base);
            cell.type = 'button';
            cell.addEventListener('click', () => {
              if (locked) return;
              locked = true;
              const ok = i === oddIndex;
              cell.classList.add(ok ? 'is-right' : 'is-wrong');
              setTimeout(() => done(ok), 380);
            });
            grid.append(cell);
          }
          root.append(grid);
          return () => {};
        }
      };
    },

    countdown(level) {
      return {
        mount(root, done) {
          let n = level > 1 ? 5 : 3;
          let windowOpen = false;
          let finished = false;
          let t1 = null;
          let t2 = null;

          root.innerHTML = '';
          root.append(el('p', 'ch-question', 'Toque em “Agora” quando o contador chegar a zero'));
          const num = el('div', 'ch-count', String(n));
          const btn = el('button', 'btn btn-gold btn-block', 'Agora');
          btn.type = 'button';
          root.append(num, btn);

          const step = () => {
            n -= 1;
            if (n > 0) {
              num.textContent = String(n);
              t1 = setTimeout(step, 1000);
            } else {
              num.textContent = 'Já!';
              windowOpen = true;
              t2 = setTimeout(() => {
                if (finished) return;
                finished = true;
                done(false, 'Tempo esgotado. Tente novamente.');
              }, 1500);
            }
          };
          t1 = setTimeout(step, 1000);

          btn.addEventListener('click', () => {
            if (finished) return;
            finished = true;
            clearTimeout(t1);
            clearTimeout(t2);
            done(windowOpen, windowOpen ? undefined : 'Cedo demais. Tente novamente.');
          });

          return () => { clearTimeout(t1); clearTimeout(t2); };
        }
      };
    },

    create(type, level) {
      const factory = Challenges[type] || Challenges.quiz;
      return factory(level);
    }
  };

  /* ------------------------------------------------------
     9. MODAIS
     ------------------------------------------------------ */
  let activeChallenge = null;

  function openChallenge(cfg) {
    closeChallenge();

    const modal = $('#challengeModal');
    $('#chLabel').textContent = cfg.label;
    $('#chReward').textContent = `+${fmtKz(cfg.reward)}`;
    modal.classList.toggle('is-super', !!cfg.isSuper);

    const session = { cleanup: null };
    activeChallenge = session;

    const run = () => {
      if (session.cleanup) session.cleanup();
      const body = $('#chBody');
      body.innerHTML = '';
      const challenge = Challenges.create(cfg.type, cfg.level);
      session.cleanup = challenge.mount(body, (ok, message) => {
        if (activeChallenge !== session) return;
        if (ok) {
          closeChallenge();
          cfg.onSuccess();
        } else {
          toast(message || 'Resposta incorrecta. Tente novamente.', 'error');
          run();
        }
      });
    };

    modal.hidden = false;
    run();
    $('#chClose').focus({ preventScroll: true });
  }

  function closeChallenge() {
    if (activeChallenge && activeChallenge.cleanup) activeChallenge.cleanup();
    activeChallenge = null;
    const modal = $('#challengeModal');
    if (modal) {
      modal.hidden = true;
      $('#chBody').innerHTML = '';
    }
  }

  function openNameModal() {
    const input = $('#nameInput');
    input.value = state.name === 'Utilizador' ? '' : state.name;
    $('#nameModal').hidden = false;
    input.focus({ preventScroll: true });
  }

  function closeNameModal() {
    $('#nameModal').hidden = true;
  }

  function saveName(event) {
    event.preventDefault();
    const value = $('#nameInput').value.trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!value) {
      toast('Indique um nome.', 'error');
      return;
    }
    state.name = value;
    Store.save();
    renderAll();
    closeNameModal();
    toast('Nome guardado.');
  }

  /* ------------------------------------------------------
     10. NOTIFICAÇÕES
     ------------------------------------------------------ */
  function toast(message, type) {
    const host = $('#toasts');
    while (host.children.length >= 2) host.firstElementChild.remove();

    const node = el('div', `toast${type === 'error' ? ' error' : ''}`, message);
    host.append(node);
    requestAnimationFrame(() => node.classList.add('show'));

    setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => node.remove(), 300);
    }, CONFIG.TOAST_MS);
  }

  /* ------------------------------------------------------
     10b. ECRÃ DE BÓNUS (mensagem central personalizada)
     ------------------------------------------------------ */
  let pendingTaskAd = false;

  function showRewardOverlay({ title, amount, message }) {
    const overlay = $('#rewardOverlay');
    if (!overlay) return;
    $('#rewardTitle').textContent = title;
    $('#rewardAmount').textContent = `+${fmtKz(amount)}`;
    $('#rewardMsg').textContent = message;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('show'));
  }

  function closeRewardOverlay() {
    const overlay = $('#rewardOverlay');
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove('show');
    setTimeout(() => { overlay.hidden = true; }, 220);

    if (pendingTaskAd) {
      pendingTaskAd = false;
      setTimeout(showTaskAd, 260);
    }
  }

  /* ------------------------------------------------------
     10c. PUBLICIDADE (AdsTerra)
     - Social Bar: script injectado dinamicamente, dividido de forma
       proporcional entre o início e o fim das tarefas (metade/metade),
       e também entre início/fim da Super Tarefa.
     - Native Banner: dentro de #adSlotTask (modal pós-tarefa).
     - Banner 320x50: fixo em #adSlotBannerTop.
     ------------------------------------------------------ */
  function triggerSocialBar() {
    if (!CONFIG.SOCIAL_BAR_SRC) return;
    try {
      const s = document.createElement('script');
      s.src = CONFIG.SOCIAL_BAR_SRC;
      s.async = true;
      document.body.appendChild(s);
    } catch (e) {
      /* rede de anúncios indisponível: não interrompe a experiência */
    }
  }

  // Divide as 10 tarefas ao meio: índices pares mostram o Social Bar
  // ao INÍCIO, índices ímpares mostram-no ao FIM. 5 de cada, proporcional.
  function taskSocialBarMoment(index) {
    return index % 2 === 0 ? 'start' : 'end';
  }

  // Para a Super Tarefa (uma ocorrência de cada vez), alterna entre
  // início e fim conforme a paridade de quantas já foram concluídas.
  function superSocialBarMoment() {
    return state.totalSuper % 2 === 0 ? 'start' : 'end';
  }

  function showTaskAd() {
    const slot = $('#adSlotTask');
    const modal = $('#taskAdModal');
    if (!slot || !modal) return;
    if (slot.children.length === 0 && !slot.textContent.trim()) return;
    modal.hidden = false;
  }

  function closeTaskAd() {
    const modal = $('#taskAdModal');
    if (modal) modal.hidden = true;
  }

  /* ------------------------------------------------------
     11. NAVEGAÇÃO
     ------------------------------------------------------ */
  const VIEW_TO_TAB = {
    home: 'home', tasks: 'tasks', super: 'super', wallet: 'wallet',
    history: 'wallet', profile: 'profile', terms: 'profile'
  };

  function showView(name) {
    if (!VIEW_TO_TAB[name]) name = 'home';
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
    $$('.tab').forEach((t) => {
      const active = t.dataset.tab === VIEW_TO_TAB[name];
      t.classList.toggle('active', active);
      if (active) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    window.scrollTo({ top: 0 });
  }

  /* ------------------------------------------------------
     12. LEVANTAMENTOS (simulados)
     ------------------------------------------------------ */
  function requestWithdrawal(event) {
    event.preventDefault();

    const nameInput = $('#wName');
    const ibanInput = $('#wIban');
    const amountInput = $('#wAmount');

    if (state.balance < CONFIG.MIN_WITHDRAW) {
      toast('Saldo insuficiente.', 'error');
      return;
    }

    const holder = nameInput.value.trim().replace(/\s+/g, ' ');
    const iban = ibanInput.value.replace(/\s+/g, '').toUpperCase();
    const amount = parseAmount(amountInput.value);

    if (!holder) { toast('Indique o nome do titular.', 'error'); return; }
    if (!IBAN_RE.test(iban)) { toast('IBAN inválido.', 'error'); return; }
    if (amount < CONFIG.MIN_WITHDRAW) { toast(`O valor mínimo é ${fmtKz(CONFIG.MIN_WITHDRAW)}.`, 'error'); return; }
    if (amount > state.balance) { toast('Saldo insuficiente.', 'error'); return; }

    const masked = maskIban(iban);
    const ts = Date.now();

    debitBalance(amount);
    state.withdrawals.unshift({ id: `${ts}-w`, amount, iban: masked, holder, ts, status: 'Em análise' });
    addHistory({ type: 'withdraw', title: 'Levantamento', amount: -amount, sub: `IBAN: ${masked}`, status: 'Em análise' });

    nameInput.value = '';
    ibanInput.value = '';
    amountInput.value = '';

    Store.save();
    renderAll();
    toast('Levantamento solicitado. Em análise.');
  }

  /* ------------------------------------------------------
     13. RENDERIZAÇÃO
     ------------------------------------------------------ */
  let historyFilter = 'all';

  function renderBalance() {
    const text = fmtKz(state.balance);
    $$('.js-balance').forEach((n) => { n.textContent = text; });
    $$('.js-balance-big').forEach((n) => { n.innerHTML = moneyHTML(state.balance); });

    const pct = Math.min(100, (state.balance / CONFIG.MIN_WITHDRAW) * 100);
    $$('.js-goal-fill').forEach((n) => { n.style.width = `${pct}%`; });
    const goalText = state.balance >= CONFIG.MIN_WITHDRAW
      ? 'Já pode solicitar levantamento'
      : `Faltam ${fmtKz(CONFIG.MIN_WITHDRAW - state.balance)}`;
    $$('.js-goal-text').forEach((n) => { n.textContent = goalText; });
  }

  function renderProgress() {
    const done = tasksDoneCount();
    const left = CONFIG.TASKS_PER_CYCLE - done;
    $$('.js-done').forEach((n) => { n.textContent = String(done); });
    $$('.js-task-bar').forEach((n) => { n.style.width = `${(done / CONFIG.TASKS_PER_CYCLE) * 100}%`; });

    const leftText = left > 0
      ? `${left} ${left === 1 ? 'tarefa disponível' : 'tarefas disponíveis'}`
      : 'Ciclo completo';
    $$('.js-left-text').forEach((n) => { n.textContent = leftText; });

    const panel = $('#cyclePanel');
    panel.classList.toggle('is-complete', left === 0);
    $('#cycleNote').textContent = left > 0
      ? `${leftText} · +${fmtKz(CONFIG.TASK_REWARD)} cada`
      : 'Todas as tarefas foram concluídas. Novas tarefas no próximo ciclo.';
  }

  function renderTaskList() {
    const list = $('#taskList');
    list.innerHTML = '';

    TASK_PLAN.forEach((plan, i) => {
      const done = state.cycle.done.includes(i);
      const card = el('article', `task-card${done ? ' is-done' : ''}`);
      card.innerHTML = `
        <div class="task-top">
          <span class="task-num">Tarefa #${pad2(i + 1)}</span>
          <span class="task-status">${done ? 'Concluída' : 'Disponível'}</span>
        </div>
        <h3>${plan.title}</h3>
        <p>${plan.desc}</p>
        <div class="task-foot">
          <span class="reward">+${fmtKz(CONFIG.TASK_REWARD)}</span>
          ${done
            ? `<span class="done-mark">${icon('check', 'sm')} Tarefa concluída</span>`
            : `<button class="btn btn-gold" type="button" data-task="${i}">Realizar tarefa</button>`}
        </div>`;
      list.append(card);
    });
  }

  function renderSuper() {
    const sp = state.super;
    const card = $('#superCard');
    const teaser = $('#superTeaser');

    if (sp.available) {
      card.innerHTML = `
        <div class="super-card is-available">
          <span class="super-tag">${icon('bolt')} Super Tarefa</span>
          <h3>Desafio especial disponível</h3>
          <div class="super-reward">+${fmtKz(sp.reward)}</div>
          <button class="btn btn-gold btn-block" type="button" data-super>Realizar super tarefa</button>
        </div>`;
      teaser.innerHTML = `
        <button class="teaser is-available" type="button" data-goto="super">
          <span class="teaser-ico">${icon('bolt')}</span>
          <span class="teaser-body"><strong>Super Tarefa disponível</strong><span>+${fmtKz(sp.reward)}</span></span>
          ${icon('arrow', 'sm')}
        </button>`;
    } else {
      card.innerHTML = `
        <div class="super-card">
          <span class="super-tag">${icon('bolt')} Super Tarefa</span>
          <h3>Concluída</h3>
          <span class="stat-label">Próxima Super Tarefa em</span>
          <div class="big-timer js-super-timer">--</div>
        </div>`;
      teaser.innerHTML = `
        <button class="teaser" type="button" data-goto="super">
          <span class="teaser-ico">${icon('bolt')}</span>
          <span class="teaser-body"><strong>Próxima Super Tarefa em</strong><span class="js-super-timer">--</span></span>
          ${icon('arrow', 'sm')}
        </button>`;
    }

    $('#tabDotSuper').hidden = !sp.available;
  }

  function historyIcon(type) {
    if (type === 'withdraw') return `<span class="item-ico">${icon('out')}</span>`;
    if (type === 'super') return `<span class="item-ico gold">${icon('bolt')}</span>`;
    if (type === 'bonus') return `<span class="item-ico gold">${icon('gift')}</span>`;
    return `<span class="item-ico gold">${icon('check')}</span>`;
  }

  function historyItem(h, withDate) {
    const item = el('div', 'item');
    const sub = [];
    if (withDate) sub.push(`${dayLabel(h.ts)}, ${timeLabel(h.ts)}`); else sub.push(timeLabel(h.ts));
    if (h.sub) sub.push(h.sub);

    item.innerHTML = `
      ${historyIcon(h.type)}
      <div class="item-body">
        <span class="item-title"></span>
        <span class="item-sub"></span>
        ${h.status ? '<span class="badge"></span>' : ''}
      </div>
      <span class="item-amount ${h.amount >= 0 ? 'plus' : 'minus'}"></span>`;
    $('.item-title', item).textContent = h.title;
    $('.item-sub', item).textContent = sub.join(' · ');
    if (h.status) $('.badge', item).textContent = h.status;
    $('.item-amount', item).textContent = fmtSigned(h.amount);
    return item;
  }

  function renderRecent() {
    ['#recentHome', '#recentProfile'].forEach((sel) => {
      const host = $(sel);
      host.innerHTML = '';
      const items = state.history.slice(0, 3);
      if (!items.length) {
        host.append(el('div', 'empty', 'Ainda não há actividade. Realize a sua primeira tarefa.'));
        return;
      }
      items.forEach((h) => host.append(historyItem(h, true)));
    });
  }

  function renderHistory() {
    const host = $('#historyList');
    host.innerHTML = '';

    const filtered = state.history.filter((h) => {
      if (historyFilter === 'tasks') return h.type === 'task';
      if (historyFilter === 'super') return h.type === 'super';
      if (historyFilter === 'withdraw') return h.type === 'withdraw';
      return true;
    });

    if (!filtered.length) {
      host.append(el('div', 'empty', 'Nada para mostrar neste filtro.'));
      return;
    }

    let currentKey = null;
    let ul = null;
    filtered.forEach((h) => {
      const key = dayKey(h.ts);
      if (key !== currentKey) {
        currentKey = key;
        const group = el('div', 'hist-group');
        group.append(el('h4', '', dayLabel(h.ts)));
        ul = el('div', 'list');
        group.append(ul);
        host.append(group);
      }
      ul.append(historyItem(h, false));
    });

    $$('#historyFilters .chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === historyFilter));
  }

  function renderWallet() {
    $$('.js-earned').forEach((n) => { n.textContent = fmtKz(state.totalEarned); });
    $$('.js-withdrawn').forEach((n) => { n.textContent = fmtKz(state.totalWithdrawn); });
    $$('.js-tasks-total').forEach((n) => { n.textContent = String(state.totalTasks); });
    $$('.js-super-total').forEach((n) => { n.textContent = String(state.totalSuper); });

    const host = $('#withdrawalList');
    host.innerHTML = '';
    if (!state.withdrawals.length) {
      host.append(el('div', 'empty', 'Nenhum levantamento solicitado.'));
      return;
    }
    state.withdrawals.slice(0, 5).forEach((w) => {
      const item = el('div', 'item');
      item.innerHTML = `
        <span class="item-ico">${icon('out')}</span>
        <div class="item-body">
          <span class="item-title">Levantamento</span>
          <span class="item-sub"></span>
          <span class="badge"></span>
        </div>
        <span class="item-amount minus"></span>`;
      $('.item-sub', item).textContent = `${dayLabel(w.ts)} · IBAN: ${w.iban}`;
      $('.badge', item).textContent = w.status;
      $('.item-amount', item).textContent = fmtSigned(-w.amount);
      host.append(item);
    });
  }

  function renderProfile() {
    $$('.js-username').forEach((n) => { n.textContent = state.name; });
    const initial = (state.name.trim().charAt(0) || 'U').toUpperCase();
    $$('.js-initial').forEach((n) => { n.textContent = initial; });
  }

  function renderAll() {
    renderBalance();
    renderProgress();
    renderTaskList();
    renderSuper();
    renderRecent();
    renderHistory();
    renderWallet();
    renderProfile();
    updateTimers();
  }

  /* ------------------------------------------------------
     14. EVENTOS
     ------------------------------------------------------ */
  function bindEvents() {
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      const goto = target.closest('[data-goto]');
      if (goto) { showView(goto.dataset.goto); return; }

      const task = target.closest('[data-task]');
      if (task) { startTask(Number(task.dataset.task)); return; }

      if (target.closest('[data-super]')) { startSuper(); return; }

      const filter = target.closest('[data-filter]');
      if (filter) {
        historyFilter = filter.dataset.filter;
        renderHistory();
        return;
      }

      if (target.closest('[data-open-name]')) { openNameModal(); return; }

      if (target.closest('[data-close-reward]') || target.id === 'rewardOverlay') { closeRewardOverlay(); return; }

      const closer = target.closest('[data-close-modal]');
      if (closer) {
        const modal = closer.closest('.modal');
        if (modal && modal.id === 'challengeModal') closeChallenge();
        else if (modal && modal.id === 'taskAdModal') closeTaskAd();
        else closeNameModal();
      }
    });

    $('#withdrawForm').addEventListener('submit', requestWithdrawal);
    $('#nameForm').addEventListener('submit', saveName);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#challengeModal').hidden) closeChallenge();
      if (!$('#nameModal').hidden) closeNameModal();
      if (!$('#taskAdModal').hidden) closeTaskAd();
      if (!$('#rewardOverlay').hidden) closeRewardOverlay();
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) tick();
    });
  }

  /* ------------------------------------------------------
     15. INICIALIZAÇÃO
     ------------------------------------------------------ */
  function init() {
    const now = Date.now();
    const existingRaw = Store.load();
    const isFirstVisit = !existingRaw;
    state = normalizeState(existingRaw, now);
    syncTimers(now);
    Store.save();

    document.body.classList.toggle('show-demo', CONFIG.SHOW_DEMO_BADGE);

    bindEvents();
    renderAll();
    showView('home');
    setInterval(tick, 1000);

    if (isFirstVisit) {
      setTimeout(() => {
        showRewardOverlay({
          title: 'Bem-vindo(a)!',
          amount: CONFIG.START_BALANCE,
          message: `Olá, ${state.name}. Recebeu um bónus de boas-vindas e o valor já está no seu saldo.`
        });
      }, 600);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
