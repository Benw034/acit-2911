let cards = [];
let currentCardIndex = 0;
let isFlipped = false;

async function loadSharedDeck() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  if (!token) {
    showError();
    return;
  }

  try {
    const res = await fetch(`/api/shared/${encodeURIComponent(token)}`);
    if (!res.ok) {
      showError();
      return;
    }
    const data = await res.json();
    cards = data.cards || [];
    document.getElementById('study-title').textContent = data.deck.title;
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('deck-content').classList.remove('hidden');
    renderCard();
  } catch (err) {
    console.error('Failed to load shared deck:', err);
    showError();
  }
}

function showError() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('error').classList.remove('hidden');
}

function renderCard() {
  if (!cards.length) {
    document.getElementById('card-question').textContent = 'This deck has no cards yet.';
    document.getElementById('card-answer').textContent = '';
    document.getElementById('card-counter').textContent = '0 cards';
    document.getElementById('prev-btn').disabled = true;
    document.getElementById('next-btn').disabled = true;
    return;
  }
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

function flipCard() {
  if (!cards.length) return;
  isFlipped = !isFlipped;
  document.getElementById('flashcard-inner').style.transform = isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';
}

function navigateCards(direction) {
  if (!cards.length) return;
  document.getElementById('flashcard-inner').style.transform = 'rotateY(0deg)';
  isFlipped = false;
  setTimeout(() => {
    if (direction === 'next' && currentCardIndex < cards.length - 1) currentCardIndex++;
    else if (direction === 'prev' && currentCardIndex > 0) currentCardIndex--;
    renderCard();
  }, 150);
}

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') navigateCards('next');
  if (e.key === 'ArrowLeft') navigateCards('prev');
  if (e.key === ' ') { e.preventDefault(); flipCard(); }
});

loadSharedDeck();
