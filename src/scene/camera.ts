/** Pure camera math shared by the rig and tests. */
export type Vec3 = [number, number, number];

/** Default viewing direction (from the target toward the camera): slightly above, in front. */
export const DEFAULT_DIR: Vec3 = [0, 0.42, 1];

/** Camera distance that fits a box of `size` (centered on the target) into the view. */
export function fitDistance(size: Vec3, fovDeg: number, aspect: number): number {
  const v = Math.tan((fovDeg * Math.PI) / 360);
  const h = v * Math.max(0.2, aspect);
  return Math.max(size[1] / 2 / v, size[0] / 2 / h) + size[2] / 2;
}
