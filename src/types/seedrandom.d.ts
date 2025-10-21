declare module 'seedrandom' {
  interface PRNG {
    (): number;
  }

  interface Options {
    entropy?: boolean;
  }

  type SeedRandom = (seed?: string, options?: Options) => PRNG;

  const seedrandom: SeedRandom;
  export default seedrandom;
}
