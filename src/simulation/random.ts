import seedrandom from 'seedrandom';

export type RNG = () => number;

export const createRng = (seed: string | number): RNG => {
  return seedrandom(String(seed));
};

export const sampleStandardNormal = (rng: RNG): number => {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = Math.max(rng(), Number.EPSILON);
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0;
};

export const sampleLogNormal = (rng: RNG, mean: number, sigma: number): number => {
  const normal = sampleStandardNormal(rng);
  return Math.exp(mean + sigma * normal);
};

export const sampleBeta = (rng: RNG, alpha: number, beta: number): number => {
  const sampleGamma = (shape: number): number => {
    if (shape < 1) {
      const u = rng();
      return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
    }

    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    // Marsaglia and Tsang method
    while (true) {
      const x = sampleStandardNormal(rng);
      const v = Math.pow(1 + c * x, 3);

      if (v <= 0) {
        continue;
      }

      const u = rng();
      const xSquared = x * x;

      if (u < 1 - 0.0331 * xSquared * xSquared) {
        return d * v;
      }

      if (Math.log(u) < 0.5 * xSquared + d * (1 - v + Math.log(v))) {
        return d * v;
      }
    }
  };

  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
};
