//  State 
let currentDeckId = null, currentCardIndex = 0;
let editingDeckId = null, editingCardId = null;
let cards = [], isFlipped = false;
let allDecks = [];
let activeFilter = 'All';
let selectedType = 'basic'; // Default state is basic
let quizMode = false;
let quizAnswered = false;
let mcqFlipped = false;
let quizScore = 0;
let quizTotalAnswer = 0;
let wrongCardIndices = [];
let fullDeckCards = [];
let answeredCardIndices = new Set();
let reachedEnd = false;
let unansweredQueue = [];
const shuffledDeckIds = new Set(JSON.parse(localStorage.getItem('shuffledDecks') || '[]'));

// prevents crash on loading decks
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// category stuff
function categorySplit(category) {
  if (!category) return [];
  return category
  .split(',')
  .map(c => c.trim().toLowerCase())
  .filter(Boolean);
}

let selectedDeckCategories = []

function fillCategorySuggestion() {
  // Called on modal open — just ensure suggestions are hidden initially
  document.getElementById('category-suggestions')?.classList.add('hidden');
}

function showCategorySuggestions() {
  const input = document.getElementById('deck-category-input');
  const list  = document.getElementById('category-suggestions');
  if (!input || !list) return;

  const query = input.value.trim().toLowerCase();
  const all   = [...new Set(allDecks.flatMap(d => categorySplit(d.category)))];
  const matches = query
    ? all.filter(c => c.includes(query) && !selectedDeckCategories.includes(c))
    : all.filter(c => !selectedDeckCategories.includes(c));

  if (!matches.length) { list.classList.add('hidden'); return; }

  list.innerHTML = matches.map(c => `
    <li onclick="selectCategorySuggestion('${esc(c)}')"
      class="px-3.5 py-2 cursor-pointer hover:bg-stone-50 text-stone-700">${esc(c)}</li>`
  ).join('');
  list.classList.remove('hidden');
}

function selectCategorySuggestion(cat) {
  document.getElementById('deck-category-input').value = cat;
  document.getElementById('category-suggestions').classList.add('hidden');
  addCatToDeck();
}

// Hide suggestions when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('#deck-modal')) {
    document.getElementById('category-suggestions')?.classList.add('hidden');
  }
});

function updateCategoryPreview() {
  const preview = document.getElementById('deck-category-preview');
  if (!preview) return;

  if (!selectedDeckCategories.length) {
    preview.innerHTML = 'No categories selected';
    return;
  }

  preview.innerHTML = selectedDeckCategories.map(category => `<span class="inline-flex items-center gap-1 text-xs font-medium bg-stone-100 text-stone-600 px-2.5 py-1 rounded-full"> ${esc(category)}
      <button type="button" onclick="removeCatFromDeck('${esc(category)}')" class="text-stone-400 hover:text-red-500 font-bold"> × </button>
    </span> `).join('');
}

function addCatToDeck() {
  const input = document.getElementById('deck-category-input');
  if (!input) return;

  const category = input.value.trim().toLowerCase();

  if (!category) return;

  if (!selectedDeckCategories.includes(category)) {
    selectedDeckCategories.push(category);
  }

  input.value = '';
  updateCategoryPreview();
}

function removeCatFromDeck(category) {
  selectedDeckCategories = selectedDeckCategories.filter(c => c !== category);
  updateCategoryPreview();
}

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Not logged in');
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

//  Pop Up 
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

//  Views 
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function goHome() { quizMode = false; document.getElementById('card-action-btns')?.classList.remove('hidden'); showView('home-view'); loadDecks(); }

//  Home
async function loadDecks() {
  allDecks = await api('GET', '/decks');
  renderFilters();
  searchDecks();
}

function renderFilters() {
  const categories = ['All', ...new Set(allDecks.flatMap(d => categorySplit(d.category)))];
  const pills = document.getElementById('filter-pills');
  pills.innerHTML = categories.map(cat => `
    <button onclick="setFilter('${esc(cat)}')"
      class="px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
        activeFilter === cat
          ? 'bg-stone-900 text-white border-stone-900'
          : 'bg-white text-stone-700 border-stone-200 hover:border-stone-400'
      }">
      ${esc(cat)}
    </button>`).join('');
  // Keep pills visible
  pills.style.display = 'flex';
}

function setFilter(cat) {
  activeFilter = cat;
  renderFilters();
  renderGrid();
}

function renderGrid(decks = null) {
  const filtered = decks || (activeFilter === 'All'
    ? allDecks
    : allDecks.filter(d => categorySplit(d.category).includes(activeFilter)));

  const grid = document.getElementById('deck-grid');

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="col-span-3 flex flex-col items-center py-20 text-stone-300">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" class="mb-4">
          <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M8 4v16M16 4v16"/>
        </svg>
        <p class="text-sm">No decks found.</p>
      </div>`;
    // Keep pills visible
    const pills = document.getElementById('filter-pills');
    if (pills.children.length) pills.style.display = 'flex';
    return;
  }

  // Using innerHTML or use display: none :thinking:

    grid.innerHTML = filtered.map(d => `
      <div class="bg-white border border-stone-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
      <div class="flex items-start justify-between">
        <h3 class="font-bold text-lg leading-tight break-words whitespace-normal overflow-hidden">
          ${esc(d.title)}
        </h3>
        <button onclick="openDeckQuiz('${d.id}')" title="Start quiz mode"
          class="w-9 h-9 flex items-center justify-center rounded-lg text-stone-300 hover:text-stone-600 hover:bg-stone-100 transition-colors shrink-0 -mt-1 -mr-1">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
          </svg>
        </button>
      </div>
      ${categorySplit(d.category).length ? `<div class="flex flex-wrap gap-1"> ${categorySplit(d.category).map(category =>
        `<span class="inline-block text-xs font-medium bg-stone-100 text-stone-600 px-2.5 py-1 rounded-full"> ${esc(category)} </span> `).join('')} </div>` : '<span></span>' }
      <div class="flex items-center justify-between mt-auto pt-2">
        <span class="text-sm text-stone-400">${d.cardCount} card${d.cardCount !== 1 ? 's' : ''}</span>
        <div class="flex items-center gap-1">
          <button onclick="openEditDeckModal(this.dataset.id, this.dataset.title, this.dataset.category)"
            data-id="${esc(d.id)}" data-title="${esc(d.title)}" data-category="${esc(d.category||'')}"
            class="w-8 h-8 flex items-center justify-center rounded-lg text-stone-300 hover:text-stone-600 hover:bg-stone-100 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button onclick="deleteDeck('${d.id}')"
            class="w-8 h-8 flex items-center justify-center rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
          <button onclick="shareDeck('${d.id}')"
            class="w-8 h-8 flex items-center justify-center rounded-lg text-stone-300 hover:text-stone-600 hover:bg-stone-100 transition-colors"
            title="Share deck">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
          <button onclick="toggleShuffle('${d.id}')"
            title="${shuffledDeckIds.has(d.id) ? 'Shuffle on — click to disable' : 'Shuffle off — click to enable'}"
            class="w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${shuffledDeckIds.has(d.id) ? 'shuffle-selected text-stone-700 bg-stone-200 hover:text-stone-900 hover:bg-stone-300' : 'text-stone-300 hover:text-stone-600 hover:bg-stone-100'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>
            </svg>
          </button>
          <button onclick="openDeck('${d.id}')"
            class="px-4 py-1.5 bg-stone-900 text-white text-sm font-semibold rounded-xl hover:bg-stone-700 transition-colors">
            Study
          </button>
        </div>
      </div>
      </div>`).join('');
}

//  Deck Modal 
function openNewDeckModal() {
  editingDeckId = null;
  selectedDeckCategories = [];
  document.getElementById('deck-modal-title').textContent = 'New Deck';
  document.getElementById('deck-title-input').value = '';
  document.getElementById('deck-category-input').value = '';
  fillCategorySuggestion();
  updateCategoryPreview();
  openModal('deck-modal');
  setTimeout(() => document.getElementById('deck-title-input').focus(), 120);
}

function openEditDeckModal(id, title, category) {
  editingDeckId = id;
  selectedDeckCategories = categorySplit(category || '');
  document.getElementById('deck-modal-title').textContent = 'Edit Deck';
  document.getElementById('deck-title-input').value = title;
  document.getElementById('deck-category-input').value = '';
  fillCategorySuggestion();
  updateCategoryPreview();
  openModal('deck-modal');
  setTimeout(() => document.getElementById('deck-title-input').focus(), 120);
}

function closeDeckModal() { closeModal('deck-modal'); }

async function saveDeck() {
  const title = document.getElementById('deck-title-input').value.trim();
  const categoryInput = document.getElementById('deck-category-input').value.trim().toLowerCase();

  if (categoryInput && !selectedDeckCategories.includes(categoryInput)) {
    selectedDeckCategories.push(categoryInput);
  }
  
  const category = selectedDeckCategories.join(', ');

  if (!title) return;
  if (editingDeckId) {
    await api('PUT', `/decks/${editingDeckId}`, { title, category });
    showToast('Deck updated ✓');
  } else {
    await api('POST', '/decks', { title, category });
    showToast('Deck created ✓');
  }
  closeDeckModal();
  loadDecks();
}

async function deleteDeck(id) {
  if (!confirm('Delete this deck and all its cards?')) return;
  await api('DELETE', `/decks/${id}`);
  shuffledDeckIds.delete(id);
  localStorage.setItem('shuffledDecks', JSON.stringify([...shuffledDeckIds]));
  showToast('Deck deleted');
  loadDecks();
}

function toggleShuffle(deckId) {
  if (shuffledDeckIds.has(deckId)) {
    shuffledDeckIds.delete(deckId);
  } else {
    shuffledDeckIds.add(deckId);
  }
  localStorage.setItem('shuffledDecks', JSON.stringify([...shuffledDeckIds]));
  renderGrid();
}

//  Share
async function shareDeck(deckId) {
  const deck = allDecks.find(d => d.id === deckId);
  if (deck && deck.cardCount === 0) { showToast('Add cards before sharing'); return; }
  try {
    const { token } = await api('POST', `/decks/${deckId}/share`);
    const url = `${window.location.origin}/?token=${encodeURIComponent(token)}`;
    document.getElementById('share-url-input').value = url;
    openModal('share-modal');
    setTimeout(() => {
      const input = document.getElementById('share-url-input');
      input.focus();
      input.select();
    }, 120);
  } catch (err) {
    console.error('Share failed:', err);
    showToast('Failed to create share link');
  }
}

function closeShareModal() { closeModal('share-modal'); }

async function copyShareLink() {
  const input = document.getElementById('share-url-input');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  showToast('Link copied ✓');
  closeShareModal();
}

//  Study 
async function openDeck(deckId) {
  currentDeckId = deckId;
  currentCardIndex = 0;
  const deck = await api('GET', `/decks/${deckId}`);
  cards = deck.cards;
  if (shuffledDeckIds.has(deckId)) {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
  }
  document.getElementById('study-title').textContent = deck.title;
  renderStudyView();
  showView('study-view');
}

async function openDeckQuiz(deckId) {
  const deck = allDecks.find(d => d.id === deckId);
  if (deck && deck.cardCount === 0) { showToast('Add cards to enable quiz mode'); return; }
  quizMode = true;
  quizScore = 0;
  quizTotalAnswer = 0;
  wrongCardIndices = [];
  answeredCardIndices = new Set();
  reachedEnd = false;
  unansweredQueue = [];
  document.getElementById('card-action-btns')?.classList.add('hidden');
  await openDeck(deckId);
  fullDeckCards = [...cards]; // snapshot full deck after load
}

function renderStudyView() {
  const has = cards.length > 0;
  document.getElementById('study-content').style.display = has ? '' : 'none';
  document.getElementById('no-cards').classList.toggle('hidden', has);
  if (!has) {
    document.getElementById('card-counter').textContent = '0 cards';
    document.getElementById('progress-fill').style.width = '0%';
    return;
  }
  if (currentCardIndex >= cards.length) currentCardIndex = cards.length - 1;
  if (currentCardIndex < 0) currentCardIndex = 0;

  const card = cards[currentCardIndex];
  const isMcq = card.cardType === 'multiple_choice';

  document.getElementById('card-counter').textContent = `Card ${currentCardIndex + 1} of ${cards.length}`;
  document.getElementById('progress-fill').style.width = `${((currentCardIndex + 1) / cards.length) * 100}%`;

  // On the last card in quiz mode, detect skipped cards and enter unanswered mode
  if (quizMode && !reachedEnd && currentCardIndex === cards.length - 1) {
    const unanswered = cards.map((_, i) => i).filter(i => !answeredCardIndices.has(i));
    const skippedOthers = unanswered.filter(i => i !== currentCardIndex);
    if (skippedOthers.length > 0) {
      reachedEnd = true;
      unansweredQueue = [...unanswered]; // includes current card so it's tracked
      updateUnansweredLabel();
    }
  }

  if (reachedEnd && unansweredQueue.length > 0) {
    const lockedOnLast = unansweredQueue.length === 1 && currentCardIndex === unansweredQueue[0];
    document.getElementById('prev-btn').disabled = lockedOnLast;
    document.getElementById('next-btn').disabled = lockedOnLast;
  } else {
    document.getElementById('prev-btn').disabled = currentCardIndex === 0;
    document.getElementById('next-btn').disabled = currentCardIndex === cards.length - 1;
  }

  const flipWrapper = document.getElementById('flashcard-inner')?.closest('[style*="perspective"]');
  const mcqView    = document.getElementById('mcq-view');
  const quizWidget = document.getElementById('quiz-widget');

  flipWrapper?.classList.add('hidden');
  mcqView?.classList.add('hidden');
  quizWidget?.classList.add('hidden');

  if (isMcq && quizMode && quizWidget) {
    // MCQ in quiz mode — interactive quiz widget
    quizWidget.classList.remove('hidden');
    quizAnswered = false;
    renderQuizWidget(card);
  } else if (isMcq && mcqView) {
    // MCQ in browse mode — flip card showing choices on back
    mcqView.classList.remove('hidden');
    mcqFlipped = false;
    mcqView.querySelector('.mcq-card')?.classList.remove('mcq-card--flipped');
    renderMcqView(card);
  } else {
    // Basic card — always flip card, self-assess buttons shown on back in quiz mode
    flipWrapper?.classList.remove('hidden');
    document.getElementById('card-question').textContent = card.question;
    document.getElementById('card-answer').textContent = card.answer;
    isFlipped = false;
    document.getElementById('flashcard-inner').style.transform = 'rotateY(0deg)';
    document.getElementById('self-assess-btns')?.classList.add('hidden');
  }
}

function renderMcqView(card) {
  document.getElementById('mcq-question').textContent = card.question;
  const labels = 'ABCDE';
  const display = document.getElementById('mcq-choices-display');
  display.innerHTML = '';
  card.choices.forEach((ch, i) => {
    const item = document.createElement('div');
    item.className = 'mcq-choice-item' + (ch.isCorrect ? ' mcq-choice-item--correct' : '');
    item.innerHTML = `<span class="mcq-choice-item__letter">${labels[i] ?? i + 1}</span><span class="mcq-choice-item__text">${esc(ch.choiceText)}</span>`;
    display.appendChild(item);
  });
}

function flipMcqCard() {
  mcqFlipped = !mcqFlipped;
  document.getElementById('mcq-view').querySelector('.mcq-card').classList.toggle('mcq-card--flipped', mcqFlipped);
  if (mcqFlipped) playRandomSFX();
}

function renderQuizWidget(card) {
  document.getElementById('quiz-question').textContent = card.question;
  const feedback = document.getElementById('quiz-feedback');
  feedback.className = 'quiz-feedback hidden';
  feedback.textContent = ' ';
  const choicesEl = document.getElementById('quiz-choices');
  choicesEl.innerHTML = '';
  const labels = 'ABCDE';
  card.choices.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-choice-btn';
    btn.innerHTML = `<span class="quiz-choice-btn__letter">${labels[i] ?? i + 1}</span>${esc(ch.choiceText)}`;
    btn.onclick = () => answerQuiz(card, i);
    choicesEl.appendChild(btn);
  });
}

function showQuizScorePopup() {
  const percent = Math.round((quizScore / quizTotalAnswer) * 100);
  document.getElementById('quiz-score-text').textContent =
    `Final Score: ${quizScore}/${quizTotalAnswer} (${percent}%)`;
  // Only show Retest Wrong if there are wrong answers
  const retestWrongBtn = document.getElementById('retest-wrong-btn');
  if (retestWrongBtn) retestWrongBtn.classList.toggle('hidden', wrongCardIndices.length === 0);
  const popup = document.getElementById('quiz-score-popup');
  popup.classList.remove('hidden');
  popup.classList.add('flex');
}

function closeQuizScorePopup() {
  const popup = document.getElementById('quiz-score-popup');
  popup.classList.add('hidden');
  popup.classList.remove('flex');
}

function restartQuiz(wrongOnly = false) {
  closeQuizScorePopup();
  if (wrongOnly && wrongCardIndices.length > 0) {
    cards = [...wrongCardIndices];
  } else {
    cards = [...fullDeckCards];
  }
  quizScore = 0;
  quizTotalAnswer = 0;
  wrongCardIndices = [];
  answeredCardIndices = new Set();
  reachedEnd = false;
  unansweredQueue = [];
  currentCardIndex = 0;
  document.getElementById('quiz-unanswered-label')?.classList.add('hidden');
  renderStudyView();
}

function answerQuiz(card, selectedIndex) {
  if (quizAnswered) return;
  quizAnswered = true;
  const buttons = document.querySelectorAll('.quiz-choice-btn');
  buttons.forEach((btn, i) => {
    btn.onclick = null;
    if (card.choices[i].isCorrect) {
      btn.classList.add('quiz-choice-btn--correct');
    } else if (i === selectedIndex) {
      btn.classList.add('quiz-choice-btn--wrong');
    } else {
      btn.classList.add('quiz-choice-btn--dimmed');
    }
  });
  const correct = card.choices[selectedIndex].isCorrect;
  if (correct) quizScore++;
  else wrongCardIndices.push(cards[currentCardIndex]);
  quizTotalAnswer++;
  answeredCardIndices.add(currentCardIndex);
  const feedback = document.getElementById('quiz-feedback');
  feedback.classList.remove('hidden');
  if (correct) {
    feedback.textContent = '✓ Correct!';
    feedback.className = 'quiz-feedback quiz-feedback--correct';
  } else {
    const correctChoice = card.choices.find(c => c.isCorrect);
    feedback.textContent = `✗ The answer was ${correctChoice ? esc(correctChoice.choiceText) : '—'}`;
    feedback.className = 'quiz-feedback quiz-feedback--wrong';
  }
  playAnswerSFX(correct);

  if (reachedEnd) {
    unansweredQueue = unansweredQueue.filter(i => i !== currentCardIndex);
    updateUnansweredLabel();
    if (unansweredQueue.length === 0) {
      setTimeout(() => showQuizScorePopup(), 450);
    }
  } else if (quizTotalAnswer === cards.length) {
    setTimeout(() => showQuizScorePopup(), 450);
  }
}

function updateUnansweredLabel() {
  const label = document.getElementById('quiz-unanswered-label');
  if (!label) return;
  if (!reachedEnd) { label.classList.add('hidden'); return; }
  const remaining = unansweredQueue.length;
  label.textContent = `${remaining} question${remaining !== 1 ? 's' : ''} remaining`;
  label.classList.toggle('hidden', remaining === 0);
}

function navigateUnanswered(direction) {
  if (!unansweredQueue.length) return;
  if (unansweredQueue.length === 1) {
    // Navigate to the only remaining card if not already on it
    if (currentCardIndex !== unansweredQueue[0]) {
      currentCardIndex = unansweredQueue[0];
      renderStudyView();
    }
    return;
  }
  if (direction === 'next') {
    const next = unansweredQueue.find(i => i > currentCardIndex) ?? unansweredQueue[0];
    currentCardIndex = next;
  } else {
    const prev = [...unansweredQueue].reverse().find(i => i < currentCardIndex)
      ?? unansweredQueue[unansweredQueue.length - 1];
    currentCardIndex = prev;
  }
  renderStudyView();
}

function toggleQuizMode() {
  quizMode = !quizMode;
  document.getElementById('card-action-btns')?.classList.toggle('hidden', quizMode);
  renderStudyView();
}

// Sound effects library file inventory mapping
const SFX_FILES = [
  "wooshlong1.wav",
  "wooshshort1.wav",
  "wooshshort2.wav",
  "wooshshortdash6.wav",
  "wooshshortdash7.wav",
  "wooshshortdash8.wav",
];


function playRandomSFX() {
      if (!SFX_FILES.length) return;
      const randomFile = SFX_FILES[Math.floor(Math.random() * SFX_FILES.length)];
      const sfxPath = `/audio/${randomFile}`;
      const effectAudio = new Audio(sfxPath);
      
      // Tied to existing sfxVolume slider tracker variable
      if (typeof sfxVolume === 'number') {
        effectAudio.volume = sfxVolume;
      }
      effectAudio.play().catch(e => console.log("SFX blocked or missing:", e));
    }

function playAnswerSFX(isCorrect) {
      const soundFile = isCorrect ? "right.mp3" : "wrong.mp3";
      const effectAudio = new Audio(`/audio/${soundFile}`);
      
      if (typeof sfxVolume === 'number') {
        effectAudio.volume = sfxVolume;
      }
      effectAudio.play().catch(e => console.log("SFX blocked or missing:", e));
    }

function flipCard() {
  isFlipped = !isFlipped;
  document.getElementById('flashcard-inner').style.transform = isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';
  // Show self-assessment buttons on back only for basic cards in quiz mode
  const card = cards[currentCardIndex];
  const isBasic = !card || card.cardType === 'basic';
  const assessBtns = document.getElementById('self-assess-btns');
  if (assessBtns) {
    assessBtns.classList.toggle('hidden', !(isFlipped && quizMode && isBasic));
  }
  playRandomSFX();
}

const flipPreviewCard = flipCard;

function selfAssess(correct) {
  if (correct) quizScore++;
  else wrongCardIndices.push(cards[currentCardIndex]);
  quizTotalAnswer++;
  answeredCardIndices.add(currentCardIndex);
  playAnswerSFX(correct);
  if (reachedEnd) {
    unansweredQueue = unansweredQueue.filter(i => i !== currentCardIndex);
    updateUnansweredLabel();
    if (unansweredQueue.length === 0) {
      setTimeout(() => showQuizScorePopup(), 450);
    } else {
      setTimeout(() => navigateUnanswered('next'), 400);
    }
  } else if (quizTotalAnswer === cards.length) {
    setTimeout(() => showQuizScorePopup(), 450);
  } else {
    setTimeout(() => navigateCards('next'), 400);
  }
}
// function prevCard() { if (currentCardIndex > 0) { currentCardIndex--; renderStudyView(); } playRandomSFX()}
// function nextCard() { if (currentCardIndex < cards.length - 1) { currentCardIndex++; renderStudyView(); }  playRandomSFX()}

function navigateCards(direction) {
  // In unanswered mode, delegate to navigateUnanswered
  if (reachedEnd && unansweredQueue.length > 0) {
    navigateUnanswered(direction);
    return;
  }

  const cardElement = document.getElementById('flashcard-inner');
  const mcqCard = document.querySelector('#mcq-view .mcq-card');

  cardElement.style.transition = 'none';
  cardElement.style.transform = 'rotateY(0deg)';
  isFlipped = false;

  if (mcqCard) {
    mcqCard.querySelectorAll('.mcq-card__front, .mcq-card__back').forEach(face => {
      face.style.transition = 'none';
    });
    mcqCard.classList.remove('mcq-card--flipped');
    mcqFlipped = false;
  }

  if (direction === 'next') {
    if (currentCardIndex < cards.length - 1) {
      currentCardIndex++;
    } else if (quizMode) {
      // Reached the end — check for unanswered cards
      const unanswered = cards.map((_, i) => i).filter(i => !answeredCardIndices.has(i));
      if (unanswered.length > 0) {
        reachedEnd = true;
        unansweredQueue = [...unanswered];
        updateUnansweredLabel();
        currentCardIndex = unansweredQueue[0];
      }
    }
  } else {
    if (currentCardIndex > 0) currentCardIndex--;
  }

  renderStudyView();
  playRandomSFX();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cardElement.style.transition = '';
      if (mcqCard) {
        mcqCard.querySelectorAll('.mcq-card__front, .mcq-card__back').forEach(face => {
          face.style.transition = '';
        });
      }
    });
  });
}

//  Card Modal 
function openAddCardModal() {
  editingCardId = null;
  selectedType = 'basic';
  document.getElementById('card-modal-title').textContent = 'Add Card';
  document.getElementById('card-question-input').value = '';
  document.getElementById('card-answer-input').value = '';
  document.querySelectorAll('.type-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('choices-list').innerHTML = '';
  cachedMcqChoices = [];
  toggleUISections('basic');
  openModal('card-modal');
  setTimeout(() => document.getElementById('card-question-input').focus(), 120);
}

function openEditCardModal() {
  if (!cards.length) return;
  const c = cards[currentCardIndex];
  editingCardId = c.id;
  document.getElementById('card-modal-title').textContent = 'Edit Card';
  document.getElementById('card-question-input').value = c.question;
  document.getElementById('card-answer-input').value = c.answer;

  // Detect T/F: multiple_choice with exactly the choices 'true' and 'false' (lowercase)
  const choiceTexts = c.choices.map(ch => ch.choiceText);
  const isTrueFalse = c.cardType === 'multiple_choice' &&
    c.choices.length === 2 &&
    choiceTexts.includes('true') && choiceTexts.includes('false');

  const logicalType = isTrueFalse ? 'true_false' : (c.cardType || 'basic');
  selectedType = logicalType;
  cachedMcqChoices = []; // clear cache when opening a card for editing

  // Activate the correct type button
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === logicalType);
  });

  // Call toggleUISections first (it seeds blank rows), then overwrite with real card data
  toggleUISections(logicalType);

  if (logicalType === 'multiple_choice') {
    document.getElementById('choices-list').innerHTML = '';
    c.choices.forEach(ch => addChoiceRow(ch.choiceText, ch.isCorrect));
  } else if (logicalType === 'true_false') {
    document.getElementById('choices-list').innerHTML = '';
    const trueChoice  = c.choices.find(ch => ch.choiceText === 'true');
    const falseChoice = c.choices.find(ch => ch.choiceText === 'false');
    addChoiceRow('true',  trueChoice?.isCorrect  ?? false, { label: 'True',  locked: true });
    addChoiceRow('false', falseChoice?.isCorrect ?? false, { label: 'False', locked: true });
  }

  openModal('card-modal');
  setTimeout(() => document.getElementById('card-question-input').focus(), 120);
}

function closeCardModal() { closeModal('card-modal'); }

async function saveCard() {
  const question = document.getElementById('card-question-input').value.trim();
  const isMcqLike = selectedType === 'multiple_choice' || selectedType === 'true_false';

  if (!question) {
    showToast("Please enter a question!");
    return;
  }

  let finalType = selectedType;
  let choices = [];
  let answer = document.getElementById('card-answer-input').value.trim();

  if (isMcqLike) {
    finalType = 'multiple_choice';
    const rows = document.querySelectorAll('#choices-list > div');
    rows.forEach(row => {
      const input = row.querySelector('.choice-text');
      // Locked T/F rows store lowercase in data-save-value; regular rows use the input value
      const text = input.dataset.saveValue ?? input.value;
      const correct = row.querySelector('.choice-checker')?.getAttribute('data-correct') === 'true';
      if (text.trim()) choices.push({ choiceText: text, isCorrect: correct });
    });
    // Derive answer from the correct choice (answer column is NOT NULL in DB)
    const correctChoice = choices.find(c => c.isCorrect);
    answer = correctChoice ? correctChoice.choiceText : (choices[0]?.choiceText ?? '');
  } else {
    if (!answer) {
      showToast("Please fill out both sides!");
      return;
    }
  }

  const data = {
    question,
    answer,
    card_type: finalType,
    choices
  };

  try {
    if (editingCardId) {
      await api('PUT', `/decks/${currentDeckId}/cards/${editingCardId}`, data);
      showToast("Card updated!");
    } else {
      await api('POST', `/decks/${currentDeckId}/cards`, data);
      showToast("Card created!");
    }

    const savedIndex = currentCardIndex; //save current index to return to after edit
    closeCardModal(); 
    
    await openDeck(currentDeckId) //reopen deck to refresh cards list and re-render study view with updated data
    if (editingCardId) { // If editing a card, return to saved index 
      currentCardIndex = savedIndex;} else {  
      currentCardIndex = cards.length - 1; // if adding new card, jump to end of list to see it
    }
    renderStudyView(); // Redraw the card and the buttons
    showToast("Card saved successfully");
    
  } catch (err) {
    console.error("Save failed:", err);
    showToast("Failed to save card");
  }
}

async function deleteCurrentCard() {
  if (!cards.length || !confirm('Delete this card?')) return;

  /* ==========================================
     CUSTOM AUDIO DELETE TRIGGER
     ========================================== */
  try {
    const deleteAudio = new Audio("/audio/goat.mp3");
    
    // Connects playback volume output directly to your active sfxVolume slider variable
    if (typeof sfxVolume === 'number') {
      deleteAudio.volume = sfxVolume;
    }
    
    deleteAudio.play().catch(e => console.log("Deletion audio blocked or missing:", e));
  } catch (err) {
    console.log("Audio track initialization error:", err);
  }

  // Restores your original database wipe routine and layout array splitting
  await api('DELETE', `/decks/${currentDeckId}/cards/${cards[currentCardIndex].id}`);
  cards.splice(currentCardIndex, 1);
  if (currentCardIndex >= cards.length && currentCardIndex > 0) currentCardIndex--;
  
  showToast('Card deleted');
  renderStudyView();
}

//  Modal helpers 
function openModal(id) {
  document.getElementById(id).classList.remove('opacity-0', 'pointer-events-none');
  const box = document.getElementById(id.replace('modal', 'modal-box'));
  if (box) box.classList.remove('translate-y-4');
}
function closeModal(id) {
  document.getElementById(id).classList.add('opacity-0', 'pointer-events-none');
  const box = document.getElementById(id.replace('modal', 'modal-box'));
  if (box) box.classList.add('translate-y-4');
}

//  Keyboard shortcuts 
document.addEventListener('keydown', e => {
  if (!document.getElementById('study-view').classList.contains('active')) return;
  if (!document.getElementById('deck-modal').classList.contains('pointer-events-none') ||
      !document.getElementById('card-modal').classList.contains('pointer-events-none')) return;
  if (e.key === 'ArrowRight') navigateCards('next');
  if (e.key === 'ArrowLeft') navigateCards('prev');
  if (e.key === ' ') { e.preventDefault(); flipCard(); }
});

['deck-modal', 'card-modal', 'share-modal'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target === document.getElementById(id)) closeModal(id);
  });
});

document.getElementById('deck-title-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveDeck();
});

//  Theme Palettes 
const THEMES = {
  light:  { label: 'Light'  },
  dark:   { label: 'Dark'   },
  ocean:  { label: 'Ocean'  },
  forest: { label: 'Forest' },
};

function setTheme(name) {
  if (!THEMES[name]) name = 'light';
  // Remove all theme attrs/classes from body and html
  document.body.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme');
  ['light','dark','ocean','forest'].forEach(t => {
    document.body.classList.remove('theme-' + t);
    document.documentElement.classList.remove('theme-' + t);
  });
  // Also remove legacy dark class
  document.body.classList.remove('dark');
  document.documentElement.classList.remove('dark');

  document.body.setAttribute('data-theme', name);
  document.documentElement.setAttribute('data-theme', name);
  document.body.classList.add('theme-' + name);
  if (name === 'dark') document.body.classList.add('dark'); // keep legacy dark compat

  localStorage.setItem('theme', name);

  // Update label
  const label = document.getElementById('theme-label');
  if (label) label.textContent = THEMES[name].label;

  // Highlight active swatch
  document.querySelectorAll('[data-theme-btn]').forEach(btn => {
    const isActive = btn.dataset.themeBtn === name;
    btn.classList.toggle('bg-stone-100', isActive);
    btn.classList.toggle('font-semibold', isActive);
  });

  // Close dropdown
  const dd = document.getElementById('theme-dropdown');
  if (dd) dd.classList.add('hidden');
}

function toggleThemePicker() {
  const dd = document.getElementById('theme-dropdown');
  if (dd) dd.classList.toggle('hidden');
}

// Close picker when clicking outside
document.addEventListener('click', e => {
  const wrap = document.getElementById('theme-picker-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const dd = document.getElementById('theme-dropdown');
    if (dd) dd.classList.add('hidden');
  }
});

// Apply saved theme on load
setTheme(localStorage.getItem('theme') || 'light');

//  Utility 
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

//  Search
function searchDecks() {
  if (!allDecks.length) return;
  const query = document.getElementById('deck-search').value.trim().toLowerCase();
  const filtered = !query
    ? allDecks
    : allDecks.filter(d =>
      d.title.toLowerCase().includes(query) ||
      (d.category && d.category.toLowerCase().includes(query))
    );
  renderGrid(filtered);
}
document.getElementById('deck-search').addEventListener('input', searchDecks);

//  Init
// MUSIC SETTINGS
const musicVolumeSlider = document.getElementById("music-volume");
const sfxVolumeSlider = document.getElementById("sfx-volume");

const musicValue = document.getElementById("music-volume-value");
const sfxValue = document.getElementById("sfx-volume-value");

const backgroundMusic = document.getElementById("background-music");

// VOLUME DROPDOWN
const volumeWidget = document.getElementById("volume-widget");
const volumeDropdown = document.getElementById("volume-dropdown");
const volumeBtn = document.getElementById("volume-btn");

let volumeTimer;

volumeWidget.addEventListener("mouseenter", () => {
  clearTimeout(volumeTimer);
  volumeDropdown.classList.remove("hidden");
});

volumeWidget.addEventListener("mouseleave", () => {
  volumeTimer = setTimeout(() => {
    volumeDropdown.classList.add("hidden");
  }, 300);
});

if (musicVolumeSlider && musicValue) {
  musicVolumeSlider.value = "0";
  musicValue.textContent = "0%";
}
 
let musicVolume = 0; 
let sfxVolume = Number(sfxVolumeSlider.value) / 100;

/* ADDED: Keep track of the last non-zero volume level. Default to 40% */
let preMuteVolume = 40; 

if (backgroundMusic) {
  backgroundMusic.volume = musicVolume;
}

if (volumeBtn) {
  volumeBtn.textContent = "🔇";
}

// SLIDER INTERACTION HANDLERS
musicVolumeSlider.addEventListener("input", () => {
  musicVolume = Number(musicVolumeSlider.value) / 100;
  musicValue.textContent = `${musicVolumeSlider.value}%`;
  
  if (backgroundMusic) {
    backgroundMusic.volume = musicVolume;
  }

  // Update our tracked non-zero volume variable whenever the slider moves
  if (musicVolumeSlider.value !== "0") {
    preMuteVolume = Number(musicVolumeSlider.value);
  }

  if (volumeBtn) {
    if (musicVolumeSlider.value === "0") {
      volumeBtn.textContent = "🔇";
    } else {
      volumeBtn.textContent = "🔊";
    }
  }
});

sfxVolumeSlider.addEventListener("input", () => {
  sfxVolume = Number(sfxVolumeSlider.value) / 100;
  sfxValue.textContent = `${sfxVolumeSlider.value}%`;
});

/* ADDED: Click handler for the volume button to toggle mute state */
if (volumeBtn) {
  volumeBtn.addEventListener("click", () => {
    if (musicVolumeSlider.value === "0") {
      // Unmute: Restore to the last tracked non-zero volume level
      musicVolumeSlider.value = String(preMuteVolume);
      volumeBtn.textContent = "🔊";
    } else {
      // Mute: Save current position first, then drop to zero
      preMuteVolume = Number(musicVolumeSlider.value);
      musicVolumeSlider.value = "0";
      volumeBtn.textContent = "🔇";
    }
    
    // Sync the underlying audio engine and text layouts to match the new value
    musicVolume = Number(musicVolumeSlider.value) / 100;
    musicValue.textContent = `${musicVolumeSlider.value}%`;
    if (backgroundMusic) {
      backgroundMusic.volume = musicVolume;
    }
  });
}

document.addEventListener(
  "click", () => {
    if (backgroundMusic) backgroundMusic.play();
  },
  {once: true}
);
//  Shared deck state — declared before init() so loadSharedDeck can access them
let sharedDeckData = null;
let sharedCardIndex = 0;
let sharedFlipped = false;
let sharedQuizAnswered = false;
let sharedToken = null;
let sharedIsLoggedIn = false;
let sharedScore = 0;
let sharedTotalAnswered = 0;
let sharedWrongCards = [];
let sharedFullDeckCards = [];
let sharedAnsweredCardIndices = new Set();
let sharedReachedEnd = false;
let sharedUnansweredQueue = [];

//  Init 
async function init() {
  // Check for shared deck token BEFORE any auth check —
  // api() redirects on 401 so we must bypass it entirely for shared views
  const sharedToken = new URLSearchParams(window.location.search).get('token');
  if (sharedToken) {
    await loadSharedDeck(sharedToken);
    return;
  }

  try {
    const me = await api('GET', '/auth/me');
    const userDisplay = document.getElementById('user-display');
    if (userDisplay) userDisplay.textContent = me.username;
  } catch (err) {
    // api() already redirected on 401; nothing more to do
    return;
  }
  loadDecks();
}
init();

// Logout button handler
async function doLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login.html';
  }
}



document.addEventListener('DOMContentLoaded', () => {
  // Don't load decks for shared deck views — unauthenticated users would get redirected
  const isSharedView = new URLSearchParams(window.location.search).has('token');
  if (!isSharedView) loadDecks();
  document.getElementById('add-choice-btn')?.addEventListener('click', () => addChoiceRow());
});

// CSV Import
let csvFile = null;

const CSV_TEMPLATE = `deck_title,question,answer,deck_category,card_type,choices\nMy Deck,What is the capital of France?,Paris,Geography,basic,\nMy Deck,Which is a primary colour?,Red,Art,multiple_choice,Red|Blue|Yellow|Green`;

async function copyCsvSchema(btn) {
  try {
    await navigator.clipboard.writeText(CSV_TEMPLATE);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = CSV_TEMPLATE;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  const orig = btn.textContent.trim();
  btn.textContent = '✓';
  btn.classList.add('border-green-500', 'text-green-500');
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove('border-green-500', 'text-green-500');
  }, 1500);
}

function openCsvModal() {
  csvFile = null;
  document.getElementById('csv-file-input').value = '';
  document.getElementById('csv-drop-label').textContent = 'Drop your CSV here or click to browse';
  document.getElementById('csv-result').classList.add('hidden');
  document.getElementById('csv-import-btn').disabled = true;
  openModal('csv-modal');
}

function closeCsvModal() { closeModal('csv-modal'); }

function csvFileChosen(e) {
  const file = e.target.files[0];
  if (file) setCsvFile(file);
}

function csvDragOver(e) {
  e.preventDefault();
  document.getElementById('csv-dropzone').classList.add('border-stone-500', 'bg-stone-50');
}

function csvDragLeave() {
  document.getElementById('csv-dropzone').classList.remove('border-stone-500', 'bg-stone-50');
}

function csvDrop(e) {
  e.preventDefault();
  csvDragLeave();
  const file = e.dataTransfer.files[0];
  if (file) setCsvFile(file);
}

function setCsvFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showCsvResult('Only .csv files are allowed', 'error');
    return;
  }
  csvFile = file;
  document.getElementById('csv-drop-label').textContent = `✓ ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  document.getElementById('csv-import-btn').disabled = false;
  document.getElementById('csv-result').classList.add('hidden');
}

function showCsvResult(msg, type) {
  const el = document.getElementById('csv-result');
  el.textContent = msg;
  el.className = `text-sm rounded-xl px-4 py-3 mb-4 ${
    type === 'error'   ? 'bg-red-50 text-red-600 border border-red-200' :
    type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
                         'bg-stone-100 text-stone-600'
  }`;
  el.classList.remove('hidden');
}

async function submitCsv() {
  if (!csvFile) return;

  const btn = document.getElementById('csv-import-btn');
  btn.disabled = true;
  btn.textContent = 'Importing...';
  document.getElementById('csv-result').classList.add('hidden');

  try {
    const formData = new FormData();
    formData.append('file', csvFile);

    const res = await fetch('/api/import/csv', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      showCsvResult(data.error || 'Import failed', 'error');
      return;
    }

    showCsvResult(data.message, 'success');
    showToast(`✓ ${data.message}`);
    loadDecks();

    if (data.errors && data.errors.length > 0) {
      console.warn('CSV row errors:', data.errors);
    }

    setTimeout(() => closeCsvModal(), 1800);
  } catch (err) {
    showCsvResult('Network error — try again', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import';
  }
}



// Stores MCQ rows locally when the user switches away, so they aren't lost
let cachedMcqChoices = [];

function snapshotMcqChoices() {
  const rows = document.querySelectorAll('#choices-list > div');
  cachedMcqChoices = Array.from(rows).map(row => ({
    text: row.querySelector('.choice-text').value,
    isCorrect: row.querySelector('.choice-checker')?.getAttribute('data-correct') === 'true'
  }));
}

document.getElementById('card-type-group').addEventListener('click', (e) => {
  const clickedBtn = e.target.closest('.type-btn');
  if (!clickedBtn) return;

  const newType = clickedBtn.dataset.type;
  const isActive = clickedBtn.classList.contains('active');

  // Snapshot MCQ choices before switching away from MCQ
  if (selectedType === 'multiple_choice') snapshotMcqChoices();

  // When switching from basic to MCQ, seed the answer as the first choice
  if (selectedType === 'basic' && newType === 'multiple_choice' && !isActive) {
    const answer = document.getElementById('card-answer-input').value.trim();
    if (answer) cachedMcqChoices = [{ text: answer, isCorrect: true }];
  }

  document.querySelectorAll('.type-btn').forEach(btn => btn.classList.remove('active'));

  if (isActive) {
    selectedType = 'basic';
  } else {
    clickedBtn.classList.add('active');
    selectedType = newType;
  }

  toggleUISections(selectedType);
});

function toggleUISections(type) {
  const mcqContainer = document.getElementById('mcq-options-container');
  const addChoiceBtn = document.getElementById('add-choice-btn');
  const answerWrapper = document.getElementById('answer-field-wrapper');
  const list = document.getElementById('choices-list');
  const isMcqLike = type === 'multiple_choice' || type === 'true_false';

  // Hide the answer field for MCQ/T/F — the correct radio button IS the answer
  if (answerWrapper) answerWrapper.classList.toggle('hidden', isMcqLike);

  if (type === 'multiple_choice') {
    mcqContainer.classList.remove('hidden');
    addChoiceBtn.classList.remove('hidden');
    list.innerHTML = '';
    // Restore cached choices, or seed two blank rows
    if (cachedMcqChoices.length > 0) {
      cachedMcqChoices.forEach(c => addChoiceRow(c.text, c.isCorrect));
    } else {
      addChoiceRow();
      addChoiceRow();
    }
  } else if (type === 'true_false') {
    mcqContainer.classList.remove('hidden');
    addChoiceBtn.classList.add('hidden');
    list.innerHTML = '';
    // Stored lowercase, displayed title-case, locked (no delete)
    addChoiceRow('true', false, { label: 'True', locked: true });
    addChoiceRow('false', false, { label: 'False', locked: true });
  } else {
    // basic
    mcqContainer.classList.add('hidden');
  }
}

function addChoiceRow(text = '', isCorrect = false, opts = {}) {
  const { label = null, locked = false } = opts;
  const displayValue = label ?? text;
  const list = document.getElementById('choices-list');

  const row = document.createElement('div');
  row.className = 'choice-row';

  // Checker — div with role=button so Tailwind base reset doesn't override background
  const checker = document.createElement('div');
  checker.className = 'choice-checker';
  checker.setAttribute('role', 'button');
  checker.setAttribute('tabindex', '0');
  checker.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  setCheckerState(checker, isCorrect);

  const selectChecker = () => {
    list.querySelectorAll('.choice-checker').forEach(btn => setCheckerState(btn, false));
    setCheckerState(checker, true);
  };
  checker.addEventListener('click', selectChecker);
  checker.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectChecker(); }
  });

  // Text input
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'choice-text' + (locked ? ' choice-text--locked' : '');
  input.placeholder = 'Choice text...';
  input.value = locked ? displayValue : text;
  if (locked) {
    input.readOnly = true;
    input.dataset.saveValue = text;
  }

  row.appendChild(checker);
  row.appendChild(input);

  if (!locked) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'choice-delete';
    del.textContent = '✕';
    del.addEventListener('click', () => row.remove());
    row.appendChild(del);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'choice-delete-placeholder';
    row.appendChild(spacer);
  }

  list.appendChild(row);
}

function setCheckerState(checker, isCorrect) {
  checker.setAttribute('data-correct', isCorrect ? 'true' : 'false');
  checker.setAttribute('aria-pressed', isCorrect ? 'true' : 'false');
  checker.classList.toggle('choice-checker--checked', isCorrect);
}


// ── AI Card Generator Panel ───────────────────────────────────────

// State — kept separate from study view state
let aiCards = [];
let aiCardIndex = 0;
let aiFlipped = false;
let aiStreaming = false;

function openAiPanel() {
  aiPopulateDeckSelect();
  // Reset to full size on open
  document.getElementById('ai-prompt-input').rows = 3;
  document.getElementById('ai-stream-wrap').classList.add('hidden');
  const modal = document.getElementById('ai-modal');
  modal.style.display = '';
  openModal('ai-modal');
  if (document.getElementById('ai-model-select').options[0]?.value === '') {
    loadAiModels();
  }
}

function closeAiPanel() {
  closeModal('ai-modal');
  // Belt-and-suspenders: also hide so it can never block clicks even if pointer-events glitches
  setTimeout(() => {
    const modal = document.getElementById('ai-modal');
    if (modal.classList.contains('opacity-0')) modal.style.display = 'none';
  }, 210); // after transition completes
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('ai-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('ai-modal')) closeAiPanel();
  });
});

// ── Model loading ─────────────────────────────────────────────────

async function loadAiModels() {
  const sel = document.getElementById('ai-model-select');
  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    const data = await fetch('/ai-chat/models').then(r => r.json());
    sel.innerHTML = '';

    // Gemini first
    if (data.gemini) {
      const g = document.createElement('optgroup');
      g.label = 'Gemini';
      data.gemini.forEach(m => {
        const o = document.createElement('option');
        o.value = 'gemini:' + m;
        o.textContent = m;
        g.appendChild(o);
      });
      sel.appendChild(g);
    }

    // Groq second
    if (data.groq) {
      const g = document.createElement('optgroup');
      g.label = 'Groq';
      data.groq.forEach(m => {
        const o = document.createElement('option');
        o.value = 'groq:' + m;
        o.textContent = m;
        g.appendChild(o);
      });
      sel.appendChild(g);
    }

    // Ollama local models last
    if (data.ollama?.length) {
      const g = document.createElement('optgroup');
      g.label = 'Local (Ollama)';
      data.ollama.forEach(m => {
        const o = document.createElement('option');
        o.value = 'ollama:' + m;
        o.textContent = m;
        g.appendChild(o);
      });
      sel.appendChild(g);
    }

    // Restore saved preference
    const saved = localStorage.getItem('ai-model');
    if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
    else if (sel.options.length) sel.value = sel.options[0].value;

  } catch (e) {
    sel.innerHTML = '<option value="gemini:gemini-3.1-flash-lite">gemini-3.1-flash-lite (default)</option>';
  }
}

document.getElementById('ai-model-select')?.addEventListener('change', () => {
  const v = document.getElementById('ai-model-select').value;
  if (v) localStorage.setItem('ai-model', v);
});

// ── Prompt + streaming ────────────────────────────────────────────

async function sendAiPrompt() {
  const prompt = document.getElementById('ai-prompt-input').value.trim();
  if (!prompt || aiStreaming) return;

  const modelVal  = document.getElementById('ai-model-select').value;
  const cardCount = Math.min(20, Math.max(1, parseInt(document.getElementById('ai-card-count').value, 10) || 5));
  const cardType  = document.getElementById('ai-card-type').value;

  if (!modelVal) { showToast('Select a model first'); return; }

  const [provider, model] = modelVal.split(':');

  aiStreaming = true;
  aiCards = [];
  aiFlipped = false;

  // UI: show stream, shrink prompt, hide carousel/save
  document.getElementById('ai-prompt-input').rows = 1;
  document.getElementById('ai-stream-wrap').classList.remove('hidden');
  document.getElementById('ai-stream-raw').textContent = '';
  document.getElementById('ai-carousel-phase').classList.add('hidden');
  document.getElementById('ai-save-phase').classList.add('hidden');
  document.getElementById('ai-generate-btn').disabled = true;
  document.getElementById('ai-btn-idle').classList.add('hidden');
  document.getElementById('ai-btn-busy').classList.remove('hidden');

  // Timer
  const t0 = performance.now();
  const timer = setInterval(() => {
    document.getElementById('ai-busy-label').textContent =
      ((performance.now() - t0) / 1000).toFixed(1) + 's';
  }, 100);

  let raw = '';
  try {
    const res = await fetch('/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, provider, model, cardCount, cardType })
    });
    if (!res.ok) throw new Error(await res.text());

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          if (j.response) {
            raw += j.response;
            document.getElementById('ai-stream-raw').textContent = raw;
          }
        } catch { /* skip */ }
      }
    }

    // Flush any remaining buffered content after stream ends
    if (buf.trim()) {
      try {
        const j = JSON.parse(buf.trim());
        if (j.response) {
          raw += j.response;
          document.getElementById('ai-stream-raw').textContent = raw;
        }
      } catch { /* skip */ }
    }

    // Parse cards from raw output
    const parseRes = await fetch('/ai-chat/parse-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw })
    });
    const parseBody = await parseRes.json();
    if (!parseBody.cards?.length) {
      const detail = parseBody.error || 'No cards found in response';
      const preview = parseBody.rawPreview ? `\n\nModel output preview:\n${parseBody.rawPreview}` : '';
      console.error('[AI] Parse failed:', detail, preview);
      throw new Error(detail);
    }

    aiCards = parseBody.cards;
    aiCardIndex = 0;

    // Hide stream, show carousel + save
    document.getElementById('ai-stream-wrap').classList.add('hidden');
    document.getElementById('ai-carousel-phase').classList.remove('hidden');
    document.getElementById('ai-save-phase').classList.remove('hidden');

    // Autofill new deck title with the prompt
    const titleEl = document.getElementById('ai-new-deck-title');
    if (titleEl && !titleEl.value) titleEl.value = prompt.slice(0, 50);

    aiRenderCarousel();

  } catch (e) {
    showToast(e.message || 'Generation failed');
    document.getElementById('ai-prompt-input').rows = 3;
    document.getElementById('ai-stream-wrap').classList.add('hidden');
  } finally {
    clearInterval(timer);
    aiStreaming = false;
    document.getElementById('ai-generate-btn').disabled = false;
    document.getElementById('ai-btn-idle').classList.remove('hidden');
    document.getElementById('ai-btn-busy').classList.add('hidden');
  }
}

// ── Carousel — mirrors renderStudyView but scoped to AI panel ─────

function aiRenderCarousel() {
  if (!aiCards.length) return;
  const card = aiCards[aiCardIndex];

  document.getElementById('ai-card-question').textContent = card.question;
  document.getElementById('ai-card-answer').textContent = card.answer;
  document.getElementById('ai-card-counter').textContent =
    `Card ${aiCardIndex + 1} of ${aiCards.length}`;
  document.getElementById('ai-prev-btn').disabled = aiCardIndex === 0;
  document.getElementById('ai-next-btn').disabled = aiCardIndex === aiCards.length - 1;

  // Snap to question side
  const inner = document.getElementById('ai-flashcard-inner');
  inner.style.transition = 'none';
  inner.style.transform = 'rotateY(0deg)';
  aiFlipped = false;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    inner.style.transition = '';
  }));
}

function aiFlipCard() {
  aiFlipped = !aiFlipped;
  document.getElementById('ai-flashcard-inner').style.transform =
    aiFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';
  playRandomSFX();
}

function aiNavigate(direction) {
  if (direction === 'next' && aiCardIndex < aiCards.length - 1) aiCardIndex++;
  if (direction === 'prev' && aiCardIndex > 0) aiCardIndex--;
  aiRenderCarousel();
  playRandomSFX();
}

// ── Deck selector ─────────────────────────────────────────────────

function aiPopulateDeckSelect() {
  const sel = document.getElementById('ai-deck-select');
  sel.innerHTML = '<option value="__new__">+ Create new deck…</option>';
  allDecks.forEach(d => {
    const o = document.createElement('option');
    o.value = d.id;
    o.textContent = `${d.title} (${d.cardCount ?? 0} cards)`;
    sel.appendChild(o);
  });
  aiSyncNewDeckRow();
}

document.getElementById('ai-deck-select')?.addEventListener('change', aiSyncNewDeckRow);

function aiSyncNewDeckRow() {
  const isNew = document.getElementById('ai-deck-select').value === '__new__';
  document.getElementById('ai-new-deck-row').classList.toggle('hidden', !isNew);
}

// ── Save ──────────────────────────────────────────────────────────

async function saveAiCards() {
  if (!aiCards.length) return;
  const btn = document.getElementById('ai-save-btn');
  btn.disabled = true;

  try {
    let deckId = document.getElementById('ai-deck-select').value;

    // Create new deck if needed
    if (deckId === '__new__') {
      const title = document.getElementById('ai-new-deck-title').value.trim();
      if (!title) { showToast('Enter a deck name'); btn.disabled = false; return; }
      const category = document.getElementById('ai-new-deck-category').value.trim();
      const newDeck = await api('POST', '/decks', { title, category });
      deckId = newDeck.id;
      await loadDecks(); // Refresh home grid
    }

    // Save each card using the existing route
    for (const card of aiCards) {
      await api('POST', `/decks/${deckId}/cards`, {
        question: card.question,
        answer: card.answer,
        card_type: card.card_type || 'basic',
        choices: card.choices || []
      });
    }

    showToast(`${aiCards.length} card${aiCards.length !== 1 ? 's' : ''} saved ✓`);
    document.getElementById('ai-save-phase').classList.add('hidden');
    await loadDecks();

  } catch (e) {
    showToast(e.message || 'Save failed');
  } finally {
    btn.disabled = false;
  }
}


// ── Shared Deck ───────────────────────────────────────────────────

async function loadSharedDeck(token) {
  sharedToken = token;

  // Show loading state immediately while we fetch
  showView('shared-loading-view');

  // Check if user is logged in using raw fetch — api() would redirect on 401
  try {
    const meRes = await fetch('/api/auth/me');
    sharedIsLoggedIn = meRes.ok;
  } catch { sharedIsLoggedIn = false; }

  try {
    const res = await fetch(`/api/shared/${encodeURIComponent(token)}`);
    if (!res.ok) {
      showSharedError();
      return;
    }
    sharedDeckData = await res.json();

    renderSharedLanding();
    showView('shared-landing-view');
  } catch (err) {
    console.error('Failed to load shared deck:', err);
    showSharedError();
  }
}

function sharedGoHome() {
  // Never include the token in the redirect — prevents auto-copy on login return
  window.location.href = sharedIsLoggedIn ? '/' : '/login.html';
}

function showSharedError() {
  document.getElementById('home-view').innerHTML = `
    <div class="max-w-md mx-auto px-6 py-24 text-center">
      <p class="text-stone-500 text-sm mb-4">This shared deck doesn't exist or has been removed.</p>
      <a href="/" class="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl border border-stone-200 hover:border-stone-400 transition-colors">Go home</a>
    </div>`;
  showView('home-view');
}

function renderSharedLanding() {
  const { deck, cards, stats } = sharedDeckData;
  console.log('[shared] renderSharedLanding', { deck, stats, cardCount: cards?.length });

  document.getElementById('shared-deck-title').textContent = deck.title || 'Untitled Deck';
  document.getElementById('shared-deck-creator').textContent = `Shared by @${deck.creator || 'unknown'}`;

  // Configure Save button based on auth + ownership state
  const saveBtn = document.getElementById('shared-save-btn');
  if (saveBtn) {
    if (sharedIsLoggedIn && sharedDeckData.isOwnDeck) {
      // Owner — grey out, not interactive
      saveBtn.disabled = true;
      saveBtn.title = 'This is your deck';
    } else {
      // Logged out or logged in non-owner — fully active
      saveBtn.disabled = false;
      saveBtn.title = '';
    }
  }

  // Stats pills
  const statsEl = document.getElementById('shared-deck-stats');
  const parts = [];
  if (stats?.basic)           parts.push(`${stats.basic} basic`);
  if (stats?.multiple_choice) parts.push(`${stats.multiple_choice} MCQ`);
  const total = stats?.total ?? cards?.length ?? 0;
  statsEl.innerHTML = [`${total} card${total !== 1 ? 's' : ''}`, ...parts]
    .map(p => `<span class="px-3 py-1 rounded-full bg-stone-100 text-stone-600 text-xs font-medium">${p}</span>`)
    .join('');

  // Category tags
  const cats = categorySplit(deck.category || '');
  const catsEl = document.getElementById('shared-deck-categories');
  catsEl.innerHTML = cats.length
    ? cats.map(c => `<span class="px-3 py-1 rounded-full bg-stone-100 text-stone-600 text-xs font-medium">${esc(c)}</span>`).join('')
    : '';
}

async function sharedSaveCopy() {
  if (!sharedIsLoggedIn) {
    // Redirect to login with return URL so they land back on this shared deck
    window.location.href = `/login.html?redirect=${encodeURIComponent(window.location.href)}`;
    return;
  }
  try {
    const res = await fetch(`/api/shared/${encodeURIComponent(sharedToken)}/copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Copy failed');
    }
    // Mark as own deck if server says so (shouldn't reach here normally)
    showToast('Deck saved to your account ✓');
    // Strip token from URL and go to home
    setTimeout(() => { window.location.href = '/'; }, 1200);
  } catch (err) {
    showToast(err.message || 'Failed to save deck');
  }
}

function sharedStartQuiz() {
  const { deck, cards } = sharedDeckData;
  sharedCardIndex = 0;
  sharedFlipped = false;
  sharedScore = 0;
  sharedTotalAnswered = 0;
  sharedWrongCards = [];
  sharedFullDeckCards = [...sharedDeckData.cards];
  sharedAnsweredCardIndices = new Set();
  sharedReachedEnd = false;
  sharedUnansweredQueue = [];
  document.getElementById('shared-unanswered-label')?.classList.add('hidden');
  document.getElementById('shared-quiz-title').textContent = deck.title;
  sharedRenderCard();
  showView('shared-quiz-view');
}

function sharedRenderCard() {
  const { cards } = sharedDeckData;
  if (!cards.length) return;

  const card = cards[sharedCardIndex];
  const isMcq = card.cardType === 'multiple_choice';

  document.getElementById('shared-quiz-counter').textContent =
    `Card ${sharedCardIndex + 1} of ${cards.length}`;
  document.getElementById('shared-progress-fill').style.width =
    `${((sharedCardIndex + 1) / cards.length) * 100}%`;

  // On the last card, detect unanswered cards and enter unanswered mode
  if (!sharedReachedEnd && sharedCardIndex === cards.length - 1) {
    const unanswered = cards.map((_, i) => i).filter(i => !sharedAnsweredCardIndices.has(i));
    if (unanswered.length > 0) {
      sharedReachedEnd = true;
      sharedUnansweredQueue = [...unanswered];
      updateSharedUnansweredLabel();
    }
  }

  if (sharedReachedEnd && sharedUnansweredQueue.length > 0) {
    const lockedOnLast = sharedUnansweredQueue.length === 1 && sharedCardIndex === sharedUnansweredQueue[0];
    document.getElementById('shared-prev-btn').disabled = lockedOnLast;
    document.getElementById('shared-next-btn').disabled = lockedOnLast;
  } else {
    document.getElementById('shared-prev-btn').disabled = sharedCardIndex === 0;
    document.getElementById('shared-next-btn').disabled = sharedCardIndex === cards.length - 1;
  }

  const flipWrapper = document.getElementById('shared-flip-wrapper');
  const quizWidget  = document.getElementById('shared-quiz-widget');

  if (isMcq) {
    flipWrapper.classList.add('hidden');
    quizWidget.classList.remove('hidden');
    sharedQuizAnswered = false;
    sharedRenderQuiz(card);
  } else {
    quizWidget.classList.add('hidden');
    flipWrapper.classList.remove('hidden');
    document.getElementById('shared-card-question').textContent = card.question;
    document.getElementById('shared-card-answer').textContent = card.answer;
    // Snap to question side
    const inner = document.getElementById('shared-flashcard-inner');
    inner.style.transition = 'none';
    inner.style.transform = 'rotateY(0deg)';
    sharedFlipped = false;
    requestAnimationFrame(() => requestAnimationFrame(() => { inner.style.transition = ''; }));
  }
}

function sharedFlipCard() {
  sharedFlipped = !sharedFlipped;
  document.getElementById('shared-flashcard-inner').style.transform =
    sharedFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';
  playRandomSFX();
}

function sharedSelfAssess(correct) {
  if (correct) sharedScore++;
  else sharedWrongCards.push(sharedDeckData.cards[sharedCardIndex]);
  sharedTotalAnswered++;
  sharedAnsweredCardIndices.add(sharedCardIndex);
  playAnswerSFX(correct);
  if (sharedReachedEnd) {
    sharedUnansweredQueue = sharedUnansweredQueue.filter(i => i !== sharedCardIndex);
    updateSharedUnansweredLabel();
    if (sharedUnansweredQueue.length === 0) {
      setTimeout(() => showSharedScorePopup(), 450);
    } else {
      setTimeout(() => sharedNavigateUnanswered('next'), 400);
    }
  } else if (sharedTotalAnswered === sharedDeckData.cards.length) {
    setTimeout(() => showSharedScorePopup(), 450);
  } else {
    setTimeout(() => sharedNavigate('next'), 400);
  }
}

function sharedRenderQuiz(card) {
  document.getElementById('shared-quiz-question').textContent = card.question;
  const feedback = document.getElementById('shared-quiz-feedback');
  feedback.className = 'quiz-feedback hidden';
  feedback.textContent = ' ';
  const choicesEl = document.getElementById('shared-quiz-choices');
  choicesEl.innerHTML = '';
  const labels = 'ABCDE';
  card.choices.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.className = 'quiz-choice-btn';
    // Display true/false with title case
    const display = ch.choiceText === 'true' ? 'True' : ch.choiceText === 'false' ? 'False' : esc(ch.choiceText);
    btn.innerHTML = `<span class="quiz-choice-btn__letter">${labels[i] ?? i + 1}</span>${display}`;
    btn.onclick = () => sharedAnswerQuiz(card, i);
    choicesEl.appendChild(btn);
  });
}

function sharedAnswerQuiz(card, selectedIndex) {
  if (sharedQuizAnswered) return;
  sharedQuizAnswered = true;
  const buttons = document.querySelectorAll('#shared-quiz-choices .quiz-choice-btn');
  buttons.forEach((btn, i) => {
    btn.onclick = null;
    if (card.choices[i].isCorrect) {
      btn.classList.add('quiz-choice-btn--correct');
    } else if (i === selectedIndex) {
      btn.classList.add('quiz-choice-btn--wrong');
    } else {
      btn.classList.add('quiz-choice-btn--dimmed');
    }
  });
  const correct = card.choices[selectedIndex].isCorrect;
  if (correct) sharedScore++;
  else sharedWrongCards.push(sharedDeckData.cards[sharedCardIndex]);
  sharedTotalAnswered++;
  sharedAnsweredCardIndices.add(sharedCardIndex);
  const feedback = document.getElementById('shared-quiz-feedback');
  feedback.classList.remove('hidden');
  if (correct) {
    feedback.textContent = '✓ Correct!';
    feedback.className = 'quiz-feedback quiz-feedback--correct';
  } else {
    const correctChoice = card.choices.find(c => c.isCorrect);
    feedback.textContent = `✗ The answer was ${correctChoice ? esc(correctChoice.choiceText) : '—'}`;
    feedback.className = 'quiz-feedback quiz-feedback--wrong';
  }
  playAnswerSFX(correct);
  if (sharedReachedEnd) {
    sharedUnansweredQueue = sharedUnansweredQueue.filter(i => i !== sharedCardIndex);
    updateSharedUnansweredLabel();
    if (sharedUnansweredQueue.length === 0) {
      setTimeout(() => showSharedScorePopup(), 450);
    }
    // No auto-navigate for MCQ — user presses Next to continue
  } else if (sharedTotalAnswered === sharedDeckData.cards.length) {
    setTimeout(() => showSharedScorePopup(), 450);
  }
}

function showSharedScorePopup() {
  const percent = Math.round((sharedScore / sharedTotalAnswered) * 100);
  document.getElementById('quiz-score-text').textContent =
    `Final Score: ${sharedScore}/${sharedTotalAnswered} (${percent}%)`;
  const retestWrongBtn = document.getElementById('retest-wrong-btn');
  if (retestWrongBtn) retestWrongBtn.classList.toggle('hidden', sharedWrongCards.length === 0);
  document.querySelector('#quiz-score-popup button')
    ?.setAttribute('onclick', 'sharedRestartQuiz(false)');
  if (retestWrongBtn) retestWrongBtn.setAttribute('onclick', 'sharedRestartQuiz(true)');
  const popup = document.getElementById('quiz-score-popup');
  popup.classList.remove('hidden');
  popup.classList.add('flex');
}

function sharedRestartQuiz(wrongOnly = false) {
  closeQuizScorePopup();
  document.querySelector('#quiz-score-popup button')
    ?.setAttribute('onclick', 'restartQuiz(false)');
  const wrongBtn = document.getElementById('retest-wrong-btn');
  if (wrongBtn) wrongBtn.setAttribute('onclick', 'restartQuiz(true)');
  if (wrongOnly && sharedWrongCards.length > 0) {
    sharedDeckData = { ...sharedDeckData, cards: [...sharedWrongCards] };
  } else {
    sharedDeckData = { ...sharedDeckData, cards: [...sharedFullDeckCards] };
  }
  sharedScore = 0;
  sharedTotalAnswered = 0;
  sharedWrongCards = [];
  sharedCardIndex = 0;
  sharedAnsweredCardIndices = new Set();
  sharedReachedEnd = false;
  sharedUnansweredQueue = [];
  document.getElementById('shared-unanswered-label')?.classList.add('hidden');
  sharedRenderCard();
}

function updateSharedUnansweredLabel() {
  const label = document.getElementById('shared-unanswered-label');
  if (!label) return;
  if (!sharedReachedEnd) { label.classList.add('hidden'); return; }
  const remaining = sharedUnansweredQueue.length;
  label.textContent = `${remaining} question${remaining !== 1 ? 's' : ''} remaining`;
  label.classList.toggle('hidden', remaining === 0);
}

function sharedNavigateUnanswered(direction) {
  if (!sharedUnansweredQueue.length) return;
  if (sharedUnansweredQueue.length === 1) {
    // Navigate to the only remaining card if not already on it
    if (sharedCardIndex !== sharedUnansweredQueue[0]) {
      sharedCardIndex = sharedUnansweredQueue[0];
      sharedRenderCard();
      playRandomSFX();
    }
    return;
  }
  if (direction === 'next') {
    const next = sharedUnansweredQueue.find(i => i > sharedCardIndex) ?? sharedUnansweredQueue[0];
    sharedCardIndex = next;
  } else {
    const prev = [...sharedUnansweredQueue].reverse().find(i => i < sharedCardIndex)
      ?? sharedUnansweredQueue[sharedUnansweredQueue.length - 1];
    sharedCardIndex = prev;
  }
  sharedRenderCard();
  playRandomSFX();
}

function sharedNavigate(direction) {
  const { cards } = sharedDeckData;

  // Delegate to unanswered navigation when in that mode
  if (sharedReachedEnd && sharedUnansweredQueue.length > 0) {
    sharedNavigateUnanswered(direction);
    return;
  }

  const inner = document.getElementById('shared-flashcard-inner');
  if (inner) {
    inner.style.transition = 'none';
    inner.style.transform = 'rotateY(0deg)';
  }
  sharedFlipped = false;
  if (direction === 'next' && sharedCardIndex < cards.length - 1) sharedCardIndex++;
  if (direction === 'prev' && sharedCardIndex > 0) sharedCardIndex--;
  sharedRenderCard();
  playRandomSFX();
  if (inner) requestAnimationFrame(() => requestAnimationFrame(() => { inner.style.transition = ''; }));
}