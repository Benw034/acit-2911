//  State 
let currentDeckId = null, currentCardIndex = 0;
let editingDeckId = null, editingCardId = null;
let cards = [], isFlipped = false;
let allDecks = [];
let activeFilter = 'All';
let selectedType = 'basic'; // Default state is basic

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
  .map(c => c.trim())
  .filter(Boolean);
}

let selectedDeckCategories = []

function fillCategorySuggestion() {
  const datalist = document.getElementById('category-options');
  if (!datalist) return;

  const categories = [...new Set(allDecks.flatMap(d => categorySplit(d.category)))];

  datalist.innerHTML = categories.map(category => ` <option value="${esc(category)}"></option>`).join('');
}

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

  const category = input.value.trim();

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
function goHome() { showView('home-view'); loadDecks(); }

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
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" class="shrink-0 mt-0.5">
          <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M8 4v16M16 4v16"/>
        </svg>
      </div>
      ${categorySplit(d.category).length ? `<div class="flex flex-wrap gap-1"> ${categorySplit(d.category).map(category => 
        `<span class="inline-block text-xs font-medium bg-stone-100 text-stone-600 px-2.5 py-1 rounded-full"> ${esc(category)} </span> `).join('')} </div>` : '<span></span>' }
      <div class="flex items-center justify-between mt-auto pt-2">
        <span class="text-sm text-stone-400">${d.cardCount} card${d.cardCount !== 1 ? 's' : ''}</span>
        <div class="flex items-center gap-2">
          <button onclick="openEditDeckModal(this.dataset.id, this.dataset.title, this.dataset.category)"
            data-id="${esc(d.id)}" data-title="${esc(d.title)}" data-category="${esc(d.category||'')}"
            class="w-8 h-8 flex items-center justify-center rounded-lg text-stone-300 hover:text-stone-600 hover:bg-stone-100 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button onclick="deleteDeck('${d.id}')"
            class="w-8 h-8 flex items-center justify-center rounded-lg text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
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
  const categoryInput = document.getElementById('deck-category-input').value.trim();

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
  showToast('Deck deleted');
  loadDecks();
}

//  Study 
async function openDeck(deckId) {
  currentDeckId = deckId;
  currentCardIndex = 0;
  const deck = await api('GET', `/decks/${deckId}`);
  cards = deck.cards;
  document.getElementById('study-title').textContent = deck.title;
  renderStudyView();
  showView('study-view');
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
  document.getElementById('card-question').textContent = card.question;
  document.getElementById('card-answer').textContent = card.answer;
  document.getElementById('card-counter').textContent = `Card ${currentCardIndex + 1} of ${cards.length}`;
  document.getElementById('progress-fill').style.width = `${((currentCardIndex + 1) / cards.length) * 100}%`;
  document.getElementById('prev-btn').disabled = currentCardIndex === 0;
  document.getElementById('next-btn').disabled = currentCardIndex === cards.length - 1;
  isFlipped = false;
  document.getElementById('flashcard-inner').style.transform = 'rotateY(0deg)';
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

function flipCard() {
  isFlipped = !isFlipped;
  document.getElementById('flashcard-inner').style.transform = isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';
  playRandomSFX();
}

const flipPreviewCard = flipCard;
// function prevCard() { if (currentCardIndex > 0) { currentCardIndex--; renderStudyView(); } playRandomSFX()}
// function nextCard() { if (currentCardIndex < cards.length - 1) { currentCardIndex++; renderStudyView(); }  playRandomSFX()}

function navigateCards(direction) {
  const cardElement = document.getElementById('flashcard-inner'); 
  cardElement.style.transform = 'rotateY(0deg)';
  isFlipped = false;
  playRandomSFX();
  // delay allows animation to start/finish before the text content actually changes
  setTimeout(() => {
    if (direction === 'next') {
      if (currentCardIndex < cards.length - 1) currentCardIndex++;
    } else {
      if (currentCardIndex > 0) currentCardIndex--;
    }
    renderStudyView(); 
    
  }, 150);
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
      const correct = row.querySelector('input[type="radio"]').checked;
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

['deck-modal', 'card-modal'].forEach(id => {
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
//  Init 
async function init() {
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
    isCorrect: row.querySelector('input[type="radio"]').checked
  }));
}

document.getElementById('card-type-group').addEventListener('click', (e) => {
  const clickedBtn = e.target.closest('.type-btn');
  if (!clickedBtn) return;

  const newType = clickedBtn.dataset.type;
  const isActive = clickedBtn.classList.contains('active');

  // Snapshot MCQ choices before switching away from MCQ
  if (selectedType === 'multiple_choice') snapshotMcqChoices();

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
  row.className = "flex items-center gap-2";
  row.innerHTML = `
    <input type="radio" name="mcq-correct" ${isCorrect ? 'checked' : ''} class="w-4 h-4 text-stone-900">
    <input type="text" class="choice-text flex-1 p-2 border border-stone-200 rounded-lg text-sm${locked ? ' bg-stone-100 text-stone-500 cursor-default' : ''}"
      placeholder="Choice text..." value="${locked ? displayValue : text}"${locked ? ' readonly' : ''}>
    ${locked ? '<span class="w-5"></span>' : '<button type="button" class="text-stone-400 hover:text-red-500" onclick="this.parentElement.remove()">✕</button>'}
  `;
  // For locked T/F rows, store the lowercase save value in a data attribute
  if (locked) row.querySelector('.choice-text').dataset.saveValue = text;
  list.appendChild(row);
}

async function handleSaveCard() {
  const question = document.getElementById('card-question').value;
  const answer = document.getElementById('card-answer').value;
  
  let finalType = selectedType;
  let choices = [];

  if (selectedType === 'true_false') {
    // Convert T/F to MCQ for backend compatibility
    finalType = 'multiple_choice';
    const isTrue = answer.toLowerCase().trim() === 'true';
    choices = [
      { choiceText: 'True', isCorrect: isTrue },
      { choiceText: 'False', isCorrect: !isTrue }
    ];
  } else if (selectedType === 'multiple_choice') {
    const rows = document.querySelectorAll('#choices-list div');
    rows.forEach(row => {
      choices.push({
        choiceText: row.querySelector('.choice-text').value,
        isCorrect: row.querySelector('input[type="radio"]').checked
      });
    });
  }

  const payload = {
    question,
    answer,
    cardType: finalType, // Matches card_type alias in server.js
    choices
  };
  saveCard();
}