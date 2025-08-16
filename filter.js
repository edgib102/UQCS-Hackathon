// filter.js

// Implementation of a One-Euro Filter.
// Alpha calculation is adapted to use timestamps for variable frame rates.
// http://www.lifl.fr/~casiez/1euro/

const now = () => performance.now();

class LowPassFilter {
    constructor() {
        this.y = null;
        this.s = null;
    }
    
    reset() {
        this.y = null;
        this.s = null;
    }

    filter(value, alpha) {
        if (this.y === null) {
            this.s = value;
        } else {
            this.s = alpha * value + (1.0 - alpha) * this.s;
        }
        this.y = value;
        return this.s;
    }
}


class OneEuroFilter {
    constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.lastTime = null;
        this.x = new LowPassFilter();
        this.dx = new LowPassFilter();
    }
    
    reset() {
        this.lastTime = null;
        this.x.reset();
        this.dx.reset();
    }

    getAlpha(rate) {
        const te = 1.0 / rate;
        const tau = 1.0 / (2 * Math.PI * this.minCutoff);
        return 1.0 / (1.0 + tau / te);
    }

    getDCutoffAlpha(rate) {
        const te = 1.0 / rate;
        const tau = 1.0 / (2 * Math.PI * this.dCutoff);
        return 1.0 / (1.0 + tau / te);
    }

    filter(value, timestamp = now()) {
        if (this.lastTime === null) {
            this.lastTime = timestamp;
            return this.x.filter(value, 1.0);
        }

        const elapsed = timestamp - this.lastTime;
        if (elapsed <= 0) return this.x.s; // Return last smoothed value if timestamp is not new
        
        const rate = 1000.0 / elapsed;
        this.lastTime = timestamp;

        const dvalue = this.x.y === null ? 0.0 : (value - this.x.y) * rate;
        const edx = this.dx.filter(dvalue, this.getDCutoffAlpha(rate));
        
        const cutoff = this.minCutoff + this.beta * Math.abs(edx);
        return this.x.filter(value, this.getAlpha(cutoff));
    }
}

export class LandmarkFilter {
    constructor() {
        this.x = new OneEuroFilter();
        this.y = new OneEuroFilter();
        this.z = new OneEuroFilter();
    }

    filter(landmark) {
        const timestamp = now();
        return {
            x: this.x.filter(landmark.x, timestamp),
            y: this.y.filter(landmark.y, timestamp),
            z: this.z.filter(landmark.z, timestamp),
            visibility: landmark.visibility,
        };
    }
    
    reset() {
        this.x.reset();
        this.y.reset();
        this.z.reset();
    }
}