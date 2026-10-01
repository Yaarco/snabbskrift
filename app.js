const CHEAT_ENABLED = true;

const quotes = [
	"Good design is as little design as possible, leaving room for the thing that truly matters.",
	"The future belongs to those who believe in the beauty of their small, consistent efforts.",
	"In the middle of difficulty lies opportunity, waiting quietly for a different point of view.",
	"A clear mind does not arrive all at once; it is built one patient question at a time.",
	"The best journeys change their shape while you are moving, so leave a little room to wander.",
	"Make something that feels inevitable in hindsight, but surprising the moment it arrives."
];

const canvas = document.querySelector('#orbit');
const ctx = canvas.getContext('2d');
const input = document.querySelector('#type-input');
const quoteEl = document.querySelector('#quote');
const progressEl = document.querySelector('#progress');
const statusEl = document.querySelector('#status');
const wpmEl = document.querySelector('#wpm');
const accuracyEl = document.querySelector('#accuracy');
const gravityEl = document.querySelector('#gravity-readout');
const dots = [...document.querySelectorAll('.round-dot')];
const modal = document.querySelector('#modal');
const restart = document.querySelector('#restart');
const nextLevel = document.querySelector('#next-level');
const finalWpm = document.querySelector('#final-wpm');
const mistakeFlash = document.querySelector('#mistake-flash');
const cheatButton = document.querySelector('#cheat-button');
const difficultyList = document.querySelector('#difficulty-list');
const difficultyStorageKey = 'orbit-type-completed-difficulties';

let quote = '';
let round = 0;
let typed = 0;
let errors = 0;
let started = 0;
let particles = [];
let stars = [];
let width = 0;
let height = 0;
let gravity = .62;
let spin = .0026;
let sunReserve = 2;
let sunPulse = 0;
let gravityPulse = 0;
let pulseStart = 0;
let lastPulse = -1;
let audioContext = null;
let sunDrain = .00005;
let difficulty = 1;
let cheatActive = false;
let running = true;
let roundComplete = false;
let completeTimer = 0;
let feedbackTimer = 0;
let animationFrame = 0;
let lastFrame = 0;

const mass = 1800;
const timeStep = .72;
const softening = 60;

function loadCompletedDifficulties() {
	try {
		const values = JSON.parse(localStorage.getItem(difficultyStorageKey)) || [];
		return new Set(values.filter(level => Number.isInteger(level) && level >= 1 && level <= 10));
	} catch {
		return new Set();
	}
}

const completedDifficulties = loadCompletedDifficulties();

function saveCompletedDifficulties() {
	try {
		localStorage.setItem(difficultyStorageKey, JSON.stringify([...completedDifficulties].sort((a, b) => a - b)));
	} catch {
		// Completion still works for the current session when storage is unavailable.
	}
}

function renderDifficulties() {
	difficultyList.replaceChildren();
	for (let level = 1; level <= 10; level++) {
		const item = document.createElement('li');
		const button = document.createElement('button');
		const complete = completedDifficulties.has(level);
		button.type = 'button';
		button.dataset.level = level;
		button.textContent = complete ? `${level} ✓` : level;
		button.className = complete ? 'is-complete' : '';
		button.setAttribute('aria-label', `Difficulty ${level}${complete ? ', completed' : ''}`);
		button.setAttribute('aria-pressed', String(level === difficulty));
		button.addEventListener('click', () => {
			difficulty = level;
			renderDifficulties();
			restartGame();
		});
		item.append(button);
		difficultyList.append(item);
	}
}

function resize() {
	const ratio = devicePixelRatio || 1;
	width = canvas.clientWidth;
	height = canvas.clientHeight;
	canvas.width = width * ratio;
	canvas.height = height * ratio;
	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	stars = Array.from(
		{ length: Math.min(180, Math.floor(width * height / 9000)) },
		() => ({ x: Math.random() * width, y: Math.random() * height, r: Math.random() * 1.3, phase: Math.random() * 7 })
	);
}

function pickQuote() {
	return quotes[Math.floor(Math.random() * quotes.length)];
}

function renderQuote() {
	quoteEl.replaceChildren();
	[...quote].forEach((letter, index) => {
		const span = document.createElement('span');
		span.className = index < typed ? 'done' : index === typed ? 'current' : 'pending';
		span.textContent = letter;
		quoteEl.append(span);
	});
	progressEl.style.width = `${typed / quote.length * 100}%`;
}

function newRound() {
	quote = pickQuote();
	typed = 0;
	errors = 0;
	started = 0;
	roundComplete = false;
	gravity = .58 + round * .13 + (difficulty - 1) * .06;
	spin = .002 + round * .0008;
	sunReserve = 1;
	sunDrain = .001 + (difficulty - 1) * .00025 + round * .00008;
	pulseStart = 0;
	lastPulse = -1;
	gravityEl.textContent = `gravity ${gravity.toFixed(2)} · sun 100%`;
	document.querySelector('#round-label').textContent = `Round 0${round + 1} / 03`;
	statusEl.textContent = 'Start typing to launch the field';
	renderQuote();
	updateStats();
}

function updateStats() {
	const elapsed = started ? (Date.now() - started) / 60000 : 1;
	wpmEl.textContent = started ? Math.round(typed / 5 / elapsed) : '--';
	accuracyEl.textContent = `${Math.max(0, Math.round((typed - errors) / Math.max(typed, 1) * 100))}%`;
}

function addParticle(char, index) {
	const letter = quoteEl.children[index];
	if (!letter) return;
	const rect = letter.getBoundingClientRect();
	const x = rect.left + rect.width / 2;
	const y = rect.top + rect.height / 2;
	const dx = x - width / 2;
	const dy = y - height / 2;
	const distance = Math.max(70, Math.hypot(dx, dy));
	const tangentX = -dy / distance;
	const tangentY = dx / distance;
	const speed = Math.sqrt(mass * gravity / distance) * (.86 + Math.random() * .18);
	particles.push({ char: cheatActive ? quote[index] : char, x, y, vx: tangentX * speed - dx / distance * .45, vy: tangentY * speed - dy / distance * .45, size: 11 + Math.random() * 8, alpha: 1 });
}

function playPulseSound() {
	if (!audioContext) return;
	const now = audioContext.currentTime;
	const oscillator = audioContext.createOscillator();
	const gain = audioContext.createGain();
	oscillator.type = 'sine';
	oscillator.frequency.setValueAtTime(58, now);
	oscillator.frequency.exponentialRampToValueAtTime(32, now + .5);
	gain.gain.setValueAtTime(.0004, now);
	gain.gain.exponentialRampToValueAtTime(.18, now + .04);
	gain.gain.exponentialRampToValueAtTime(.0001, now + .56);
	oscillator.connect(gain);
	gain.connect(audioContext.destination);
	oscillator.start(now);
	oscillator.stop(now + .6);
}

function playMistakeSound() {
	if (!audioContext) return;
	const now = audioContext.currentTime;
	const oscillator = audioContext.createOscillator();
	const gain = audioContext.createGain();
	oscillator.type = 'triangle';
	oscillator.frequency.setValueAtTime(150, now);
	oscillator.frequency.exponentialRampToValueAtTime(80, now + .12);
	gain.gain.setValueAtTime(.0001, now);
	gain.gain.exponentialRampToValueAtTime(.055, now + .01);
	gain.gain.exponentialRampToValueAtTime(.0001, now + .14);
	oscillator.connect(gain);
	gain.connect(audioContext.destination);
	oscillator.start(now);
	oscillator.stop(now + .15);
}

function showMistake() {
	mistakeFlash.classList.remove('show');
	void mistakeFlash.offsetWidth;
	mistakeFlash.classList.add('show');
	window.setTimeout(() => mistakeFlash.classList.remove('show'), 240);
}

function updateGravityPulse(time) {
	if (!pulseStart) pulseStart = time;
	const pulseInterval = 1800 + sunReserve * 1000;
	const pulseDuration = 2000;
	if (time - pulseStart >= pulseInterval) pulseStart = time;
	const elapsed = time - pulseStart;
	const progress = Math.min(1, elapsed / pulseDuration);
	gravityPulse = elapsed < pulseDuration ? .5 + Math.cos(progress * Math.PI) * .5 : 0;
	if (pulseStart !== lastPulse) {
		lastPulse = pulseStart;
		playPulseSound();
	}
}

function draw(time) {
	const delta = Math.min(2, (time - lastFrame) / 16.667 || 1);
	lastFrame = time;
	if (running) updateGravityPulse(time);
	else gravityPulse = 0;

	ctx.clearRect(0, 0, width, height);
	stars.forEach(star => {
		ctx.globalAlpha = .25 + Math.sin(time / 900 + star.phase) * .2;
		ctx.fillStyle = '#dcecf2';
		ctx.beginPath();
		ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
		ctx.fill();
	});
	ctx.globalAlpha = 1;

	const cx = width / 2;
	const cy = height / 2;
	sunReserve = Math.max(0, sunReserve - sunDrain * delta);
	sunPulse = gravityPulse;
	document.documentElement.style.setProperty('--sun-stress', Math.max(0, (0.4 - sunReserve) / 0.4).toFixed(3));
	gravityEl.textContent = `gravity ${gravity.toFixed(2)} · sun ${Math.round(sunReserve * 100)}%`;
	if (!sunReserve && running) endRun('The sun collapsed before the run was complete.', 'loss');

	const sunSize = 34 + sunReserve * 32 + sunPulse * 2;
	const haloSize = sunSize * (1.75 + Math.sin(time / 600) * .04);
	ctx.beginPath();
	ctx.arc(cx, cy, haloSize, 0, Math.PI * 2);
	ctx.fillStyle = `rgba(216,255,95,${.035 + sunReserve * .035})`;
	ctx.fill();
	ctx.beginPath();
	ctx.arc(cx, cy, sunSize, 0, Math.PI * 2);
	ctx.fillStyle = '#d8ff5f';
	ctx.shadowBlur = 25 + sunPulse * 20;
	ctx.shadowColor = '#d8ff5f';
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.beginPath();
	ctx.arc(cx, cy, 78, 0, Math.PI * 2);
	ctx.strokeStyle = 'rgba(216,255,95,.12)';
	ctx.stroke();

	particles = particles.filter(particle => particle.alpha > .03);
	particles.forEach(particle => {
		const dx = cx - particle.x;
		const dy = cy - particle.y;
		const distance = Math.max(28, Math.hypot(dx, dy));
		const acceleration = mass * gravity * (1 + gravityPulse * 10) / (distance * distance + softening);
		const ax = dx / distance * acceleration;
		const ay = dy / distance * acceleration;
		const vx = particle.vx;
		const vy = particle.vy;
		const spinForce = spin * .12;
		particle.vx += (ax - vy * spinForce) * timeStep * delta;
		particle.vy += (ay + vx * spinForce) * timeStep * delta;
		particle.x += particle.vx * timeStep * delta;
		particle.y += particle.vy * timeStep * delta;
		if (distance < sunSize + 5) {
			particle.alpha = 0;
			sunReserve = Math.min(1, sunReserve + .035);
		}
		particle.alpha = Math.min(particle.alpha, Math.max(0, (distance - 24) / 130));
		ctx.globalAlpha = particle.alpha;
		ctx.fillStyle = particle.char === ' ' ? '#67e8f9' : '#e9eef4';
		ctx.font = `${particle.size}px "Space Mono"`;
		ctx.fillText(particle.char === ' ' ? '·' : particle.char, particle.x, particle.y);
	});
	ctx.globalAlpha = 1;

	if (running || particles.length) animationFrame = requestAnimationFrame(draw);
	else animationFrame = 0;
}

function startAnimation() {
	if (animationFrame) return;
	lastFrame = performance.now();
	animationFrame = requestAnimationFrame(draw);
}

function finishRound() {
	completeTimer = 0;
	if (!running || !roundComplete) return;
	dots[round].className = 'round-dot won';
	round++;
	if (round === 3) {
		completedDifficulties.add(difficulty);
		saveCompletedDifficulties();
		renderDifficulties();
		endRun('Three rounds, perfectly placed.', 'win');
		return;
	}
	dots[round].className = 'round-dot active';
	newRound();
}

function endRun(message, outcome) {
	running = false;
	gravityPulse = 0;
	finalWpm.textContent = wpmEl.textContent === '--' ? '0' : wpmEl.textContent;
	if (outcome === 'loss' && audioContext) audioContext.suspend();
	document.querySelector('#result-title').textContent = outcome === 'win' ? 'GG' : 'You perished.';
	document.querySelector('#result-copy').textContent = outcome === 'win' ? message : 'Press space to retry.';
	restart.textContent = 'Try again';
	restart.tabIndex = outcome === 'win' ? 0 : -1;
	nextLevel.hidden = outcome !== 'win' || difficulty >= 10;
	nextLevel.tabIndex = nextLevel.hidden ? -1 : 0;
	modal.className = `modal show ${outcome}`;
	modal.setAttribute('aria-hidden', 'false');
	statusEl.textContent = message;
	requestAnimationFrame(() => modal.focus());
}

function restartGame() {
	if (completeTimer) clearTimeout(completeTimer);
	completeTimer = 0;
	round = 0;
	running = true;
	particles = [];
	modal.className = 'modal';
	modal.setAttribute('aria-hidden', 'true');
	restart.tabIndex = -1;
	dots.forEach((dot, index) => { dot.className = `round-dot${index === 0 ? ' active' : ''}`; });
	newRound();
	if (audioContext) audioContext.resume();
	input.focus();
	startAnimation();
}

function startNextLevel() {
	if (difficulty >= 10) return;
	difficulty++;
	renderDifficulties();
	restartGame();
}

function handleCharacter(char) {
	if (!running || roundComplete || typed >= quote.length) return;
	const expected = quote[typed];
	if (!cheatActive && char !== expected) {
		errors++;
		sunReserve = Math.max(0, sunReserve - .025);
		showMistake();
		playMistakeSound();
		statusEl.textContent = 'Wrong letter';
		clearTimeout(feedbackTimer);
		feedbackTimer = window.setTimeout(() => {
			if (running && !roundComplete) statusEl.textContent = 'Keep the orbit alive';
		}, 500);
		updateStats();
		return;
	}
	if (!started) {
		started = Date.now();
		statusEl.textContent = 'Keep the orbit alive';
	}
	addParticle(cheatActive ? expected : char, typed);
	typed++;
	renderQuote();
	updateStats();
	if (typed === quote.length) {
		roundComplete = true;
		completeTimer = window.setTimeout(finishRound, 350);
	}
}

document.addEventListener('keydown', event => {
	if (event.code === 'Space' && !running) {
		event.preventDefault();
		restartGame();
		return;
	}
	if (!running || event.key.length !== 1) return;
	event.preventDefault();
	if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
	audioContext.resume();
	handleCharacter(event.key);
});

input.addEventListener('input', () => {
	const value = input.value;
	input.value = '';
	[...value].forEach(handleCharacter);
});

document.addEventListener('click', () => input.focus());
restart.addEventListener('click', restartGame);
nextLevel.addEventListener('click', startNextLevel);
cheatButton.hidden = !CHEAT_ENABLED;
cheatButton.addEventListener('click', event => {
	event.stopPropagation();
	cheatActive = true;
	cheatButton.hidden = true;
	input.focus();
});
window.addEventListener('resize', resize);
resize();
newRound();
renderDifficulties();
startAnimation();
input.focus();
