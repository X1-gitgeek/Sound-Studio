/**
 * Core Audio Engine - Web Audio API
 */
export class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.nodes = {};
        this.isPlaying = false;
        this.playlist = [];
        this.currentTrackIndex = 0;
        this.sourceNode = null;

        // Track visualizer analyser
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);

        // Core states
        this.speed = 1.0;
        this.pitchRatio = 1.0;
        this.linkedPitchTime = false;

        this.initDSPGraph();
        this.initWorklets();
        this.bindUI();
    }

    async initWorklets() {
        try {
            await this.ctx.audioWorklet.addModule('js/pitch-processor.js');
            this.nodes.pitchShifter = new AudioWorkletNode(this.ctx, 'pitch-processor');
        } catch (e) {
            console.error("Pitch processor load failed:", e);
        }
    }

    initDSPGraph() {
        const ctx = this.ctx;

        this.nodes.hpf = ctx.createBiquadFilter();
        this.nodes.hpf.type = 'highpass';
        this.nodes.hpf.frequency.value = 0;

        this.nodes.bass = ctx.createBiquadFilter();
        this.nodes.bass.type = 'lowshelf';
        this.nodes.bass.frequency.value = 250;

        this.nodes.mids = ctx.createBiquadFilter();
        this.nodes.mids.type = 'peaking';
        this.nodes.mids.frequency.value = 1000;
        this.nodes.mids.Q.value = 1;

        this.nodes.highs = ctx.createBiquadFilter();
        this.nodes.highs.type = 'highshelf';
        this.nodes.highs.frequency.value = 4000;

        this.nodes.convolver = ctx.createConvolver();
        this.nodes.reverbDry = ctx.createGain();
        this.nodes.reverbWet = ctx.createGain();
        this.nodes.reverbWet.gain.value = 0.2; // default mix

        this.nodes.widthIn = ctx.createGain();
        this.nodes.widthOut = ctx.createGain();

        this.nodes.panner = ctx.createPanner();
        this.nodes.panner.panningModel = 'HRTF';
        this.nodes.panner.distanceModel = 'inverse';
        this.nodes.panner.refDistance = 1;
        this.nodes.panner.maxDistance = 10000;
        this.nodes.panner.rolloffFactor = 1;
        this.nodes.panner.positionY.value = 0;
        this.nodes.panner.positionZ.value = 0;

        this.nodes.master = ctx.createGain();
        this.nodes.master.gain.value = 0.8;

        this.nodes.hpf.connect(this.nodes.bass);
        this.nodes.bass.connect(this.nodes.mids);
        this.nodes.mids.connect(this.nodes.highs);

        this.nodes.highs.connect(this.nodes.reverbDry);
        this.nodes.highs.connect(this.nodes.convolver);
        this.nodes.convolver.connect(this.nodes.reverbWet);

        this.nodes.reverbDry.connect(this.nodes.widthIn);
        this.nodes.reverbWet.connect(this.nodes.widthIn);

        this.nodes.widthIn.connect(this.nodes.widthOut);
        this.nodes.widthOut.connect(this.nodes.panner);

        this.nodes.panner.connect(this.analyser);
        this.analyser.connect(this.nodes.master);
        this.nodes.master.connect(ctx.destination);
    }

    async generateImpulseResponse(durationSec, decay, brightness) {
        if (durationSec <= 0) durationSec = 0.1;
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * durationSec;
        const impulse = this.ctx.createBuffer(2, length, sampleRate);
        const impulseL = impulse.getChannelData(0);
        const impulseR = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const env = Math.pow(1 - i / length, decay);
            const noiseL = (Math.random() * 2 - 1) * env;
            const noiseR = (Math.random() * 2 - 1) * env;
            // brightness factor
            const brightFactor = brightness / 100;
            impulseL[i] = noiseL * brightFactor;
            impulseR[i] = noiseR * brightFactor;
        }
        this.nodes.convolver.buffer = impulse;
    }

    async loadFile(fileHandle) {
        const file = await fileHandle.getFile();
        if (!file.type.startsWith('audio/') && !file.name.match(/\.(wav|mp3|flac|ogg)$/i)) return;

        this.playlist = [{ file, handle: fileHandle }];
        this.currentTrackIndex = 0;
        await this.playTrack(0);
    }

    async loadFolder(dirHandle) {
        this.playlist = [];
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file') {
                const ext = entry.name.split('.').pop().toLowerCase();
                if (['wav', 'mp3', 'flac', 'ogg', 'm4a'].includes(ext)) {
                    const file = await entry.getFile();
                    this.playlist.push({ file, handle: entry, name: entry.name });
                }
            }
        }
        if (this.playlist.length > 0) {
            this.currentTrackIndex = 0;
            await this.playTrack(0);
        }
    }

    async playTrack(index) {
        if (this.playlist.length === 0 || index >= this.playlist.length || index < 0) return;

        if (this.ctx.state === 'suspended') await this.ctx.resume();
        if (this.sourceNode) {
            this.sourceNode.stop();
            this.sourceNode.disconnect();
        }

        const track = this.playlist[index];
        this.currentTrackIndex = index;
        const arrayBuffer = await track.file.arrayBuffer();
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

        this.sourceNode = this.ctx.createBufferSource();
        this.sourceNode.buffer = audioBuffer;
        this.sourceNode.loop = true;

        if (this.nodes.pitchShifter) {
            this.sourceNode.connect(this.nodes.pitchShifter);
            this.nodes.pitchShifter.connect(this.nodes.hpf);
        } else {
            this.sourceNode.connect(this.nodes.hpf);
        }

        this.updateSpeedAndPitch();

        this.sourceNode.start(0);
        this.isPlaying = true;

        let artist = track.file.name.includes('-') ? track.file.name.split('-')[0].trim() : "Unknown Artist";
        let title = track.file.name.includes('-') ? track.file.name.split('-')[1].split('.')[0].trim() : track.file.name;
        this.updateUI(title, artist);
    }

    togglePlayPause() {
        if (!this.sourceNode) return;
        if (this.isPlaying) {
            this.ctx.suspend();
            this.isPlaying = false;
        } else {
            this.ctx.resume();
            this.isPlaying = true;
        }
    }

    nextTrack() {
        if (this.currentTrackIndex < this.playlist.length - 1) {
            this.playTrack(this.currentTrackIndex + 1);
        }
    }

    prevTrack() {
        if (this.currentTrackIndex > 0) {
            this.playTrack(this.currentTrackIndex - 1);
        }
    }

    updateSpeedAndPitch() {
        if (!this.sourceNode) return;

        if (this.linkedPitchTime) {
            this.sourceNode.playbackRate.value = this.speed;
            if (this.nodes.pitchShifter) {
                this.nodes.pitchShifter.port.postMessage({ pitchRatio: 1.0 });
            }
        } else {
            this.sourceNode.playbackRate.value = this.speed;
            if (this.nodes.pitchShifter) {
                this.nodes.pitchShifter.port.postMessage({ pitchRatio: this.pitchRatio });
            }
        }
    }

    updateUI(title, artist) {
        const titleEl = document.getElementById('track-title');
        const artistEl = document.getElementById('track-artist');
        if (titleEl) titleEl.textContent = title;
        if (artistEl) artistEl.textContent = artist;
    }

    bindUI() {
        const bindSlider = (id, callback, suffix = '') => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(`val-${id}`);
            if (el) {
                el.addEventListener('input', (e) => {
                    const val = parseFloat(e.target.value);
                    callback(val);
                    if (valEl) valEl.textContent = val + suffix;
                });
            }
        };

        // EQ
        bindSlider('eq-highs', v => this.nodes.highs.gain.value = v, 'dB');
        bindSlider('eq-mids', v => this.nodes.mids.gain.value = v, 'dB');
        bindSlider('eq-bass', v => this.nodes.bass.gain.value = v, 'dB');
        bindSlider('eq-hpf', v => this.nodes.hpf.frequency.value = v, 'Hz');

        // Master
        bindSlider('volume-fader', v => this.nodes.master.gain.value = v / 100, '');

        // Reverb params
        let revSize = 50, revDecay = 2.0, revBright = 50;
        const updateReverb = () => this.generateImpulseResponse(revSize / 20, revDecay, revBright);
        bindSlider('rev-size', v => { revSize = v; updateReverb(); }, '%');
        bindSlider('rev-decay', v => { revDecay = v / 20; updateReverb(); }, 's');
        bindSlider('rev-bright', v => { revBright = v; updateReverb(); }, '%');
        bindSlider('rev-mix', v => {
            this.nodes.reverbWet.gain.value = v / 100;
            this.nodes.reverbDry.gain.value = 1.0 - (v / 100);
        }, '%');

        // Pitch / Time
        bindSlider('speed', v => { this.speed = v; this.updateSpeedAndPitch(); }, 'x');
        bindSlider('pitch', v => {
            this.pitchRatio = Math.pow(2, v / 12);
            this.updateSpeedAndPitch();
        }, '');

        const linkCheckbox = document.getElementById('link-pitch-time');
        if (linkCheckbox) {
            linkCheckbox.addEventListener('change', (e) => {
                this.linkedPitchTime = e.target.checked;
                this.updateSpeedAndPitch();
            });
        }

        // Spatial Mappings
        bindSlider('spatial-x', v => this.nodes.panner.positionX.value = v, '');
        bindSlider('spatial-y', v => this.nodes.panner.positionY.value = v, '');
        bindSlider('spatial-z', v => this.nodes.panner.positionZ.value = v, '');

        updateReverb();
    }
}
