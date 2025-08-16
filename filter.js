// filter.js

// A simple exponential moving average filter.
class SimpleSmoother {
    constructor(factor = 0.5) {
        this.factor = factor;
        this.lastValue = null;
    }

    smooth(value) {
        if (this.lastValue === null) {
            this.lastValue = value;
            return value;
        }
        const smoothed = this.factor * value + (1.0 - this.factor) * this.lastValue;
        this.lastValue = smoothed;
        return smoothed;
    }
    
    reset() {
        this.lastValue = null;
    }
}

// Manages a smoother for each coordinate of a landmark.
export class LandmarkFilter {
    constructor(smoothingFactor = 0.5) {
        this.x = new SimpleSmoother(smoothingFactor);
        this.y = new SimpleSmoother(smoothingFactor);
        this.z = new SimpleSmoother(smoothingFactor);
    }

    filter(landmark) {
        return {
            x: this.x.smooth(landmark.x),
            y: this.y.smooth(landmark.y),
            z: this.z.smooth(landmark.z),
            visibility: landmark.visibility,
        };
    }

    reset() {
        this.x.reset();
        this.y.reset();
        this.z.reset();
    }
}