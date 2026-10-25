// d3-force-3d ships no typings; only the simulation and the forces the graph layout uses are declared.
declare module 'd3-force-3d' {
  export interface SimNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
  }

  export interface SimLink {
    source: number | SimNode;
    target: number | SimNode;
  }

  export interface Force {
    (alpha: number): void;
  }

  export interface StrengthForce extends Force {
    strength(strength: number): this;
  }

  export interface LinkForce extends StrengthForce {
    distance(distance: number): this;
  }

  export interface Simulation<N extends SimNode> {
    tick(iterations?: number): this;
    stop(): this;
    nodes(): N[];
    randomSource(random: () => number): this;
    alphaDecay(decay: number): this;
    force(name: string, force: Force | null): this;
  }

  export function forceSimulation<N extends SimNode>(nodes?: N[], numDimensions?: 1 | 2 | 3): Simulation<N>;
  export function forceLink(links?: SimLink[]): LinkForce;
  export function forceManyBody(): StrengthForce;
  export function forceCollide(radius?: number): StrengthForce;
  export function forceX(x?: number): StrengthForce;
  export function forceY(y?: number): StrengthForce;
  export function forceZ(z?: number): StrengthForce;
}
