import { AudioEngine } from './audio-engine.js';
import { Visualizer } from './visualizer.js';
import { AudioExporter } from './exporter.js';

// UI Elements
const themeBtns = document.querySelectorAll('.theme-btn');
const accentContainer = document.getElementById('accent-colors');
const btnExpandPlayer = document.getElementById('btn-expand-player');
const playerBar = document.querySelector('.player-bar');
const sideMenus = document.querySelectorAll('.side-menu');
const collapseBtns = document.querySelectorAll('.btn-collapse');

// Apply physics hover to all buttons
document.querySelectorAll('button').forEach(btn => {
    btn.classList.add('physics-hover');
    btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        // Basic physics tilt
        btn.style.transform = `translate(${x * 0.1}px, ${y * 0.1}px) scale(1.05)`;
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translate(0px, 0px) scale(1)';
    });
});

// 11 Accent Colors Config
const ACCENT_COLORS = [
    { name: 'Default', hex: '#3498db' },
    { name: 'Red', hex: '#e74c3c' },
    { name: 'Orange', hex: '#f39c12' },
    { name: 'Yellow', hex: '#f1c40f' },
    { name: 'Green', hex: '#2ecc71' },
    { name: 'Teal', hex: '#1abc9c' },
    { name: 'Cyan', hex: '#00d2d3' },
    { name: 'Blue', hex: '#2980b9' },
    { name: 'Purple', hex: '#9b59b6' },
    { name: 'Pink', hex: '#fd79a8' },
    { name: 'White', hex: '#ffffff' }
];

let engine;
let visualizer;

// 1. Theme Engine & Colors
function initThemeEngine() {
    ACCENT_COLORS.forEach((color, index) => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch' + (index === 0 ? ' active' : '');
        swatch.style.backgroundColor = color.hex;
        swatch.title = color.name;
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');
            document.documentElement.style.setProperty('--accent-color', color.hex);
            if (visualizer) visualizer.updateAccentColor(color.hex);
        });
        accentContainer.appendChild(swatch);
    });

    themeBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            themeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const theme = btn.getAttribute('data-theme');
            document.body.className = '';
            document.body.classList.add(`theme-${theme}`);
        });
    });
}

// 2. UI Interactions (Collapsible & Expandable)
function initUIInteractions() {
    btnExpandPlayer.addEventListener('click', () => {
        playerBar.classList.toggle('expanded');
        if (playerBar.classList.contains('expanded')) {
            btnExpandPlayer.textContent = '🗗';
            sideMenus.forEach(menu => menu.style.opacity = '0');
        } else {
            btnExpandPlayer.textContent = '⛶';
            sideMenus.forEach(menu => menu.style.opacity = '1');
        }
    });

    collapseBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const panel = e.target.closest('.side-menu');
            panel.classList.toggle('collapsed');
        });
    });
}

function initAudioSystem() {
    engine = new AudioEngine();
    visualizer = new Visualizer(engine);
    visualizer.updateAccentColor(ACCENT_COLORS[0].hex);

    const btnLoadFolder = document.getElementById('btn-load-folder');
    const btnLoadFile = document.getElementById('btn-load-file');
    const btnPlay = document.getElementById('btn-play');
    const btnNext = document.getElementById('btn-next');
    const btnPrev = document.getElementById('btn-prev');
    const btnExport = document.getElementById('btn-export'); // Ensure this is selected globally if needed
    window.btnExport = btnExport; // Expose globally for the exporter UI text replacement

    btnLoadFile.addEventListener('click', async () => {
        try {
            const [fileHandle] = await window.showOpenFilePicker({
                types: [{
                    description: 'Audio Files',
                    accept: { 'audio/*': ['.wav', '.mp3', '.flac', '.ogg'] }
                }]
            });
            await engine.loadFile(fileHandle);
        } catch (e) {
            console.log("User cancelled file load or error:", e);
        }
    });

    btnLoadFolder.addEventListener('click', async () => {
        try {
            const dirHandle = await window.showDirectoryPicker();
            await engine.loadFolder(dirHandle);
        } catch (e) {
            console.log("User cancelled folder load or error:", e);
        }
    });

    btnPlay.addEventListener('click', () => {
        engine.togglePlayPause();
        btnPlay.textContent = engine.isPlaying ? '⏸' : '▶';
    });

    btnNext.addEventListener('click', () => engine.nextTrack());
    btnPrev.addEventListener('click', () => engine.prevTrack());

    btnExport.addEventListener('click', async () => {
        await AudioExporter.exportTrack(engine);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initThemeEngine();
    initUIInteractions();
    initAudioSystem();
});
