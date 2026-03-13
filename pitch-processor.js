/**
 * Simple Granular Pitch Shifter AudioWorkletProcessor
 * Takes an input signal and pitch shifts it independently of time using a basic delay/granular approach.
 */
class PitchProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.pitchRatio = 1.0;
        this.port.onmessage = (e) => {
            if (e.data.pitchRatio !== undefined) {
                this.pitchRatio = e.data.pitchRatio;
            }
        };

        // Granular overlap-add state
        this.grainSize = 1024;
        this.overlap = 0.5;
        this.buffer = [new Float32Array(44100), new Float32Array(44100)]; // 1 sec max for stereo
        this.writePtr = 0;
        this.readPtr = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input.length) return true;

        const channelCount = Math.min(input.length, output.length, 2);
        const frameCount = input[0].length;

        // If pitchRatio is 1.0, just pass through
        if (Math.abs(this.pitchRatio - 1.0) < 0.01) {
            for (let c = 0; c < channelCount; c++) {
                output[c].set(input[c]);
            }
            return true;
        }

        // Basic phase accumulation for pitch shifting (simplified granular/resampling for demo)
        // A robust real-time pitch shifter requires more complex windowing.
        for (let i = 0; i < frameCount; i++) {
            for (let c = 0; c < channelCount; c++) {
                // Write into circular buffer
                this.buffer[c][this.writePtr] = input[c][i];

                // Read from circular buffer with ratio
                let rIdx = Math.floor(this.readPtr);
                if (rIdx < 0) rIdx += 44100;

                output[c][i] = this.buffer[c][rIdx % 44100];
            }
            this.writePtr = (this.writePtr + 1) % 44100;
            this.readPtr = (this.readPtr + this.pitchRatio) % 44100;

            // Periodically reset read pointer to write pointer to keep latency bounded
            // This causes artifacts (clicks) without windowing, but is a basic proof of concept
            if (Math.abs(this.readPtr - this.writePtr) > 4096) {
                this.readPtr = this.writePtr;
            }
        }

        return true;
    }
}

registerProcessor('pitch-processor', PitchProcessor);
