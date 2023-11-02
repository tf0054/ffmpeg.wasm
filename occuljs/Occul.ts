import sharp, { Kernel } from "sharp";
import { Corner } from "./Corner";

export default class Occul {
  public async analyze(imageUrl: string | Uint8Array) {
    const img = sharp(imageUrl);
    const res = img.greyscale();
    const image = await res.convolve(laplaceKernel()).raw().toBuffer();
    const array = new Uint8ClampedArray(image.buffer);
    let it = 0;
    array.forEach((value) => {
      it = it + value;
      if (value > 255) {
        console.log("WEIRD", value);
      }
    });
    const mean = array.reduce((p, c) => p + c) / array.length;
    return (
      array.reduce((p, c) => p + Math.pow(c - mean, 2)) / (array.length - 1)
    );
  }
}

function corners(): Corner[] {
  return [
    Corner.TOP_LEFT,
    Corner.TOP,
    Corner.TOP_RIGHT,
    Corner.LEFT,
    Corner.CENTER,
    Corner.RIGHT,
    Corner.BOTTOM_LEFT,
    Corner.BOTTOM,
    Corner.BOTTOM_RIGHT,
  ];
}

function laplaceKernel(): Kernel {
  return {
    width: 3,
    height: 3,
    kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
  };
}
