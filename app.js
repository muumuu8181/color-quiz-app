(() => {
  const ROUND_SIZE = 5;
  const VERSION = '0.07';
  const KEYS = {
    stats: 'quizStats_v1',
    setName: 'quizSetName_v1',
    selectedSet: 'quizSelectedSet_v1',
    customSets: 'quizCustomSets_v1'
  };

  const $ = (sel) => document.querySelector(sel);
  const screens = {
    menu: $('#screen-menu'), quiz: $('#screen-quiz'), result: $('#screen-result'), history: $('#screen-history'), stats: $('#screen-stats')
  };
  const els = {
    total: $('#stat-total'), attempts: $('#stat-attempts'), start: $('#btn-start'), again: $('#btn-again'), menu: $('#btn-menu'),
    exit: $('#btn-exit'), next: $('#btn-next'), progress: $('#quiz-progress'), category: $('#quiz-category'), question: $('#quiz-question'),
    choices: $('#choices'), feedback: $('#feedback'), roundScore: $('#round-score'), roundReview: $('#round-review'), file: $('#file-input'),
    setName: $('#set-name'), historyBtn: $('#btn-history'), historyBack: $('#btn-history-back'), historyList: $('#history-list'),
    statsBtn: $('#btn-stats'), statsBack: $('#btn-stats-back'), statsList: $('#stats-list'),
    setSelector: $('#quiz-set-selector'), saveSetBtn: $('#btn-save-set')
  };

  // Audio feedback
  let audioCtx = null;
  function playTone(freq = 880, duration = 150, type = 'sine', gain = 0.04) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx; const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = type; osc.frequency.value = freq; g.gain.value = gain; osc.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime; osc.start(t);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + duration/1000);
      osc.stop(t + duration/1000 + 0.02);
    } catch {}
  }
  const playCorrect = () => playTone(1200, 160, 'triangle', 0.05);
  const playWrong = () => { playTone(300, 180, 'sawtooth', 0.05); setTimeout(()=>playTone(220, 180, 'sawtooth', 0.04), 120); };

  function getStats() {
    try { const s = JSON.parse(localStorage.getItem(KEYS.stats)) || {}; return {
      totalCorrect: s.totalCorrect || 0, totalQuestions: s.totalQuestions || 0, attemptsCount: s.attemptsCount || 0,
      attempts: Array.isArray(s.attempts) ? s.attempts : [], byId: s.byId || {}
    }; } catch { return { totalCorrect: 0, totalQuestions: 0, attemptsCount: 0, attempts: [], byId: {} }; }
  }
  function setStats(s) { localStorage.setItem(KEYS.stats, JSON.stringify(s)); }

  function getSelectedSet() { return localStorage.getItem(KEYS.selectedSet) || 'default'; }
  function setSelectedSet(name) { localStorage.setItem(KEYS.selectedSet, name); }

  function getCustomSets() {
    try { return JSON.parse(localStorage.getItem(KEYS.customSets)) || {}; }
    catch { return {}; }
  }
  function setCustomSets(sets) { localStorage.setItem(KEYS.customSets, JSON.stringify(sets)); }

  function updateMenuStats() {
    const s = getStats();
    els.total.textContent = `${s.totalCorrect} / ${s.totalQuestions}`;
    els.attempts.textContent = `${s.attemptsCount}`;
    const currentSet = allQuizSets[getSelectedSet()];
    els.setName.textContent = currentSet ? `現在: ${currentSet.name} (${currentSet.questions.length}問)` : '';
    const v = document.getElementById('version'); if (v) v.textContent = VERSION;
  }

  function shuffle(arr) { for (let i=arr.length-1; i>0; i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
  function show(screen){ Object.values(screens).forEach(s=>s.classList.remove('active')); screens[screen].classList.add('active'); }

  // YAML parser
  function parseYAML(text){
    const lines = text.split('\n');
    const questions = [];
    let currentQuestion = null;
    let inChoices = false;

    for (let line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith('#')) continue;

      // Check for new question
      if (trimmedLine.startsWith('- id:')) {
        if (currentQuestion) {
          questions.push(currentQuestion);
        }
        currentQuestion = {};
        currentQuestion.id = parseInt(trimmedLine.split(':')[1].trim());
        inChoices = false;
      } else if (currentQuestion) {
        if (line.match(/^\s+category:/)) {
          currentQuestion.category = trimmedLine.substring(9).trim();
        } else if (line.match(/^\s+question:/)) {
          currentQuestion.question = trimmedLine.substring(9).trim();
        } else if (line.match(/^\s+choices:/)) {
          currentQuestion.choices = [];
          inChoices = true;
        } else if (line.match(/^\s+answer:/)) {
          currentQuestion.answer = parseInt(trimmedLine.split(':')[1].trim());
          inChoices = false;
        } else if (line.match(/^\s+explanation:/)) {
          currentQuestion.explanation = trimmedLine.substring(12).trim();
          inChoices = false;
        } else if (inChoices && trimmedLine.startsWith('-')) {
          currentQuestion.choices.push(trimmedLine.substring(1).trim());
        }
      }
    }

    if (currentQuestion) {
      questions.push(currentQuestion);
    }

    return { questions };
  }

  function normalizeData(data){
    const list = Array.isArray(data)?data:data?.questions;
    if(!Array.isArray(list)) throw new Error('不正なデータ形式: questions 配列が見つかりません');
    return list.map((q,i)=>({
      id: q.id ?? (i+1),
      category: q.category || '一般',
      question: String(q.question || q.text),
      choices: Array.from(q.choices || q.options || []).map(String),
      answer: Number(q.answer ?? q.correctIndex ?? q.correct),
      explanation: q.explanation?String(q.explanation):''
    }));
  }

  async function loadFromFile(file){
    const text=await file.text();
    const name=file.name.toLowerCase();
    let data;
    if(name.endsWith('.json')) data=JSON.parse(text);
    else if(name.endsWith('.yml')||name.endsWith('.yaml')) data=parseYAML(text);
    else throw new Error('未対応の拡張子です');
    const list=normalizeData(data);
    if(!list.length) throw new Error('問題がありません');

    // カスタムセットとして保存
    const customSets = getCustomSets();
    const setId = `custom_${Date.now()}`;
    customSets[setId] = {
      name: file.name,
      questions: list
    };
    setCustomSets(customSets);

    // 全セットに追加
    allQuizSets[setId] = {
      name: file.name,
      questions: list
    };

    // セレクタを更新
    updateSetSelector();

    // 新しいセットを選択
    els.setSelector.value = setId;
    selectQuizSet(setId);
  }

  // Default minimal questions
  const DEFAULT_QUESTIONS=[
    {id:1,category:'テスト',question:'YAMLファイルを読み込んでください',choices:['はい','いいえ','わからない','読み込み済み'],answer:0},
  ];

  // 全問題セット - quiz-data.jsから読み込み
  let allQuizSets = {};

  // 起動時に問題セットを初期化
  function loadBuiltinSets() {
    // QUIZ_DATAはquiz-data.jsで定義されている
    if (typeof QUIZ_DATA !== 'undefined') {
      allQuizSets = { ...QUIZ_DATA };
      console.log('Loaded quiz sets:', Object.keys(allQuizSets));
    } else {
      // フォールバック
      allQuizSets = {
        default: {
          name: 'デフォルト（テスト用）',
          questions: DEFAULT_QUESTIONS
        }
      };
    }

    // カスタムセットを復元
    const customSets = getCustomSets();
    for (const [id, set] of Object.entries(customSets)) {
      allQuizSets[id] = set;
    }

    // セレクタを更新
    updateSetSelector();

    // 保存されているセットを選択
    const savedSet = getSelectedSet();
    if (allQuizSets[savedSet]) {
      els.setSelector.value = savedSet;
      selectQuizSet(savedSet);
    } else {
      // 最初のセットを選択
      const firstSetId = Object.keys(allQuizSets)[0];
      if (firstSetId) {
        els.setSelector.value = firstSetId;
        selectQuizSet(firstSetId);
      }
    }
  }

  function updateSetSelector() {
    els.setSelector.innerHTML = '';

    // 組み込みセット
    const builtinSets = Object.entries(allQuizSets)
      .filter(([id]) => !id.startsWith('custom_'))
      .sort(([,a], [,b]) => a.name.localeCompare(b.name));

    if (builtinSets.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = '組み込み問題セット';
      builtinSets.forEach(([id, set]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `${set.name} (${set.questions.length}問)`;
        optgroup.appendChild(option);
      });
      els.setSelector.appendChild(optgroup);
    }

    // カスタムセット
    const customSets = Object.entries(allQuizSets)
      .filter(([id]) => id.startsWith('custom_'))
      .sort(([,a], [,b]) => a.name.localeCompare(b.name));

    if (customSets.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = '読み込んだ問題セット';
      customSets.forEach(([id, set]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = `${set.name} (${set.questions.length}問)`;
        optgroup.appendChild(option);
      });
      els.setSelector.appendChild(optgroup);
    }
  }

  function selectQuizSet(setId) {
    const set = allQuizSets[setId];
    if (!set) return;

    questionBank = set.questions.slice();
    setSelectedSet(setId);
    updateMenuStats();
  }

  let questionBank = DEFAULT_QUESTIONS.slice();
  let currentRound = []; let idx = 0; let correctCount = 0; let answered = false; let advanceTimer = null; let roundLog = [];
  function clearAdvanceTimer(){ if(advanceTimer){ clearTimeout(advanceTimer); advanceTimer=null; } }

  function canonicalKey(q){ return (q && q.id!=null) ? `id:${q.id}` : `q:${q?.question ?? ''}`; }

  function startRound() {
    currentRound = shuffle(questionBank.slice()).slice(0, ROUND_SIZE);
    idx = 0; correctCount = 0; roundLog = []; show('quiz'); showQuestion();
  }

  function showQuestion() {
    const q = currentRound[idx]; els.progress.textContent = `${idx + 1} / ${ROUND_SIZE}`;
    els.category.textContent = q.category || '一般'; els.question.textContent = q.question;
    els.choices.innerHTML = shuffle(q.choices.map((c,i)=>({text:c,idx:i}))).map(c=>`<button class="choice" data-idx="${c.idx}">${c.text}</button>`).join('');
    els.feedback.innerHTML = ''; els.next.disabled = true; answered = false; clearAdvanceTimer();
  }

  function selectAnswer(btnEl, selectedIdx) {
    if (answered) return;
    const q = currentRound[idx]; const correct = selectedIdx === q.answer; answered = true;
    document.querySelectorAll('.choice').forEach(btn => { btn.classList.remove('selected'); btn.disabled = true; });
    btnEl.classList.add('selected'); els.next.disabled = false;
    roundLog.push({ question: q, selectedIdx, correct });

    setTimeout(() => {
      document.querySelectorAll('.choice').forEach(btn => {
        if (parseInt(btn.dataset.idx) === q.answer) { btn.classList.add('correct'); }
        else if (btn === btnEl) { btn.classList.add('wrong'); }
      });
      els.feedback.innerHTML = correct ?
        `<div class="ok">正解！${q.explanation ? ` ${q.explanation}` : ''}</div>` :
        `<div class="ng">不正解！${q.explanation ? ` ${q.explanation}` : ''}</div>`;
      correct ? (correctCount++, playCorrect()) : playWrong();
      clearAdvanceTimer(); advanceTimer = setTimeout(() => nextQuestion(), 3000);
    }, 200);

    // 統計を更新
    const s = getStats(); const key = canonicalKey(q);
    if (!s.byId[key]) s.byId[key] = { correct: 0, total: 0, q: q.question, category: q.category };
    s.byId[key].total++; if (correct) s.byId[key].correct++;
    s.totalQuestions++; if (correct) s.totalCorrect++;
    setStats(s);
  }

  function nextQuestion() {
    clearAdvanceTimer(); idx++;
    if (idx >= ROUND_SIZE) { showResult(); } else { showQuestion(); }
  }

  function showResult() {
    show('result'); els.roundScore.innerHTML = `<strong>${correctCount}</strong> / ${ROUND_SIZE} 問正解`;
    const s = getStats(); s.attemptsCount++; s.attempts.unshift({ date: new Date().toISOString(), correct: correctCount, total: ROUND_SIZE, setName: allQuizSets[getSelectedSet()]?.name || 'Unknown' });
    if (s.attempts.length > 200) s.attempts.length = 200; setStats(s);

    els.roundReview.innerHTML = roundLog.map((log, i) => {
      const q = log.question; const mark = log.correct ? '○' : '×';
      return `<div class="review-item ${log.correct?'correct':'wrong'}">
        <div class="q-num">${i+1}. ${mark}</div>
        <div class="q-text">${q.question}</div>
        <div class="q-ans">正解: ${q.choices[q.answer]}</div>
        ${!log.correct ? `<div class="q-selected">あなた: ${q.choices[log.selectedIdx]}</div>` : ''}
        ${q.explanation ? `<div class="q-exp">${q.explanation}</div>` : ''}
      </div>`;
    }).join('');

    updateMenuStats();
  }

  // 初期化
  window.addEventListener('DOMContentLoaded', () => {
    // 組み込みセットを読み込む（同期処理に変更）
    loadBuiltinSets();

    updateMenuStats();

    // イベントリスナー
    els.start.addEventListener('click', startRound);
    els.again.addEventListener('click', startRound);
    els.menu.addEventListener('click', () => { clearAdvanceTimer(); show('menu'); updateMenuStats(); });
    els.exit.addEventListener('click', () => { clearAdvanceTimer(); show('menu'); updateMenuStats(); });
    els.next.addEventListener('click', nextQuestion);
    els.choices.addEventListener('click', (e) => { if (e.target.classList.contains('choice')) selectAnswer(e.target, parseInt(e.target.dataset.idx)); });

    // セット選択
    els.setSelector.addEventListener('change', (e) => {
      selectQuizSet(e.target.value);
    });

    // セット保存ボタン
    els.saveSetBtn.addEventListener('click', () => {
      const selectedSet = getSelectedSet();
      setSelectedSet(selectedSet);
      alert('現在のセットをデフォルトとして保存しました');
    });

    // ファイル読み込み
    els.file.addEventListener('change', async (e)=>{
      const file=e.target.files?.[0];
      if(!file) return;
      try{
        await loadFromFile(file);
        alert('問題セットを読み込みました');
      } catch(err){
        console.error(err);
        alert('読み込みエラー: '+(err?.message||err));
      } finally {
        e.target.value='';
      }
    });

    els.historyBtn.addEventListener('click', () => {
      const s = getStats();
      els.historyList.innerHTML = s.attempts.length ?
        s.attempts.map(a => `<div class="history-item">
          <span>${new Date(a.date).toLocaleString('ja-JP', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
          <span>${a.correct}/${a.total}</span>
          <span class="muted">${a.setName || ''}</span>
        </div>`).join('') :
        '<div class="muted">まだ履歴がありません</div>';
      show('history');
    });
    els.historyBack.addEventListener('click', () => show('menu'));

    els.statsBtn.addEventListener('click', () => {
      const s = getStats(); const sorted = Object.entries(s.byId).sort((a,b) => b[1].total - a[1].total);
      els.statsList.innerHTML = sorted.length ?
        sorted.map(([key, d]) => {
          const rate = d.total > 0 ? Math.round(100 * d.correct / d.total) : 0;
          const className = rate >= 80 ? 'high' : rate >= 50 ? 'mid' : 'low';
          return `<div class="stat-item">
            <div class="stat-q">${d.q}</div>
            <div class="stat-info">
              <span class="stat-cat">${d.category}</span>
              <span class="stat-rate ${className}">${rate}%</span>
              <span class="stat-count">(${d.correct}/${d.total})</span>
            </div>
          </div>`;
        }).join('') :
        '<div class="muted">まだ統計データがありません</div>';
      show('stats');
    });
    els.statsBack.addEventListener('click', () => show('menu'));
  });
})();