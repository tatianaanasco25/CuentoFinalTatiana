// Configurar la ruta del worker de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

// Elementos del DOM
const bookContainer = document.getElementById('flip-book');
const loading = document.getElementById('loading');
const pageInfo = document.getElementById('page-info');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const ttsBtn = document.getElementById('tts-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomResetBtn = document.getElementById('zoom-reset-btn');
const birdSoundBtn = document.getElementById('bird-sound-btn');

// Variables de estado
let pageFlip = null;
let pagesText = []; // Guarda el texto extraído de cada página para lectura en voz alta
let currentScale = 1.0;
const SCALE_STEP = 0.15;
const MAX_SCALE = 1.8;
const MIN_SCALE = 0.8;

// Estado de sonido de pájaros
let birdSoundActive = false;
let audioCtx = null;
let birdInterval = null;

// 1. Carga automática del archivo cuento.pdf alojado en el repositorio
document.addEventListener('DOMContentLoaded', () => {
    loadPDF('cuento.pdf');
});

async function loadPDF(pdfUrl) {
    loading.style.display = 'block';
    bookContainer.style.display = 'none';
    bookContainer.innerHTML = '';
    pagesText = [];

    if (pageFlip) {
        pageFlip.destroy();
        pageFlip = null;
    }

    try {
        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
        const totalPages = pdf.numPages;

        const firstPage = await pdf.getPage(1);
        const viewportInfo = firstPage.getViewport({ scale: 1.5 });
        const pageWidth = viewportInfo.width;
        const pageHeight = viewportInfo.height;

        // Bucle para procesar cada página y extraer texto
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            
            // 3. Extraer texto real con PDF.js
            const textContent = await page.getTextContent();
            const rawText = textContent.items.map(item => item.str).join(' ');
            
            // Normalización Unicode NFC (asegura la correcta lectura de 'ñ' y diacríticos)
            const cleanText = rawText.normalize('NFC').replace(/\s+/g, ' ').trim();
            pagesText.push(cleanText);

            // Renderizado visual en canvas
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            const pageDiv = document.createElement('div');
            pageDiv.className = 'page';
            pageDiv.appendChild(canvas);
            bookContainer.appendChild(pageDiv);
        }

        // Inicializar Flipbook
        bookContainer.style.display = 'block';
        pageFlip = new St.PageFlip(bookContainer, {
            width: pageWidth,
            height: pageHeight,
            size: "stretch",
            minWidth: 315,
            maxWidth: pageWidth,
            minHeight: 420,
            maxHeight: pageHeight,
            showCover: true,
            maxShadowOpacity: 0.4,
            usePortrait: true
        });

        const pages = document.querySelectorAll('.page');
        pageFlip.loadFromHTML(pages);

        // Evento al pasar de página
        pageFlip.on('flip', () => {
            updatePageInfo();
            stopSpeech();
            if (birdSoundActive) {
                playBirdChirp();
            }
        });

        updatePageInfo();
        loading.style.display = 'none';

    } catch (error) {
        console.error('Error al cargar cuento.pdf:', error);
        loading.innerText = 'No se pudo encontrar "cuento.pdf". Revisa que el archivo esté guardado con ese nombre en tu repositorio.';
    }
}

function updatePageInfo() {
    if (!pageFlip) return;
    const current = pageFlip.getCurrentPageIndex() + 1;
    const total = pageFlip.getPageCount();
    pageInfo.innerText = `Página ${current} de ${total}`;
}

// 4. Navegación con Corazones Laterales
prevBtn.addEventListener('click', () => {
    if (pageFlip) pageFlip.flipPrev();
});

nextBtn.addEventListener('click', () => {
    if (pageFlip) pageFlip.flipNext();
});

// 3. Controles de Zoom para Baja Visión
zoomInBtn.addEventListener('click', () => {
    if (currentScale < MAX_SCALE) {
        currentScale += SCALE_STEP;
        applyZoom();
    }
});

zoomOutBtn.addEventListener('click', () => {
    if (currentScale > MIN_SCALE) {
        currentScale -= SCALE_STEP;
        applyZoom();
    }
});

zoomResetBtn.addEventListener('click', () => {
    currentScale = 1.0;
    applyZoom();
});

function applyZoom() {
    bookContainer.style.transform = `scale(${currentScale})`;
}

// 3. Lectura en Voz Alta con SpeechSynthesis en Español (alumnos con baja visión)
ttsBtn.addEventListener('click', () => {
    if (!('speechSynthesis' in window)) {
        alert('Tu navegador no cuenta con la función de síntesis de voz.');
        return;
    }

    if (window.speechSynthesis.speaking) {
        stopSpeech();
    } else {
        readCurrentPage();
    }
});

function readCurrentPage() {
    if (!pageFlip || pagesText.length === 0) return;

    const pageIndex = pageFlip.getCurrentPageIndex();
    let textToRead = pagesText[pageIndex] || '';

    // Si la pantalla muestra dos páginas abiertas, incluye el texto de la página contigua
    if (pageFlip.getOrientation() === 'landscape' && pageIndex + 1 < pagesText.length && pageIndex > 0) {
        if (pagesText[pageIndex + 1]) {
            textToRead += ' ' + pagesText[pageIndex + 1];
        }
    }

    if (!textToRead.trim()) {
        textToRead = "Esta página no contiene texto computable.";
    }

    const sanitizedText = textToRead.normalize('NFC');
    const utterance = new SpeechSynthesisUtterance(sanitizedText);
    utterance.lang = 'es-ES';
    utterance.rate = 0.85; // Ritmo pausado adecuado para niños y alumnos con baja visión

    const voices = window.speechSynthesis.getVoices();
    const spanishVoice = voices.find(v => v.lang.startsWith('es'));
    if (spanishVoice) {
        utterance.voice = spanishVoice;
    }

    utterance.onstart = () => {
        ttsBtn.innerHTML = '⏹️ Detener lectura';
        ttsBtn.classList.add('speaking');
    };

    utterance.onend = resetTtsButton;
    utterance.onerror = resetTtsButton;

    window.speechSynthesis.speak(utterance);
}

function stopSpeech() {
    if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
    }
    resetTtsButton();
}

function resetTtsButton() {
    ttsBtn.innerHTML = '🔊 Leer en voz alta';
    ttsBtn.classList.remove('speaking');
}

// 6. Sonidos Ambientales de Pájaros (Web Audio API)
birdSoundBtn.addEventListener('click', () => {
    birdSoundActive = !birdSoundActive;

    if (birdSoundActive) {
        birdSoundBtn.innerText = '🐤 Pájaros: ON';
        birdSoundBtn.classList.add('active');
        startBirdAmbience();
    } else {
        birdSoundBtn.innerText = '🐤 Pájaros: OFF';
        birdSoundBtn.classList.remove('active');
        stopBirdAmbience();
    }
});

function initAudioContext() {
    if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function startBirdAmbience() {
    initAudioContext();
    playBirdChirp();
    birdInterval = setInterval(() => {
        if (birdSoundActive) {
            playBirdChirp();
        }
    }, 3200);
}

function stopBirdAmbience() {
    if (birdInterval) {
        clearInterval(birdInterval);
        birdInterval = null;
    }
}

function playBirdChirp() {
    if (!audioCtx) return;

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    
    const baseFreq = 2200 + Math.random() * 600;
    const peakFreq = baseFreq + 700 + Math.random() * 300;

    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(peakFreq, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.16);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.26);
}