/**
 * Audio Exporter
 * Takes a source AudioBuffer and processes it through an OfflineAudioContext
 * mirroring the live engine's parameters, exporting to a 32-bit Float WAV.
 */
export class AudioExporter {
    static async exportTrack(engine) {
        if (!engine.playlist || engine.playlist.length === 0) {
            alert("No track loaded to export.");
            return;
        }

        const track = engine.playlist[engine.currentTrackIndex];
        const arrayBuffer = await track.file.arrayBuffer();

        // Use a temporary normal context just to decode
        const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
        const originalBuffer = await tempCtx.decodeAudioData(arrayBuffer);

        // Calculate offline duration based on speed
        // Add 5 seconds for reverb tail
        const duration = (originalBuffer.duration / engine.speed) + 5.0;
        const sampleRate = originalBuffer.sampleRate || 44100;

        const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

        // Replicate DSP Graph in offlineCtx
        const hpf = offlineCtx.createBiquadFilter();
        hpf.type = 'highpass'; hpf.frequency.value = engine.nodes.hpf.frequency.value;

        const bass = offlineCtx.createBiquadFilter();
        bass.type = 'lowshelf'; bass.frequency.value = 250; bass.gain.value = engine.nodes.bass.gain.value;

        const mids = offlineCtx.createBiquadFilter();
        mids.type = 'peaking'; mids.frequency.value = 1000;
        mids.Q.value = 1; mids.gain.value = engine.nodes.mids.gain.value;

        const highs = offlineCtx.createBiquadFilter();
        highs.type = 'highshelf'; highs.frequency.value = 4000; highs.gain.value = engine.nodes.highs.gain.value;

        const convolver = offlineCtx.createConvolver();
        if (engine.nodes.convolver.buffer) { // Copy Impulse Response
            convolver.buffer = engine.nodes.convolver.buffer;
        }

        const reverbDry = offlineCtx.createGain(); reverbDry.gain.value = engine.nodes.reverbDry.gain.value;
        const reverbWet = offlineCtx.createGain(); reverbWet.gain.value = engine.nodes.reverbWet.gain.value;

        const panner = offlineCtx.createPanner();
        panner.panningModel = 'HRTF';
        panner.positionX.value = engine.nodes.panner.positionX.value;
        panner.positionY.value = engine.nodes.panner.positionY.value;
        panner.positionZ.value = engine.nodes.panner.positionZ.value;

        const master = offlineCtx.createGain();
        master.gain.value = engine.nodes.master.gain.value;

        // Route offline
        hpf.connect(bass);
        bass.connect(mids);
        mids.connect(highs);

        highs.connect(reverbDry);
        highs.connect(convolver);
        convolver.connect(reverbWet);

        reverbDry.connect(panner);
        reverbWet.connect(panner);

        panner.connect(master);
        master.connect(offlineCtx.destination);

        // Source
        const source = offlineCtx.createBufferSource();
        source.buffer = originalBuffer;
        source.playbackRate.value = engine.speed;

        // We skip PitchWorklet in offline for this vanilla demo because AudioWorklet 
        // in OfflineAudioContext is complex to synchronize, but we apply time stretch.
        source.connect(hpf);
        source.start(0);

        console.log("Rendering offline...");
        btnExport.textContent = "Rendering...";
        btnExport.disabled = true;

        const renderedBuffer = await offlineCtx.startRendering();

        console.log("Rendering complete. Encoding to WAV...");
        btnExport.textContent = "Encoding...";

        const wavBlob = this.bufferToWave(renderedBuffer, renderedBuffer.length);

        // Trigger Download
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `SoundStudio_Export_${track.file.name}.wav`;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            btnExport.textContent = "Export Audio";
            btnExport.disabled = false;
        }, 100);
    }

    /**
     * Encodes AudioBuffer to 32-bit Float PCM WAV
     */
    static bufferToWave(abuffer, len) {
        let numOfChan = abuffer.numberOfChannels,
            length = len * numOfChan * 4 + 44,
            buffer = new ArrayBuffer(length),
            view = new DataView(buffer),
            channels = [], i, sample,
            offset = 0,
            pos = 0;

        // write WAVE header
        setUint32(0x46464952); // "RIFF"
        setUint32(length - 8); // file length - 8
        setUint32(0x45564157); // "WAVE"

        setUint32(0x20746d66); // "fmt " chunk
        setUint32(16); // length = 16
        setUint16(3); // PCM float format
        setUint16(numOfChan);
        setUint32(abuffer.sampleRate);
        setUint32(abuffer.sampleRate * 4 * numOfChan); // byte rate
        setUint16(numOfChan * 4); // block-align
        setUint16(32); // 32-bit

        setUint32(0x61746164); // "data" - chunk
        setUint32(length - pos - 4); // chunk length

        // write interleaved data
        for (i = 0; i < abuffer.numberOfChannels; i++)
            channels.push(abuffer.getChannelData(i));

        while (pos < length) {
            for (i = 0; i < numOfChan; i++) {
                // write 32-bit float
                sample = channels[i][offset];
                view.setFloat32(pos, sample, true);
                pos += 4;
            }
            offset++;
        }

        return new Blob([buffer], { type: "audio/wav" });

        function setUint16(data) {
            view.setUint16(pos, data, true);
            pos += 2;
        }

        function setUint32(data) {
            view.setUint32(pos, data, true);
            pos += 4;
        }
    }
}
